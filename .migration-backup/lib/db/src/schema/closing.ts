import {
  boolean,
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

// Module M19 (Clôture d'Exercice Comptable): one row per firm/client/year,
// tracking the state of the year-end closing process. The status moves from
// OPEN (default, writable) to LOCKED (immutable). A LOCKED period blocks all
// new ledger entries dated within that year for the given client.
export const FISCAL_YEAR_CLOSING_STATUSES = ["OPEN", "LOCKED"] as const;
export type FiscalYearClosingStatus = (typeof FISCAL_YEAR_CLOSING_STATUSES)[number];

export const fiscalYearClosingsTable = pgTable(
  "fiscal_year_closings",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    status: text("status")
      .notNull()
      .$type<FiscalYearClosingStatus>()
      .default("OPEN"),
    // Signed FCFA amount: positive = bénéfice (131), negative = perte (139).
    // Null until the period is actually closed.
    netResult: integer("net_result"),
    // "131" (Résultat net bénéfice) or "139" (Résultat net perte).
    netResultAccount: text("net_result_account"),
    // True once the À-nouveaux entry for year+1 has been generated.
    openingBalanceGenerated: boolean("opening_balance_generated")
      .notNull()
      .default(false),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedById: integer("locked_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("fiscal_year_closings_firm_client_year_unique").on(
      table.firmId,
      table.clientId,
      table.year,
    ),
    index("fiscal_year_closings_client_id_idx").on(table.clientId),
    index("fiscal_year_closings_firm_id_idx").on(table.firmId),
  ],
);

export const insertFiscalYearClosingSchema = createInsertSchema(
  fiscalYearClosingsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFiscalYearClosing = z.infer<
  typeof insertFiscalYearClosingSchema
>;
export type FiscalYearClosing = typeof fiscalYearClosingsTable.$inferSelect;
