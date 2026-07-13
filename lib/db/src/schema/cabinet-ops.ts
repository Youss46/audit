import {
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";
import { usersTable } from "./users";

// Module M22 (Cabinet Internal Operations, Timesheet & Client Profitability).
//
// Three new tables:
// - cabinetUserRatesTable: per-collaborator cost/billing rates (one row per
//   user, upserted -- never historized, since the profitability engine
//   always reads the *current* rate; a future module could add history if
//   the cabinet needs point-in-time accuracy for past months).
// - clientContractsTable: the monthly flat fee (forfait) invoiced to a
//   client, with a validity window (a client can have multiple contracts
//   over time as the forfait is renegotiated).
// - timesheetEntriesTable: one row per collaborator per day per client per
//   task, logged by the collaborator themselves.

export const TASK_TYPES = [
  "SAISIE",
  "REVISION",
  "CONSEIL",
  "SOCIAL",
  "FISCALITE",
  "ADMINISTRATIF",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

// One row per collaborator: their loaded internal cost rate and the
// theoretical rate the cabinet would bill a client for their time.
export const cabinetUserRatesTable = pgTable(
  "cabinet_user_rates",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Coût horaire brut chargé du collaborateur (FCFA/h).
    hourlyCostRate: doublePrecision("hourly_cost_rate").notNull(),
    // Tarif horaire théorique facturable aux clients (FCFA/h).
    billingHourlyRate: doublePrecision("billing_hourly_rate").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("cabinet_user_rates_user_id_unique").on(table.userId),
    index("cabinet_user_rates_firm_id_idx").on(table.firmId),
  ],
);

export const insertCabinetUserRateSchema = createInsertSchema(cabinetUserRatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCabinetUserRate = z.infer<typeof insertCabinetUserRateSchema>;
export type CabinetUserRate = typeof cabinetUserRatesTable.$inferSelect;

// The forfait mensuel (monthly flat fee) invoiced to a client. A client can
// have several contracts over time (e.g. renegotiated fee); the one whose
// [startDate, endDate) window covers the reporting month is used.
export const clientContractsTable = pgTable(
  "client_contracts",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // Forfait mensuel facturé au client (FCFA/mois).
    monthlyFlatFee: doublePrecision("monthly_flat_fee").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    // Null = still active (no end date set yet).
    endDate: timestamp("end_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("client_contracts_firm_id_idx").on(table.firmId),
    index("client_contracts_client_id_idx").on(table.clientId),
  ],
);

export const insertClientContractSchema = createInsertSchema(clientContractsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientContract = z.infer<typeof insertClientContractSchema>;
export type ClientContract = typeof clientContractsTable.$inferSelect;

// One row per collaborator/day/client/task -- the atomic timesheet entry
// collaborators log through the weekly input grid.
export const timesheetEntriesTable = pgTable(
  "timesheet_entries",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    // e.g. 1.5 for 1h30.
    durationHours: doublePrecision("duration_hours").notNull(),
    taskType: text("task_type").notNull().$type<TaskType>(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("timesheet_entries_firm_id_idx").on(table.firmId),
    index("timesheet_entries_user_id_idx").on(table.userId),
    index("timesheet_entries_client_id_idx").on(table.clientId),
    index("timesheet_entries_date_idx").on(table.date),
  ],
);

export const insertTimesheetEntrySchema = createInsertSchema(timesheetEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTimesheetEntry = z.infer<typeof insertTimesheetEntrySchema>;
export type TimesheetEntry = typeof timesheetEntriesTable.$inferSelect;
