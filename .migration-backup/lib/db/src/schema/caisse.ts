import { boolean, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { usersTable } from "./users";

// Module P6 (Un Pompiste = Une Caisse): for a STATION_SERVICE client, every
// POMPISTE staff member gets their own dedicated cash register, mapped to a
// personal SYSCOHADA sub-account of the class-5 "Caisse" master account
// (571100) -- 571101, 571102, etc. -- instead of everyone sharing one
// general 571 account. Kept as plain string constants (not an enum/table)
// because the numbering is purely sequential per client; see
// allocateStationServiceCashAccount in api-server/src/routes/staff.ts.
export const STATION_SERVICE_CASH_MASTER_ACCOUNT = "571100";
export const STATION_SERVICE_CASH_SUB_ACCOUNT_PREFIX = "5711";

// Module P5 (Caisse Terrain): physical cash-drawer control for a PME's
// field/shop cashiers, layered on top of the P3/M3 accounting ledger.
// A cash register tracks a running `currentBalance` that reflects real
// physical cash movements the instant they're recorded (Caisse Express
// quick entries) -- independent of the separate M3 cabinet approval
// workflow, which only governs when a movement is permanently booked into
// the general ledger. This lets a cashier trust the on-screen balance
// before the accountant has reviewed anything.
export const cashRegistersTable = pgTable(
  "cash_registers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    currentBalance: integer("current_balance").notNull().default(0),
    // Module P6: this register's personal SYSCOHADA sub-account (e.g.
    // "571101"), set only for a per-pompiste drawer. Null for a general/
    // shared register (the historical P5 behavior). Unique per client so
    // two staff members of the same PME can never collide on one number.
    syscohadaAccount: text("syscohada_account"),
    isActive: boolean("is_active").notNull().default(true),
    // Module P6: the one staff member (POMPISTE) this register is
    // dedicated to. Null for a general/shared register. Enforced 1:1 in
    // application code (staff.ts only ever creates one register per
    // owner); `onDelete: "set null"` so deleting the account never cascades
    // into losing the register's transaction history.
    ownerUserId: integer("owner_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("cash_registers_client_account_unique").on(table.clientId, table.syscohadaAccount)],
);

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
