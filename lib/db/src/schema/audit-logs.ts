import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";

// Module M9/M14 (Immutable Audit Trail & Activity Logging): who did what,
// when, and -- for modifications -- exactly what changed. Written
// exclusively by the append-only AuditLogService (see
// artifacts/api-server/src/lib/audit.ts); a Postgres trigger
// (audit_logs_prevent_mutation, see lib/db/src/enforce-audit-immutability.ts)
// rejects any UPDATE/DELETE against this table at the database level, so
// the guarantee holds even against a bug or a direct SQL client, not just
// the API layer.
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id"),
    userName: text("user_name"),
    userRole: text("user_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: text("details"),
    // Module M14: "before"/"after" snapshot for a modification, e.g. an
    // accountant overwriting an AI-extracted field (AI_OVERRIDE) or
    // adjusting a journal line's account number. Null for pure creations
    // or actions with no prior state to compare against.
    changesPayload: jsonb("changes_payload").$type<{
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
    } | null>(),
    ipAddress: text("ip_address"),
    // Module M14: correlates every row written during a single HTTP
    // request (see AsyncLocalStorage-based audit context), letting the
    // automatic safety-net interceptor detect whether a mutating request
    // already produced its own granular log entry before falling back to
    // a generic one.
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_logs_firm_id_idx").on(table.firmId)],
);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
