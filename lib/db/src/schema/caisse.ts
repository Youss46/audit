import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { usersTable } from "./users";

// Module P5 (Caisse Terrain): physical cash-drawer control for a PME's
// field/shop cashiers, layered on top of the P3/M3 accounting ledger.
// A cash register tracks a running `currentBalance` that reflects real
// physical cash movements the instant they're recorded (Caisse Express
// quick entries) -- independent of the separate M3 cabinet approval
// workflow, which only governs when a movement is permanently booked into
// the general ledger. This lets a cashier trust the on-screen balance
// before the accountant has reviewed anything.
export const cashRegistersTable = pgTable("cash_registers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  currentBalance: integer("current_balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCashRegisterSchema = createInsertSchema(cashRegistersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCashRegister = z.infer<typeof insertCashRegisterSchema>;
export type CashRegister = typeof cashRegistersTable.$inferSelect;

export const CLOSURE_STATUSES = ["OPEN", "CLOSED"] as const;
export type ClosureStatus = (typeof CLOSURE_STATUSES)[number];

// One row per register per calendar day ("Clôture de Caisse en 1 Tap").
// `expectedClosingBalance`/`discrepancyAmount` are only filled in once the
// closure is actually closed -- until then the theoretical balance is just
// the register's live `currentBalance`.
export const dailyClosuresTable = pgTable(
  "daily_closures",
  {
    id: serial("id").primaryKey(),
    cashRegisterId: integer("cash_register_id")
      .notNull()
      .references(() => cashRegistersTable.id, { onDelete: "cascade" }),
    // Calendar day this closure covers, "YYYY-MM-DD" (at most one closure
    // per register per day).
    date: text("date").notNull(),
    openingBalance: integer("opening_balance").notNull(),
    expectedClosingBalance: integer("expected_closing_balance"),
    physicalClosingBalance: integer("physical_closing_balance"),
    discrepancyAmount: integer("discrepancy_amount"),
    status: text("status").notNull().$type<ClosureStatus>().default("OPEN"),
    // Mandatory whenever discrepancyAmount is non-zero ("Justification").
    comment: text("comment"),
    closedById: integer("closed_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("daily_closures_register_date_unique").on(table.cashRegisterId, table.date)],
);

export const insertDailyClosureSchema = createInsertSchema(dailyClosuresTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDailyClosure = z.infer<typeof insertDailyClosureSchema>;
export type DailyClosure = typeof dailyClosuresTable.$inferSelect;
