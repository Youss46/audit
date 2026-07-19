import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { missionsTable } from "./missions";

// Dynamic control checklist generated per mission based on the SYSCOHADA
// accounting system (SMT / ALLEGE / NORMAL).
export const CHECKLIST_ITEM_STATUSES = [
  "a_verifier",
  "conforme",
  "anomalie",
] as const;
export type ChecklistItemStatusValue = (typeof CHECKLIST_ITEM_STATUSES)[number];

export const checklistItemsTable = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id")
    .notNull()
    .references(() => missionsTable.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull(),
  label: text("label").notNull(),
  status: text("status")
    .notNull()
    .$type<ChecklistItemStatusValue>()
    .default("a_verifier"),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertChecklistItemSchema = createInsertSchema(
  checklistItemsTable,
).omit({ id: true, updatedAt: true });
export type InsertChecklistItem = z.infer<typeof insertChecklistItemSchema>;
export type ChecklistItem = typeof checklistItemsTable.$inferSelect;
