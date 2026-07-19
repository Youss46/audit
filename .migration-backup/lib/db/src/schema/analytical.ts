import {
  boolean,
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
import { journalLinesTable } from "./accounting";

// Module M23 — Multi-Dimensional Analytical Accounting
// (Comptabilité Analytique par Projet / Département)
//
// Three new tables:
//
// 1. analyticalAxesTable: grouping dimensions defined per client, e.g.
//    "Projets", "Départements", "Chantiers". A client can have multiple
//    axes active simultaneously.
//
// 2. analyticalCodesTable: the individual sections under an axis, e.g.
//    "Projet GexpA" (PRJ-GEXPA), "Pôle R&D" (DEP-RD). Each code carries a
//    short mnemonic code and a human-readable label.
//
// 3. analyticalAllocationsTable: links a journal line to one or more
//    analytical codes (ventilation). The sum of percentages across all
//    allocations for a single journal line must not exceed 100 %; the
//    remaining unallocated share is implicitly "non ventilé".

// ---------------------------------------------------------------------------
// Analytical Axes  (Les axes analytiques)
// ---------------------------------------------------------------------------

export const analyticalAxesTable = pgTable(
  "analytical_axes",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // e.g. "Projets", "Départements", "Chantiers"
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("analytical_axes_firm_id_idx").on(table.firmId),
    index("analytical_axes_client_id_idx").on(table.clientId),
  ],
);

export const insertAnalyticalAxisSchema = createInsertSchema(
  analyticalAxesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnalyticalAxis = z.infer<typeof insertAnalyticalAxisSchema>;
export type AnalyticalAxis = typeof analyticalAxesTable.$inferSelect;

// ---------------------------------------------------------------------------
// Analytical Codes  (Les sections analytiques)
// ---------------------------------------------------------------------------

export const analyticalCodesTable = pgTable(
  "analytical_codes",
  {
    id: serial("id").primaryKey(),
    axisId: integer("axis_id")
      .notNull()
      .references(() => analyticalAxesTable.id, { onDelete: "cascade" }),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // Short mnemonic, e.g. "PRJ-GEXPA", "DEP-RD", "CHAN-ABJ"
    code: text("code").notNull(),
    // Human-readable label, e.g. "Projet GexpA", "Pôle R&D"
    label: text("label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("analytical_codes_axis_id_idx").on(table.axisId),
    index("analytical_codes_firm_id_idx").on(table.firmId),
    index("analytical_codes_client_id_idx").on(table.clientId),
    // A code mnemonic must be unique within its axis.
    unique("analytical_codes_axis_code_unique").on(table.axisId, table.code),
  ],
);

export const insertAnalyticalCodeSchema = createInsertSchema(
  analyticalCodesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnalyticalCode = z.infer<typeof insertAnalyticalCodeSchema>;
export type AnalyticalCode = typeof analyticalCodesTable.$inferSelect;

// ---------------------------------------------------------------------------
// Analytical Allocations  (La ventilation analytique)
// ---------------------------------------------------------------------------

export const analyticalAllocationsTable = pgTable(
  "analytical_allocations",
  {
    id: serial("id").primaryKey(),
    // The journal line being split (typically Class 6 or 7).
    journalLineId: integer("journal_line_id")
      .notNull()
      .references(() => journalLinesTable.id, { onDelete: "cascade" }),
    analyticalCodeId: integer("analytical_code_id")
      .notNull()
      .references(() => analyticalCodesTable.id, { onDelete: "restrict" }),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // Ventilation percentage for this code (0 < pct <= 100).
    // Sum of all percentages for a given journalLineId must be <= 100.
    percentage: doublePrecision("percentage").notNull(),
    // Pre-computed allocated amount in FCFA (integer, same convention as the
    // rest of the ledger).  Recalculated whenever the allocation is saved.
    allocatedAmount: integer("allocated_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("analytical_alloc_journal_line_id_idx").on(table.journalLineId),
    index("analytical_alloc_code_id_idx").on(table.analyticalCodeId),
    index("analytical_alloc_firm_id_idx").on(table.firmId),
    index("analytical_alloc_client_id_idx").on(table.clientId),
  ],
);

export const insertAnalyticalAllocationSchema = createInsertSchema(
  analyticalAllocationsTable,
).omit({ id: true, createdAt: true });
export type InsertAnalyticalAllocation = z.infer<
  typeof insertAnalyticalAllocationSchema
>;
export type AnalyticalAllocation =
  typeof analyticalAllocationsTable.$inferSelect;
