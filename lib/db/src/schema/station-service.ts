import { doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { usersTable } from "./users";
import { cashRegistersTable } from "./caisse";
import { transactionsTable, type PaymentMethod } from "./accounting";

// Module P7 (Un Pompiste = Un Shift): station-service pump-index readings
// (compteur début/fin de service) and their downstream fuel-sale
// validation, for STATION_SERVICE clients' POMPISTE staff.
//
// One row per "shift" = one pump + one fuel type over one service period.
// Two-step lifecycle, matching the two Espace PME action cards:
//   1. "Relevé d'index de pompe" creates the row (OPEN) with indexStart
//      (carried over server-side from that pump/fuel's last shift) and
//      indexEnd entered by the pompiste -- the sold volume is indexEnd -
//      indexStart.
//   2. "Ventes de carburant" finalizes it (VALIDATED): unit price, payment
//      method, and (for espèces) the physically counted cash -- posts the
//      SYSCOHADA sale entry through the same createTransactionEntry()
//      helper used by every other P3/P5 entry, then -- if the counted cash
//      differs from the theoretical sale value -- books that gap as a
//      standalone écart transaction, exactly like the P5 daily-closure
//      discrepancy flow (never edits the sale entry itself).
export const FUEL_TYPES = ["super", "gasoil"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const PUMP_SHIFT_STATUSES = ["OPEN", "VALIDATED"] as const;
export type PumpShiftStatus = (typeof PUMP_SHIFT_STATUSES)[number];

export const pumpShiftsTable = pgTable("pump_shifts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  // The pompiste's own P6 cash drawer, when they have one -- null until the
  // shift is validated with an "especes" payment method against a shared
  // register (kept in sync with the register createTransactionEntry() picks).
  cashRegisterId: integer("cash_register_id").references(() => cashRegistersTable.id, {
    onDelete: "set null",
  }),
  pumpLabel: text("pump_label").notNull(),
  fuelType: text("fuel_type").notNull().$type<FuelType>(),
  indexStart: doublePrecision("index_start").notNull(),
  indexEnd: doublePrecision("index_end").notNull(),
  status: text("status").notNull().$type<PumpShiftStatus>().default("OPEN"),
  // Filled in at validation ("Ventes de carburant").
  unitPrice: integer("unit_price"),
  // Legacy single-method field kept for records created before the split-payment
  // upgrade. Null for new multi-provider shifts; derived on read as needed.
  paymentMethod: text("payment_method").$type<PaymentMethod>(),
  expectedAmount: integer("expected_amount"),
  declaredPhysicalAmount: integer("declared_physical_amount"),
  discrepancyAmount: integer("discrepancy_amount"),
  // Module P7 split-payment breakdown (Mobile Money + Espèces).
  // Each field is the FCFA amount collected via that channel for this shift.
  // Their sum must equal expectedAmount. Null when not used (zero-value channel).
  cashAmount: integer("cash_amount"),
  waveAmount: integer("wave_amount"),
  orangeMoneyAmount: integer("orange_money_amount"),
  mtnMomoAmount: integer("mtn_momo_amount"),
  transactionId: integer("transaction_id").references(() => transactionsTable.id, {
    onDelete: "set null",
  }),
  discrepancyTransactionId: integer("discrepancy_transaction_id").references(
    () => transactionsTable.id,
    { onDelete: "set null" },
  ),
  openedById: integer("opened_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  validatedById: integer("validated_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPumpShiftSchema = createInsertSchema(pumpShiftsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPumpShift = z.infer<typeof insertPumpShiftSchema>;
export type PumpShift = typeof pumpShiftsTable.$inferSelect;
