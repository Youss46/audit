import { boolean, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";
import { usersTable } from "./users";

// Module M26 (Révision Collaborative & Chat Contextuel — "le Slack de la
// Révision Comptable"): lets the cabinet and the client discuss any
// specific accounting record (a ledger transaction, a pending/OCR
// document, a tax declaration) inline, instead of over email.
//
// Naming/comment note: the product brief names these "Contextual_Comments"
// / "Notification_Center". We keep that intent but follow this codebase's
// existing conventions (camelCase Drizzle tables, `xxxTable` export name,
// integer serial ids like every other domain table — not UUID, which
// would be inconsistent with the rest of the schema) rather than
// introducing a second ID scheme.
export const COLLABORATION_TARGET_TYPES = [
  "TRANSACTION_LINE",
  "PENDING_DOCUMENT",
  "TAX_DECLARATION",
] as const;
export type CollaborationTargetType = (typeof COLLABORATION_TARGET_TYPES)[number];

// -- Threads ------------------------------------------------------------
// One row per discussed record (firmId + targetType + targetId is unique).
// Kept separate from the comments themselves so "Marquer comme résolu" has
// a single place to live, and so the ledger/portal UIs can list open
// discussions (with a comment count) without scanning every comment row.
export const collaborationThreadsTable = pgTable(
  "collaboration_threads",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull().$type<CollaborationTargetType>(),
    targetId: integer("target_id").notNull(),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedById: integer("resolved_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Bumped every time a new comment lands — lets the UI sort/highlight
    // threads by recent activity without joining the comments table.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("collaboration_threads_target_unique").on(
      table.firmId,
      table.targetType,
      table.targetId,
    ),
    index("collaboration_threads_client_id_idx").on(table.clientId),
  ],
);

export type CollaborationThread = typeof collaborationThreadsTable.$inferSelect;

// -- Contextual comments (the chat messages) -----------------------------
export const contextualCommentsTable = pgTable(
  "contextual_comments",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => collaborationThreadsTable.id, { onDelete: "cascade" }),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull().$type<CollaborationTargetType>(),
    targetId: integer("target_id").notNull(),
    message: text("message").notNull(),
    // Base64-encoded file content, following the same in-DB storage
    // pattern as module M6 (GED) documents — no object storage wired up
    // for MVP scale. `attachmentUrl` from the product brief is exposed as
    // a data: URL to the frontend (see collaboration.ts route) so the UI
    // can still treat it as a single "link".
    attachmentFileName: text("attachment_file_name"),
    attachmentMimeType: text("attachment_mime_type"),
    attachmentData: text("attachment_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("contextual_comments_thread_id_idx").on(table.threadId),
    index("contextual_comments_target_idx").on(table.targetType, table.targetId),
  ],
);

export const insertContextualCommentSchema = createInsertSchema(contextualCommentsTable).omit({
  id: true,
  threadId: true,
  createdAt: true,
});
export type InsertContextualComment = z.infer<typeof insertContextualCommentSchema>;
export type ContextualComment = typeof contextualCommentsTable.$inferSelect;

// -- Notification center --------------------------------------------------
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    // Deep link the client should navigate to in order to open the exact
    // ledger line / document popup that triggered the notification.
    linkToRoute: text("link_to_route"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_recipient_id_idx").on(table.recipientId)],
);

export type Notification = typeof notificationsTable.$inferSelect;
