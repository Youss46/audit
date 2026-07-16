import {
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
import { transactionsTable } from "./accounting";
import { mobileMoneyAccountsTable } from "./mobile-money";

// -- Dépenses & Achats (hors Caisse Terrain) ---------------------------------
// Records supplier purchases paid via Bank, Mobile Money, or on credit (à
// crédit). Each purchase generates a balanced SYSCOHADA journal entry posted
// to the general ledger (transactionsTable). Credit purchases start as
// "pending" and become "settled" once a separate settlement transaction is
// recorded (Dr 4011 / Cr 5211 or 552xxx).

export const PURCHASE_PAYMENT_MODES = ["credit", "bank", "mobile_money"] as const;
export type PurchasePaymentMode = (typeof PURCHASE_PAYMENT_MODES)[number];

export const PURCHASE_STATUSES = ["pending", "settled"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const purchasesTable = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),

    // -- Supplier info -------------------------------------------------------
    supplierName: text("supplier_name").notNull(),
    // Numéro de Compte Contribuable (NCC) — optional
    supplierNcc: text("supplier_ncc"),
    // Supplier's own invoice/document reference
    invoiceRef: text("invoice_ref"),

    // -- Expense classification -----------------------------------------------
    // Key into PURCHASE_CATEGORIES (accounting-engine.ts)
    categoryKey: text("category_key").notNull(),
    // Denormalised for display without re-importing the engine on reads
    chargeAccount: text("charge_account").notNull(),
    chargeName: text("charge_name").notNull(),

    // -- Amounts -------------------------------------------------------------
    date: timestamp("date", { withTimezone: true }).notNull(),
    amountHt: integer("amount_ht").notNull(),
    vatRate: integer("vat_rate").notNull().default(0),   // 0 or 18
    vatAmount: integer("vat_amount").notNull().default(0),
    amountTtc: integer("amount_ttc").notNull(),

    // -- Payment info --------------------------------------------------------
    paymentMode: text("payment_mode").notNull().$type<PurchasePaymentMode>(),
    // Set when paymentMode = 'mobile_money' (links to a configured account)
    mobileMoneyAccountId: integer("mobile_money_account_id").references(
      () => mobileMoneyAccountsTable.id,
      { onDelete: "set null" },
    ),

    notes: text("notes"),

    // -- Lifecycle -----------------------------------------------------------
    // 'pending' for credit purchases awaiting settlement; 'settled' once paid
    status: text("status").notNull().$type<PurchaseStatus>().default("settled"),

    // The general-ledger transaction carrying the initial SYSCOHADA journal
    // lines for this purchase (Dr Charge/TVA / Cr 4011 or 5211 or 552xxx).
    transactionId: integer("transaction_id").references(() => transactionsTable.id, {
      onDelete: "set null",
    }),

    // Set once a credit purchase is settled: the settlement transaction
    // (Dr 4011 / Cr 5211 or 552xxx).
    settlementTransactionId: integer("settlement_transaction_id").references(
      () => transactionsTable.id,
      { onDelete: "set null" },
    ),
    settledAt: timestamp("settled_at", { withTimezone: true }),

    createdById: integer("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("purchases_client_id_idx").on(table.clientId),
    index("purchases_status_idx").on(table.status),
    index("purchases_date_idx").on(table.date),
  ],
);

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type PurchaseRow = typeof purchasesTable.$inferSelect;
