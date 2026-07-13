import {
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
import { documentsTable } from "./documents";

// Module P3/M3 (Comptabilité Simplifiée & Comptabilité et Travaux): a
// double-entry ledger bridging plain-language PME cash entries and the
// SYSCOHADA "plan comptable" used by the accounting firm.

// -- SYSCOHADA chart of accounts (plan comptable) ---------------------------
// One row per account number, seeded once per environment (see
// lib/db/src/seed-accounts.ts). Shared across every firm/tenant -- the chart
// of accounts itself is standardized by SYSCOHADA, not tenant-specific.
export const accountsTable = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    accountNumber: text("account_number").notNull(),
    name: text("name").notNull(),
    // SYSCOHADA account class, 1 to 9 (1: capitaux, 2: immobilisations,
    // 3: stocks, 4: tiers, 5: trésorerie, 6: charges, 7: produits, ...).
    accountClass: integer("account_class").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("accounts_account_number_unique").on(table.accountNumber)],
);

export const insertAccountSchema = createInsertSchema(accountsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;

// -- Journal entries (transactions) ------------------------------------------
export const TRANSACTION_TYPES = ["recette", "depense"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ["a_valider", "valide", "anomalie"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_SOURCES = ["pme_entry", "manual_cabinet"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const PAYMENT_METHODS = ["especes", "mobile_money", "cheque", "virement"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// A transaction is one plain-language cash movement (recette/dépense)
// declared either by the PME (module P3) or entered directly by the cabinet
// (module M3). The automated matching engine (lib/accounting-engine.ts)
// computes its journalLines at creation time from `category`/`type`/
// `paymentMethod`. Once `status` reaches "valide" it is permanently locked
// into the general ledger and can no longer be edited.
export const transactionsTable = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    label: text("label").notNull(),
    amount: integer("amount").notNull(),
    type: text("type").notNull().$type<TransactionType>(),
    // Plain-language PME category (e.g. "Loyer", "Vente de marchandises"),
    // null for a manual cabinet entry where the accountant picks accounts
    // directly instead of going through the matching engine.
    category: text("category"),
    paymentMethod: text("payment_method").$type<PaymentMethod>(),
    status: text("status").notNull().$type<TransactionStatus>().default("a_valider"),
    source: text("source").notNull().$type<TransactionSource>(),
    // Optional link to the supporting receipt/attachment already deposited
    // in the GED (module M6).
    documentId: integer("document_id").references(() => documentsTable.id, {
      onDelete: "set null",
    }),
    // Filled in by the cabinet when "Invalider" is used, so the PME knows
    // what to fix before resubmitting.
    clarificationNote: text("clarification_note"),
    createdById: integer("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    validatedById: integer("validated_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("transactions_firm_id_idx").on(table.firmId),
    index("transactions_client_id_idx").on(table.clientId),
    index("transactions_status_idx").on(table.status),
  ],
);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;

// -- Journal lines (double-entry debit/credit rows) -------------------------
// Always balanced in pairs per transaction: sum(debitAmount) === sum(creditAmount).
export const journalLinesTable = pgTable(
  "journal_lines",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactionsTable.id, { onDelete: "cascade" }),
    accountNumber: text("account_number").notNull(),
    debitAmount: integer("debit_amount").notNull().default(0),
    creditAmount: integer("credit_amount").notNull().default(0),
    label: text("label"),
  },
  (table) => [index("journal_lines_transaction_id_idx").on(table.transactionId)],
);

export const insertJournalLineSchema = createInsertSchema(journalLinesTable).omit({
  id: true,
});
export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;
export type JournalLine = typeof journalLinesTable.$inferSelect;
