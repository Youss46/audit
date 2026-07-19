import {
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";
import { usersTable } from "./users";

// Module M18 (Immobilisations Financières & Emprunts).
// SYSCOHADA Class 1 (Emprunts, e.g. "161100") and Class 2 (Immobilisations
// financières, e.g. "274000") items whose repayment/collection follows a
// standard bank amortization schedule (tableau d'amortissement financier).
// Like Module M17's fixed assets, the schedule is computed on-the-fly from
// the five core financial parameters below -- no schedule rows are stored,
// so editing a parameter instantly recomputes every future installment.
// `installmentsPosted` is the one piece of mutable state we DO persist: it
// is the boundary between "already booked to the general ledger" and
// "still to come", incremented only by the generate-journal-entries route.

export const FINANCIAL_ITEM_TYPES = ["IMMOBILISATION_FINANCIERE", "EMPRUNT_BANCAIRE"] as const;
export type FinancialItemType = (typeof FINANCIAL_ITEM_TYPES)[number];

export const PAYMENT_FREQUENCIES = ["MENSUEL", "TRIMESTRIEL", "ANNUEL"] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const FINANCIAL_ITEM_STATUSES = ["ACTIF", "SOLDE"] as const;
export type FinancialItemStatus = (typeof FINANCIAL_ITEM_STATUSES)[number];

export const financialAssetsLoansTable = pgTable(
  "financial_assets_loans",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // "EMPRUNT_BANCAIRE" (Classe 16, e.g. "161100") or
    // "IMMOBILISATION_FINANCIERE" (Classe 27, e.g. "274000" Prêts au
    // personnel, "275000" Dépôts et cautionnements versés).
    type: text("type").notNull().$type<FinancialItemType>(),
    accountNumber: text("account_number").notNull(),
    // e.g. "Emprunt BOA Rénovation" or "Dépôt de garantie Loyer".
    label: text("label").notNull(),
    // Montant nominal initial, in FCFA.
    principalAmount: integer("principal_amount").notNull(),
    // Taux d'intérêt annuel en % (e.g. 8.5 for 8.5%). 0 for non-interest
    // financial assets such as a simple rental deposit.
    annualInterestRate: doublePrecision("annual_interest_rate").notNull().default(0),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    termMonths: integer("term_months").notNull(),
    paymentFrequency: text("payment_frequency")
      .notNull()
      .$type<PaymentFrequency>()
      .default("MENSUEL"),
    status: text("status").notNull().$type<FinancialItemStatus>().default("ACTIF"),
    // Number of installments already booked to the general ledger via
    // POST /finance/generate-journal-entries. The schedule engine treats
    // installments 1..installmentsPosted as posted and anything beyond as
    // still due -- this is what prevents a re-run from double-booking.
    installmentsPosted: integer("installments_posted").notNull().default(0),
    createdById: integer("created_by_id").references(() => usersTable.id, {
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
    index("financial_assets_loans_firm_id_idx").on(table.firmId),
    index("financial_assets_loans_client_id_idx").on(table.clientId),
    index("financial_assets_loans_type_idx").on(table.type),
    index("financial_assets_loans_status_idx").on(table.status),
  ],
);

export const insertFinancialItemSchema = createInsertSchema(financialAssetsLoansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFinancialItem = z.infer<typeof insertFinancialItemSchema>;
export type FinancialItem = typeof financialAssetsLoansTable.$inferSelect;
