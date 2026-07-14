import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import {
  db,
  usersTable,
  chatChannelsTable,
  chatChannelMembersTable,
  chatChannelMessagesTable,
  chatDirectMessagesTable,
  isPortalRole,
} from "@workspace/db";
import {
  ListChatColleaguesResponse,
  ListChatChannelsResponse,
  CreateChatChannelBody,
  CreateChatChannelResponse,
  GetChatChannelParams,
  GetChatChannelResponse,
  JoinChatChannelParams,
  JoinChatChannelResponse,
  ListChatChannelMessagesParams,
  ListChatChannelMessagesResponse,
  CreateChatChannelMessageParams,
  CreateChatChannelMessageBody,
  CreateChatChannelMessageResponse,
  ListChatDirectMessagesParams,
  ListChatDirectMessagesResponse,
  CreateChatDirectMessageBody,
  CreateChatDirectMessageResponse,
  UploadChatAttachmentBody,
  UploadChatAttachmentResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { pushToUsers, getOnlineUserIds } from "../lib/realtime";

const router: IRouter = Router();

router.use(requireAuth);

// Module M31 (Messagerie Interne du Cabinet — "le Slack du Cabinet"): staff
// only. Portal accounts (client_pme / client_staff) never see this module,
// mirroring the sidebar's own cabinet/portal split in Shell.tsx.
router.use((req, res, next) => {
  if (isPortalRole(req.user!.role)) {
    res.status(403).json({ error: "Ce module est réservé au personnel du cabinet." });
    return;
  }
  next();
});

// Max ~4MB of raw file content (base64 inflates size by ~33%) -- keeps the
// Postgres-as-storage pattern (module M6/M26) usable without ballooning row
// sizes for this MVP scale.
const MAX_ATTACHMENT_BASE64_LENGTH = 5_500_000;

function attachmentUrl(mimeType: string | null, data: string | null): string | null {
  return data && mimeType ? `data:${mimeType};base64,${data}` : null;
}

function serializeMessage(
  msg: {
    id: number;
    createdAt: Date;
    messageText: string;
    attachmentFileName: string | null;
    attachmentMimeType: string | null;
    attachmentData: string | null;
  },
  channelId: number | null,
  recipientId: number | null,
  senderId: number,
  senderName: string,
  senderRole: string,
) {
  return {
    id: msg.id,
    channelId,
    recipientId,
    senderId,
    senderName,
    senderRole,
    messageText: msg.messageText,
    attachmentFileName: msg.attachmentFileName,
    attachmentMimeType: msg.attachmentMimeType,
    attachmentUrl: attachmentUrl(msg.attachmentMimeType, msg.attachmentData),
    createdAt: msg.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Colleagues (direct-message sidebar)
// ---------------------------------------------------------------------------

router.get("/chat/colleagues", async (req, res) => {
  const colleagues = await db.query.usersTable.findMany({
    where: eq(usersTable.firmId, req.user!.firmId),
    columns: { id: true, fullName: true, role: true },
  });

  const onlineIds = new Set(getOnlineUserIds(req.user!.firmId));

  res.json(
    ListChatColleaguesResponse.parse(
      colleagues
        .filter((u) => !isPortalRole(u.role) && u.id !== req.user!.id)
        .map((u) => ({ id: u.id, fullName: u.fullName, role: u.role, isOnline: onlineIds.has(u.id) })),
    ),
  );
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

async function channelMemberIds(channelId: number): Promise<number[]> {
  const rows = await db.query.chatChannelMembersTable.findMany({
    where: eq(chatChannelMembersTable.channelId, channelId),
    columns: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function serializeChannel(channel: typeof chatChannelsTable.$inferSelect, viewerId: number) {
  const [members, lastMessage, creator] = await Promise.all([
    db.query.chatChannelMembersTable.findMany({
      where: eq(chatChannelMembersTable.channelId, channel.id),
      with: { user: { columns: { id: true, fullName: true, role: true } } },
    }),
    db.query.chatChannelMessagesTable.findFirst({
      where: eq(chatChannelMessagesTable.channelId, channel.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    }),
    db.query.usersTable.findFirst({
      where: eq(usersTable.id, channel.createdById),
      columns: { fullName: true },
    }),
  ]);
  const onlineIds = new Set(getOnlineUserIds(channel.firmId));

  return {
    id: channel.id,
    firmId: channel.firmId,
    name: channel.name,
    description: channel.description,
    isPrivate: channel.isPrivate,
    memberCount: members.length,
    isMember: members.some((m) => m.userId === viewerId),
    createdByName: creator?.fullName ?? null,
    lastMessage: lastMessage?.messageText ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    createdAt: channel.createdAt,
    members: members.map((m) => ({
      id: m.user!.id,
      fullName: m.user!.fullName,
      role: m.user!.role,
      isOnline: onlineIds.has(m.user!.id),
    })),
  };
}

router.get("/chat/channels", async (req, res) => {
  const allChannels = await db.query.chatChannelsTable.findMany({
    where: eq(chatChannelsTable.firmId, req.user!.firmId),
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  const myMemberships = await db.query.chatChannelMembersTable.findMany({
    where: eq(chatChannelMembersTable.userId, req.user!.id),
    columns: { channelId: true },
  });
  const myChannelIds = new Set(myMemberships.map((m) => m.channelId));

  const visible = allChannels.filter((c) => !c.isPrivate || myChannelIds.has(c.id));

  const results = await Promise.all(visible.map((c) => serializeChannel(c, req.user!.id)));
  res.json(ListChatChannelsResponse.parse(results));
});

router.post("/chat/channels", async (req, res) => {
  const body = CreateChatChannelBody.parse(req.body);

  const existing = await db.query.chatChannelsTable.findFirst({
    where: and(eq(chatChannelsTable.firmId, req.user!.firmId), eq(chatChannelsTable.name, body.name)),
  });
  if (existing) {
    res.status(400).json({ error: "Un salon porte déjà ce nom." });
    return;
  }

  const [channel] = await db
    .insert(chatChannelsTable)
    .values({
      firmId: req.user!.firmId,
      name: body.name,
      description: body.description ?? null,
      isPrivate: body.isPrivate ?? false,
      createdById: req.user!.id,
    })
    .returning();

  const requestedMemberIds = (body.memberIds ?? []).filter((id) => id !== req.user!.id);
  let validMemberIds: number[] = [];
  if (requestedMemberIds.length > 0) {
    const candidates = await db.query.usersTable.findMany({
      where: eq(usersTable.firmId, req.user!.firmId),
      columns: { id: true, role: true },
    });
    const validIds = new Set(
      candidates.filter((u) => !isPortalRole(u.role)).map((u) => u.id),
    );
    validMemberIds = requestedMemberIds.filter((id) => validIds.has(id));
  }

  await db.insert(chatChannelMembersTable).values([
    { channelId: channel.id, userId: req.user!.id },
    ...validMemberIds.map((userId) => ({ channelId: channel.id, userId })),
  ]);

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.CHAT_CHANNEL_CREATE,
    entityType: "chat_channel",
    entityId: channel.id,
    details: `Création du salon "${channel.name}"${channel.isPrivate ? " (privé)" : ""}`,
    ipAddress: req.ip,
  });

  const detail = await serializeChannel(channel, req.user!.id);
  res.status(201).json(CreateChatChannelResponse.parse(detail));
});

router.get("/chat/channels/:id", async (req, res) => {
  const { id } = GetChatChannelParams.parse(req.params);

  const channel = await db.query.chatChannelsTable.findFirst({
    where: and(eq(chatChannelsTable.id, id), eq(chatChannelsTable.firmId, req.user!.firmId)),
  });
  if (!channel) {
    res.status(404).json({ error: "Salon introuvable." });
    return;
  }
  if (channel.isPrivate) {
    const memberIds = await channelMemberIds(channel.id);
    if (!memberIds.includes(req.user!.id)) {
      res.status(403).json({ error: "Ce salon est privé." });
      return;
    }
  }

  res.json(GetChatChannelResponse.parse(await serializeChannel(channel, req.user!.id)));
});

router.post("/chat/channels/:id/join", async (req, res) => {
  const { id } = JoinChatChannelParams.parse(req.params);

  const channel = await db.query.chatChannelsTable.findFirst({
    where: and(eq(chatChannelsTable.id, id), eq(chatChannelsTable.firmId, req.user!.firmId)),
  });
  if (!channel) {
    res.status(404).json({ error: "Salon introuvable." });
    return;
  }
  if (channel.isPrivate) {
    res.status(403).json({ error: "Ce salon est privé : seul un membre existant peut vous y ajouter." });
    return;
  }

  const existingMembership = await db.query.chatChannelMembersTable.findFirst({
    where: and(eq(chatChannelMembersTable.channelId, id), eq(chatChannelMembersTable.userId, req.user!.id)),
  });
  if (!existingMembership) {
    await db.insert(chatChannelMembersTable).values({ channelId: id, userId: req.user!.id });
  }

  res.json(JoinChatChannelResponse.parse(await serializeChannel(channel, req.user!.id)));
});

router.get("/chat/channels/:id/messages", async (req, res) => {
  const { id } = ListChatChannelMessagesParams.parse(req.params);

  const channel = await db.query.chatChannelsTable.findFirst({
    where: and(eq(chatChannelsTable.id, id), eq(chatChannelsTable.firmId, req.user!.firmId)),
  });
  if (!channel) {
    res.status(404).json({ error: "Salon introuvable." });
    return;
  }
  if (channel.isPrivate) {
    const memberIds = await channelMemberIds(channel.id);
    if (!memberIds.includes(req.user!.id)) {
      res.status(403).json({ error: "Ce salon est privé." });
      return;
    }
  }

  const messages = await db.query.chatChannelMessagesTable.findMany({
    where: eq(chatChannelMessagesTable.channelId, id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 200,
    with: { sender: { columns: { fullName: true, role: true } } },
  });

  res.json(
    ListChatChannelMessagesResponse.parse(
      messages
        .reverse()
        .map((m) => serializeMessage(m, id, null, m.senderId, m.sender?.fullName ?? "—", m.sender?.role ?? "—")),
    ),
  );
});

router.post("/chat/channels/:id/messages", async (req, res) => {
  const { id } = CreateChatChannelMessageParams.parse(req.params);
  const body = CreateChatChannelMessageBody.parse(req.body);

  const channel = await db.query.chatChannelsTable.findFirst({
    where: and(eq(chatChannelsTable.id, id), eq(chatChannelsTable.firmId, req.user!.firmId)),
  });
  if (!channel) {
    res.status(404).json({ error: "Salon introuvable." });
    return;
  }

  const memberIds = await channelMemberIds(channel.id);
  const isMember = memberIds.includes(req.user!.id);
  if (channel.isPrivate && !isMember) {
    res.status(403).json({ error: "Ce salon est privé." });
    return;
  }
  if (!isMember) {
    // Posting to a public channel you haven't joined yet joins you
    // automatically -- every cabinet colleague can participate in a public
    // channel without an explicit "Rejoindre" step first.
    await db.insert(chatChannelMembersTable).values({ channelId: channel.id, userId: req.user!.id });
    memberIds.push(req.user!.id);
  }

  const hasAttachment = !!(body.attachmentFileName && body.attachmentMimeType && body.attachmentData);

  const [message] = await db
    .insert(chatChannelMessagesTable)
    .values({
      channelId: channel.id,
      firmId: req.user!.firmId,
      senderId: req.user!.id,
      messageText: body.messageText,
      attachmentFileName: hasAttachment ? body.attachmentFileName : null,
      attachmentMimeType: hasAttachment ? body.attachmentMimeType : null,
      attachmentData: hasAttachment ? body.attachmentData : null,
    })
    .returning();

  const serialized = serializeMessage(message, channel.id, null, req.user!.id, req.user!.fullName, req.user!.role);

  pushToUsers(
    memberIds.filter((uid) => uid !== req.user!.id),
    { type: "chat:channel-message", payload: { channelId: channel.id, message: serialized } },
  );

  res.status(201).json(CreateChatChannelMessageResponse.parse(serialized));
});

// ---------------------------------------------------------------------------
// Direct messages
// ---------------------------------------------------------------------------

async function findColleague(firmId: number, userId: number) {
  const user = await db.query.usersTable.findFirst({
    where: and(eq(usersTable.id, userId), eq(usersTable.firmId, firmId)),
  });
  if (!user || isPortalRole(user.role)) return null;
  return user;
}

router.get("/chat/direct-messages/:userId", async (req, res) => {
  const { userId } = ListChatDirectMessagesParams.parse(req.params);

  const colleague = await findColleague(req.user!.firmId, userId);
  if (!colleague) {
    res.status(404).json({ error: "Collaborateur introuvable." });
    return;
  }

  const messages = await db.query.chatDirectMessagesTable.findMany({
    where: or(
      and(eq(chatDirectMessagesTable.senderId, req.user!.id), eq(chatDirectMessagesTable.recipientId, userId)),
      and(eq(chatDirectMessagesTable.senderId, userId), eq(chatDirectMessagesTable.recipientId, req.user!.id)),
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 200,
    with: { sender: { columns: { fullName: true, role: true } } },
  });

  await db
    .update(chatDirectMessagesTable)
    .set({ isRead: true })
    .where(
      and(
        eq(chatDirectMessagesTable.senderId, userId),
        eq(chatDirectMessagesTable.recipientId, req.user!.id),
        eq(chatDirectMessagesTable.isRead, false),
      ),
    );

  res.json(
    ListChatDirectMessagesResponse.parse(
      messages
        .reverse()
        .map((m) =>
          serializeMessage(m, null, m.recipientId, m.senderId, m.sender?.fullName ?? "—", m.sender?.role ?? "—"),
        ),
    ),
  );
});

router.post("/chat/direct-messages", async (req, res) => {
  const body = CreateChatDirectMessageBody.parse(req.body);

  if (body.recipientId === req.user!.id) {
    res.status(400).json({ error: "Impossible de s'envoyer un message à soi-même." });
    return;
  }
  const colleague = await findColleague(req.user!.firmId, body.recipientId);
  if (!colleague) {
    res.status(404).json({ error: "Collaborateur introuvable." });
    return;
  }

  const hasAttachment = !!(body.attachmentFileName && body.attachmentMimeType && body.attachmentData);

  const [message] = await db
    .insert(chatDirectMessagesTable)
    .values({
      firmId: req.user!.firmId,
      senderId: req.user!.id,
      recipientId: body.recipientId,
      messageText: body.messageText,
      attachmentFileName: hasAttachment ? body.attachmentFileName : null,
      attachmentMimeType: hasAttachment ? body.attachmentMimeType : null,
      attachmentData: hasAttachment ? body.attachmentData : null,
    })
    .returning();

  const serialized = serializeMessage(
    message,
    null,
    body.recipientId,
    req.user!.id,
    req.user!.fullName,
    req.user!.role,
  );

  pushToUsers([body.recipientId], { type: "chat:direct-message", payload: { message: serialized } });

  res.status(201).json(CreateChatDirectMessageResponse.parse(serialized));
});

// ---------------------------------------------------------------------------
// Attachment upload
// ---------------------------------------------------------------------------

router.post("/chat/upload", async (req, res) => {
  const body = UploadChatAttachmentBody.parse(req.body);

  if (body.fileData.length > MAX_ATTACHMENT_BASE64_LENGTH) {
    res.status(400).json({ error: "Le fichier dépasse la taille maximale autorisée (4 Mo)." });
    return;
  }

  res.json(
    UploadChatAttachmentResponse.parse({
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileData: body.fileData,
      previewUrl: `data:${body.mimeType};base64,${body.fileData}`,
    }),
  );
});

export default router;
