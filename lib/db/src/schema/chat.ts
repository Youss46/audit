import { boolean, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { usersTable } from "./users";

// Module M31 (Messagerie Interne du Cabinet — "le Slack du Cabinet"): an
// internal chat for cabinet staff only (expert_comptable / collaborateur /
// stagiaire), scoped to their own firm. Portal accounts (client_pme /
// client_staff, see isPortalRole in ./users) never have access -- this is
// staff-to-staff communication, distinct from module M26's client-facing
// contextual comments.
//
// Naming/architecture note: the product brief describes a standalone
// NestJS service with a dedicated WebSocket gateway, UUID primary keys,
// and a separate `Staff_Users` table. This codebase has none of those --
// one Express API, one WebSocket hub (see lib/realtime.ts), integer serial
// ids everywhere, and a single unified `usersTable` for every role. We
// follow the existing conventions instead of introducing a second stack:
// serial ids, `firmId` scoping, cabinet roles read directly off
// `usersTable`/`isPortalRole()`, and the M31 events multiplexed onto the
// same `/api/ws` hub rather than a second gateway.

// -- Channels -------------------------------------------------------------
export const chatChannelsTable = pgTable(
  "chat_channels",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Public channels: every cabinet member of the firm can see and join
    // them. Private channels: visible/joinable only to explicitly added
    // members (see chatChannelMembersTable).
    isPrivate: boolean("is_private").notNull().default(false),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("chat_channels_firm_name_unique").on(table.firmId, table.name),
    index("chat_channels_firm_id_idx").on(table.firmId),
  ],
);

export const insertChatChannelSchema = createInsertSchema(chatChannelsTable).pick({
  name: true,
  description: true,
  isPrivate: true,
});
export type InsertChatChannel = z.infer<typeof insertChatChannelSchema>;
export type ChatChannel = typeof chatChannelsTable.$inferSelect;

export const chatChannelMembersTable = pgTable(
  "chat_channel_members",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => chatChannelsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("chat_channel_members_unique").on(table.channelId, table.userId),
    index("chat_channel_members_user_id_idx").on(table.userId),
  ],
);

export type ChatChannelMember = typeof chatChannelMembersTable.$inferSelect;

// -- Channel messages -------------------------------------------------------
export const chatChannelMessagesTable = pgTable(
  "chat_channel_messages",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => chatChannelsTable.id, { onDelete: "cascade" }),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    messageText: text("message_text").notNull(),
    // Base64-encoded file content, following the same in-DB storage
    // pattern as module M6 (GED) and module M26's contextual comments --
    // no object storage wired up for this MVP scale.
    attachmentFileName: text("attachment_file_name"),
    attachmentMimeType: text("attachment_mime_type"),
    attachmentData: text("attachment_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_channel_messages_channel_id_idx").on(table.channelId, table.createdAt)],
);

export const insertChatChannelMessageSchema = createInsertSchema(chatChannelMessagesTable).pick({
  messageText: true,
  attachmentFileName: true,
  attachmentMimeType: true,
  attachmentData: true,
});
export type InsertChatChannelMessage = z.infer<typeof insertChatChannelMessageSchema>;
export type ChatChannelMessage = typeof chatChannelMessagesTable.$inferSelect;

// -- Direct messages --------------------------------------------------------
export const chatDirectMessagesTable = pgTable(
  "chat_direct_messages",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    messageText: text("message_text").notNull(),
    attachmentFileName: text("attachment_file_name"),
    attachmentMimeType: text("attachment_mime_type"),
    attachmentData: text("attachment_data"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_direct_messages_sender_recipient_idx").on(table.senderId, table.recipientId),
    index("chat_direct_messages_recipient_sender_idx").on(table.recipientId, table.senderId),
  ],
);

export const insertChatDirectMessageSchema = createInsertSchema(chatDirectMessagesTable).pick({
  recipientId: true,
  messageText: true,
  attachmentFileName: true,
  attachmentMimeType: true,
  attachmentData: true,
});
export type InsertChatDirectMessage = z.infer<typeof insertChatDirectMessageSchema>;
export type ChatDirectMessage = typeof chatDirectMessagesTable.$inferSelect;
