import { doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { usersTable } from "./users";
import { cashRegistersTable } from "./caisse";
import { transactionsTable, type PaymentMethod } from "./accounting";
import { stationsTable } from "./stations";

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
  // Multi-station (P8): denormalized from the pump at shift creation time
  // to allow per-station reporting without a join through pumps.
  stationId: integer("station_id").references(() => stationsTable.id, {
    onDelete: "set null",
  }),
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
  // Filled in at validation ("Ventes de carburant"), copied server-side from
  // fuelPricesTable at that moment -- never accepted from the client.
  unitPrice: doublePrecision("unit_price"),
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

// Module P7 (Calibration initiale): one row per physical pump/fuel-type
// combination registered by the PME owner. Stores the initial meter reading
// (initial_index) so the very first shift has a meaningful start value
// instead of 0. After the first shift is validated, the last-index fallback
// switches to pumpShiftsTable.indexEnd automatically.
export const pumpsTable = pgTable("pumps", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  // Multi-station (P8): every pump belongs to one physical station.
  // Nullable for backward compatibility with pre-multi-station pumps.
  stationId: integer("station_id").references(() => stationsTable.id, {
    onDelete: "set null",
  }),
  label: text("label").notNull(),
  fuelType: text("fuel_type").notNull().$type<FuelType>(),
  // Physical meter reading at the moment this pump was registered on the
  // platform.  Serves as indexStart for the very first shift only.
  initialIndex: doublePrecision("initial_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPumpSchema = createInsertSchema(pumpsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPump = z.infer<typeof insertPumpSchema>;
export type Pump = typeof pumpsTable.$inferSelect;

// Module P7 (Attributions de pompes): one row per pompiste-pump pair for a
// given service day.  The PME owner creates these before each shift so that
// each pompiste can only enter readings for the pump(s) assigned to them.
// shiftDate is stored as a plain "YYYY-MM-DD" text string (server-side local
// date) — no timezone issues, always matches the date the manager intended.
export const pumpAssignmentsTable = pgTable("pump_assignments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  pumpId: integer("pump_id")
    .notNull()
    .references(() => pumpsTable.id, { onDelete: "cascade" }),
  staffUserId: integer("staff_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // ISO date string YYYY-MM-DD — the day this assignment covers.
  shiftDate: text("shift_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PumpAssignment = typeof pumpAssignmentsTable.$inferSelect;

// Module P7 (Sécurisation du prix carburant): one row per client + fuel
// type, holding the currently active selling price per litre. Writable
// exclusively by the PME owner ("client_pme") from the "Prix du carburant"
// settings screen. The "Ventes de carburant" validation form reads this
// value server-side to compute the expected sale amount -- it is never
// accepted from the client, so a pompiste can neither see an editable price
// field nor influence "Montant attendu" by tampering with the request body.
export const fuelPricesTable = pgTable("fuel_prices", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  fuelType: text("fuel_type").notNull().$type<FuelType>(),
  // Decimal FCFA price per litre (e.g. 810.50).
  unitPrice: doublePrecision("unit_price").notNull(),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFuelPriceSchema = createInsertSchema(fuelPricesTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertFuelPrice = z.infer<typeof insertFuelPriceSchema>;
export type FuelPrice = typeof fuelPricesTable.$inferSelect;
