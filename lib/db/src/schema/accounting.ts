import {
  type AnyPgColumn,
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
import { cashRegistersTable } from "./caisse";

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

// "settlement" is the second leg of a credit (accrual) operation -- the
// treasury movement generated when a PME marks an outstanding invoice as
// paid (module P3 "Factures en attente" -> "Marquer comme payé").
// "caisse_closure" is the écart de caisse (cash discrepancy) adjustment
// automatically generated when a Module P5 daily closure doesn't balance.
export const TRANSACTION_SOURCES = [
  "pme_entry",
  "manual_cabinet",
  "settlement",
  "caisse_closure",
] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const PAYMENT_METHODS = ["especes", "mobile_money", "cheque", "virement"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// "cash" (au comptant): the treasury account (571/521) is hit immediately.
// "credit" (à crédit): the operation first books against a third-party
// account (4111 Clients / 4011 Fournisseurs) and only touches treasury once
// settled -- strict SYSCOHADA accrual accounting, module P3/M3.
export const PAYMENT_TYPES = ["cash", "credit"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

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
    // "cash" (au comptant) or "credit" (à crédit) -- decides whether the
    // matching engine books straight to treasury or through a third-party
    // (411/401) account first. Defaults to "cash" for pre-existing rows.
    paymentType: text("payment_type").notNull().$type<PaymentType>().default("cash"),
    // Required for cash operations; null for credit operations until the
    // settlement leg is recorded (see paymentMethod on the settlement row).
    paymentMethod: text("payment_method").$type<PaymentMethod>(),
    // Required for credit operations ("Date d'échéance"); unused for cash.
    dueDate: timestamp("due_date", { withTimezone: true }),
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
    // Set once a credit operation's settlement has been requested (PME
    // clicked "Marquer comme payé"). The actual treasury entry lives in a
    // separate transaction row (source: "settlement", parentTransactionId
    // pointing back here) that still goes through the normal M3 review.
    settledAt: timestamp("settled_at", { withTimezone: true }),
    // Self-reference: set only on a "settlement" transaction, pointing back
    // to the original credit (accrual) operation it settles.
    parentTransactionId: integer("parent_transaction_id").references(
      (): AnyPgColumn => transactionsTable.id,
      { onDelete: "set null" },
    ),
    // Module P5 (Caisse Terrain): required whenever paymentMethod is
    // "especes" -- every physical cash movement must be tied to the
    // register it went in/out of, so that register's currentBalance stays
    // an accurate live count.
    cashRegisterId: integer("cash_register_id").references(() => cashRegistersTable.id, {
      onDelete: "set null",
    }),
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
    index("transactions_cash_register_id_idx").on(table.cashRegisterId),
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
