import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  usersTable,
  transactionsTable,
  documentsTable,
  vatDeclarationsTable,
  collaborationThreadsTable,
  contextualCommentsTable,
  notificationsTable,
  type CollaborationTargetType,
} from "@workspace/db";
import {
  CreateCommentBody,
  CreateCommentResponse,
  ListCommentsParams,
  ListCommentsResponse,
  ListThreadsQueryParams,
  ListThreadsResponse,
  ResolveThreadParams,
  ResolveThreadResponse,
  ListNotificationsResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { pushToUsers } from "../lib/realtime";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Target resolution: every discussable record type knows how to resolve its
// own firmId/clientId (for the ownership check) and a short French label
// (for the thread list / notification body) directly from targetId, so the
// API surface never needs the caller to pass clientId redundantly.
// ---------------------------------------------------------------------------

interface TargetOwner {
  firmId: number;
  clientId: number;
  label: string;
}

function formatDateFr(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR").format(d);
}

async function resolveTargetOwner(
  targetType: CollaborationTargetType,
  targetId: number,
): Promise<TargetOwner | null> {
  if (targetType === "TRANSACTION_LINE") {
    const tx = await db.query.transactionsTable.findFirst({
      where: eq(transactionsTable.id, targetId),
    });
    if (!tx) return null;
    return {
      firmId: tx.firmId,
      clientId: tx.clientId,
      label: `Écriture du ${formatDateFr(tx.date)} — ${tx.label}`,
    };
  }
  if (targetType === "PENDING_DOCUMENT") {
    const doc = await db.query.documentsTable.findFirst({
      where: eq(documentsTable.id, targetId),
    });
    if (!doc) return null;
    return {
      firmId: doc.firmId,
      clientId: doc.clientId,
      label: `Document — ${doc.fileName}`,
    };
  }
  // TAX_DECLARATION
  const vat = await db.query.vatDeclarationsTable.findFirst({
    where: eq(vatDeclarationsTable.id, targetId),
  });
  if (!vat) return null;
  return {
    firmId: vat.firmId,
    clientId: vat.clientId,
    label: `Déclaration TVA — période ${vat.period}`,
  };
}

async function findOrCreateThread(
  firmId: number,
  clientId: number,
  targetType: CollaborationTargetType,
  targetId: number,
) {
  const existing = await db.query.collaborationThreadsTable.findFirst({
    where: and(
      eq(collaborationThreadsTable.firmId, firmId),
      eq(collaborationThreadsTable.targetType, targetType),
      eq(collaborationThreadsTable.targetId, targetId),
    ),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(collaborationThreadsTable)
    .values({ firmId, clientId, targetType, targetId })
    .returning();
  return created;
}

function serializeComment(
  comment: typeof contextualCommentsTable.$inferSelect,
  userName: string,
  userRole: string,
) {
  const attachmentUrl =
    comment.attachmentData && comment.attachmentMimeType
      ? `data:${comment.attachmentMimeType};base64,${comment.attachmentData}`
      : null;
  return {
    id: comment.id,
    threadId: comment.threadId,
    clientId: comment.clientId,
    userId: comment.userId,
    userName,
    userRole,
    targetType: comment.targetType,
    targetId: comment.targetId,
    message: comment.message,
    attachmentFileName: comment.attachmentFileName,
    attachmentMimeType: comment.attachmentMimeType,
    attachmentUrl,
    createdAt: comment.createdAt,
  };
}

// Module M26 (Révision Collaborative & Chat Contextuel): "le Slack de la
// Révision Comptable" -- a firm accountant and the client's own client_pme
// user discuss a specific ledger line / pending document / tax
// declaration directly, instead of over email. Every mutating action here
// also drops a row in the Notification_Center and pushes a best-effort
// real-time event (see lib/realtime.ts) to the other side's open tabs.

router.post("/collaboration/comments", async (req, res) => {
  const body = CreateCommentBody.parse(req.body);

  if (!requireOwnClient(req, res, body.clientId)) return;

  const owner = await resolveTargetOwner(body.targetType, body.targetId);
  if (!owner || owner.firmId !== req.user!.firmId || owner.clientId !== body.clientId) {
    res.status(404).json({ error: "Enregistrement introuvable pour cette discussion." });
    return;
  }

  const hasAttachment = !!(body.attachmentFileName && body.attachmentMimeType && body.attachmentData);

  const thread = await findOrCreateThread(req.user!.firmId, body.clientId, body.targetType, body.targetId);

  const [comment] = await db
    .insert(contextualCommentsTable)
    .values({
      threadId: thread.id,
      firmId: req.user!.firmId,
      clientId: body.clientId,
      userId: req.user!.id,
      targetType: body.targetType,
      targetId: body.targetId,
      message: body.message,
      attachmentFileName: hasAttachment ? body.attachmentFileName : null,
      attachmentMimeType: hasAttachment ? body.attachmentMimeType : null,
      attachmentData: hasAttachment ? body.attachmentData : null,
    })
    .returning();

  // New activity on a resolved thread reopens the discussion automatically
  // -- a client replying (or the cabinet following up) after "Marquer
  // comme résolu" means the topic isn't actually closed anymore.
  await db
    .update(collaborationThreadsTable)
    .set({ isResolved: false, resolvedById: null, resolvedAt: null })
    .where(eq(collaborationThreadsTable.id, thread.id));

  // Determine who gets notified: a cabinet author notifies the client's
  // own portal user(s); a client author notifies the firm's accountants.
  // There's no per-record "assigned accountant" field to target more
  // narrowly than that across all three target types, so we notify every
  // active accountant/collaborateur of the firm (stagiaire excluded --
  // read-only role, module M9).
  const isClientAuthor = req.user!.role === "client_pme";
  const recipients = isClientAuthor
    ? await db.query.usersTable.findMany({
        where: and(eq(usersTable.firmId, req.user!.firmId), eq(usersTable.status, "active")),
        columns: { id: true, role: true },
      })
    : await db.query.usersTable.findMany({
        where: and(eq(usersTable.clientId, body.clientId), eq(usersTable.role, "client_pme")),
        columns: { id: true, role: true },
      });

  const recipientIds = recipients
    .filter((u) => (isClientAuthor ? u.role === "expert_comptable" || u.role === "collaborateur" : true))
    .map((u) => u.id)
    .filter((id) => id !== req.user!.id);

  const notifTitle = isClientAuthor
    ? "Nouveau message du client"
    : "Nouvelle demande de votre cabinet comptable";
  const notifBody = `${req.user!.fullName} : ${body.message}`.slice(0, 280);
  // A cabinet-authored comment notifies the client, whose only relevant
  // page is their portal; a client-authored comment notifies the cabinet,
  // which reviews it on the ledger's Révision Collaborative tab.
  const linkToRoute = isClientAuthor
    ? `/cabinet/client/${body.clientId}/revision?target=${body.targetType}:${body.targetId}`
    : "/portal";

  if (recipientIds.length > 0) {
    const createdNotifs = await db
      .insert(notificationsTable)
      .values(
        recipientIds.map((recipientId) => ({
          firmId: req.user!.firmId,
          recipientId,
          title: notifTitle,
          body: notifBody,
          linkToRoute,
        })),
      )
      .returning();

    for (const notif of createdNotifs) {
      pushToUsers([notif.recipientId], {
        type: "notification:new",
        payload: {
          id: notif.id,
          title: notif.title,
          body: notif.body,
          linkToRoute: notif.linkToRoute,
          createdAt: notif.createdAt.toISOString(),
        },
      });
    }
    pushToUsers(recipientIds, {
      type: "comment:new",
      payload: { targetType: body.targetType, targetId: body.targetId, clientId: body.clientId },
    });
  }

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.COLLABORATION_COMMENT_CREATE,
    entityType: "contextual_comment",
    entityId: comment.id,
    details: `Commentaire sur ${body.targetType} #${body.targetId} (${owner.label})`,
    ipAddress: req.ip,
  });

  res
    .status(201)
    .json(CreateCommentResponse.parse(serializeComment(comment, req.user!.fullName, req.user!.role)));
});

router.get("/collaboration/comments/:targetType/:targetId", async (req, res) => {
  const { targetType, targetId } = ListCommentsParams.parse(req.params);

  const owner = await resolveTargetOwner(targetType, targetId);
  if (!owner || owner.firmId !== req.user!.firmId) {
    res.status(404).json({ error: "Enregistrement introuvable pour cette discussion." });
    return;
  }
  if (!requireOwnClient(req, res, owner.clientId)) return;

  const thread = await db.query.collaborationThreadsTable.findFirst({
    where: and(
      eq(collaborationThreadsTable.firmId, req.user!.firmId),
      eq(collaborationThreadsTable.targetType, targetType),
      eq(collaborationThreadsTable.targetId, targetId),
    ),
    with: { resolvedBy: true },
  });

  const comments = thread
    ? await db.query.contextualCommentsTable.findMany({
        where: eq(contextualCommentsTable.threadId, thread.id),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
        with: { user: true },
      })
    : [];

  res.json(
    ListCommentsResponse.parse({
      threadId: thread?.id ?? null,
      targetType,
      targetId,
      clientId: owner.clientId,
      isResolved: thread?.isResolved ?? false,
      resolvedByName: thread?.resolvedBy?.fullName ?? null,
      resolvedAt: thread?.resolvedAt ?? null,
      targetLabel: owner.label,
      comments: comments.map((c) => serializeComment(c, c.user?.fullName ?? "—", c.user?.role ?? "—")),
    }),
  );
});

router.get("/collaboration/threads", async (req, res) => {
  const { clientId, unresolvedOnly } = ListThreadsQueryParams.parse(req.query);

  // A client_pme account only ever sees its own dossier's threads,
  // regardless of what clientId it passes.
  const effectiveClientId = req.user!.role === "client_pme" ? req.user!.clientId! : clientId;
  if (effectiveClientId && !requireOwnClient(req, res, effectiveClientId)) return;

  const conditions = [eq(collaborationThreadsTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(collaborationThreadsTable.clientId, effectiveClientId));
  if (unresolvedOnly) conditions.push(eq(collaborationThreadsTable.isResolved, false));

  const threads = await db.query.collaborationThreadsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
    with: { resolvedBy: true },
  });

  const results = await Promise.all(
    threads.map(async (thread) => {
      const comments = await db.query.contextualCommentsTable.findMany({
        where: eq(contextualCommentsTable.threadId, thread.id),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
        with: { user: true },
      });
      const owner = await resolveTargetOwner(thread.targetType, thread.targetId);
      const last = comments[0];
      return {
        id: thread.id,
        firmId: thread.firmId,
        clientId: thread.clientId,
        targetType: thread.targetType,
        targetId: thread.targetId,
        isResolved: thread.isResolved,
        resolvedByName: thread.resolvedBy?.fullName ?? null,
        resolvedAt: thread.resolvedAt,
        commentCount: comments.length,
        lastMessage: last?.message ?? null,
        lastMessageAt: last?.createdAt ?? null,
        lastAuthorRole: last?.user?.role ?? null,
        targetLabel: owner?.label ?? `${thread.targetType} #${thread.targetId}`,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      };
    }),
  );

  res.json(ListThreadsResponse.parse(results));
});

router.patch("/collaboration/threads/:targetType/:targetId/resolve", async (req, res) => {
  const { targetType, targetId } = ResolveThreadParams.parse(req.params);

  // Only cabinet staff empowered to act on the ledger may close a
  // discussion loop -- a client_pme raised the request, it isn't theirs
  // to dismiss, and a stagiaire is read-only (module M9).
  if (req.user!.role !== "expert_comptable" && req.user!.role !== "collaborateur") {
    res.status(403).json({ error: "Accès refusé pour ce rôle." });
    return;
  }

  const owner = await resolveTargetOwner(targetType, targetId);
  if (!owner || owner.firmId !== req.user!.firmId) {
    res.status(404).json({ error: "Discussion introuvable." });
    return;
  }

  const thread = await db.query.collaborationThreadsTable.findFirst({
    where: and(
      eq(collaborationThreadsTable.firmId, req.user!.firmId),
      eq(collaborationThreadsTable.targetType, targetType),
      eq(collaborationThreadsTable.targetId, targetId),
    ),
  });
  if (!thread) {
    res.status(404).json({ error: "Discussion introuvable." });
    return;
  }

  const [updated] = await db
    .update(collaborationThreadsTable)
    .set({ isResolved: true, resolvedById: req.user!.id, resolvedAt: new Date() })
    .where(eq(collaborationThreadsTable.id, thread.id))
    .returning();

  const threadComments = await db.query.contextualCommentsTable.findMany({
    where: eq(contextualCommentsTable.threadId, thread.id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { user: true },
  });
  const lastComment = threadComments[0];

  const clientUsers = await db.query.usersTable.findMany({
    where: and(eq(usersTable.clientId, owner.clientId), eq(usersTable.role, "client_pme")),
    columns: { id: true },
  });
  pushToUsers(
    clientUsers.map((u) => u.id),
    { type: "thread:resolved", payload: { targetType, targetId, clientId: owner.clientId } },
  );

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.COLLABORATION_THREAD_RESOLVE,
    entityType: "collaboration_thread",
    entityId: thread.id,
    details: `Discussion résolue sur ${targetType} #${targetId} (${owner.label})`,
    ipAddress: req.ip,
  });

  res.json(
    ResolveThreadResponse.parse({
      id: updated.id,
      firmId: updated.firmId,
      clientId: updated.clientId,
      targetType: updated.targetType,
      targetId: updated.targetId,
      isResolved: updated.isResolved,
      resolvedByName: req.user!.fullName,
      resolvedAt: updated.resolvedAt,
      commentCount: threadComments.length,
      lastMessage: lastComment?.message ?? null,
      lastMessageAt: lastComment?.createdAt ?? null,
      lastAuthorRole: lastComment?.user?.role ?? null,
      targetLabel: owner.label,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }),
  );
});

router.get("/collaboration/notifications", async (req, res) => {
  const notifs = await db.query.notificationsTable.findMany({
    where: eq(notificationsTable.recipientId, req.user!.id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 50,
  });
  res.json(ListNotificationsResponse.parse(notifs));
});

router.patch("/collaboration/notifications/:id/read", async (req, res) => {
  const { id } = MarkNotificationReadParams.parse(req.params);

  const notif = await db.query.notificationsTable.findFirst({
    where: and(eq(notificationsTable.id, id), eq(notificationsTable.recipientId, req.user!.id)),
  });
  if (!notif) {
    res.status(404).json({ error: "Notification introuvable." });
    return;
  }

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.id, id))
    .returning();

  res.json(MarkNotificationReadResponse.parse(updated));
});

router.patch("/collaboration/notifications/read-all", async (req, res) => {
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.recipientId, req.user!.id), eq(notificationsTable.isRead, false)));
  res.status(204).end();
});

export default router;
