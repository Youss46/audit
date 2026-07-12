import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A "firm" is an accounting firm (cabinet d'expertise-comptable). It is the
// tenant boundary for this application: every other domain table carries a
// firmId column and every query must be scoped by it.
export const firmsTable = pgTable("firms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertFirmSchema = createInsertSchema(firmsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFirm = z.infer<typeof insertFirmSchema>;
export type Firm = typeof firmsTable.$inferSelect;
