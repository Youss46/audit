import {
  boolean,
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
//
// Workflow (reviewStatus):
//   brouillon   — saved by PME but not yet submitted for cabinet review
//   en_attente  — submitted, waiting for cabinet accountant validation
//   valide      — cabinet has validated and locked the accounting entry

export const PURCHASE_PAYMENT_MODES = ["credit", "bank", "mobile_money"] as const;
export type PurchasePaymentMode = (typeof PURCHASE_PAYMENT_MODES)[number];

export const PURCHASE_STATUSES = ["pending", "settled"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_REVIEW_STATUSES = ["brouillon", "en_attente", "valide"] as const;
export type PurchaseReviewStatus = (typeof PURCHASE_REVIEW_STATUSES)[number];

// AIB rates used in Côte d'Ivoire (Acompte sur Impôts et Bénéfices).
// Stored as integer percentage points: 0, 2, or 7.
export const AIB_RATES = [0, 2, 7] as const;
export type AibRate = (typeof AIB_RATES)[number];

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
    // Denormalised for display without re-importing the engine on reads.
    // Overridable by cabinet accountant (correctedChargeAccount/Name).
    chargeAccount: text("charge_account").notNull(),
    chargeName: text("charge_name").notNull(),

    // -- Amounts -------------------------------------------------------------
    date: timestamp("date", { withTimezone: true }).notNull(),
    amountHt: integer("amount_ht").notNull(),
    vatRate: integer("vat_rate").notNull().default(0),    // 0 or 18
    vatAmount: integer("vat_amount").notNull().default(0),
    // AIB — Acompte sur Impôts et Bénéfices (retenue à la source, Côte d'Ivoire).
    // Rate stored as integer percent (0, 2, or 7); amount applied to amountTtc.
    aibRate: integer("aib_rate").notNull().default(0),
    aibAmount: integer("aib_amount").notNull().default(0),
    amountTtc: integer("amount_ttc").notNull(),

    // -- Payment info --------------------------------------------------------
    paymentMode: text("payment_mode").notNull().$type<PurchasePaymentMode>(),
    // Set when paymentMode = 'mobile_money' (links to a configured account)
    mobileMoneyAccountId: integer("mobile_money_account_id").references(
      () => mobileMoneyAccountsTable.id,
      { onDelete: "set null" },
    ),

    notes: text("notes"),

    // -- Receipt / Pièce justificative ----------------------------------------
    // Stored inline as base64 (same pattern as documentsTable). Presence is
    // exposed as `hasReceipt` in the API; the full base64 is only served on
    // GET /purchases/:id/receipt to avoid bloating list responses.
    receiptFileName: text("receipt_file_name"),
    receiptMimeType: text("receipt_mime_type"),
    receiptFileData: text("receipt_file_data"),   // base64

    // -- Lifecycle (payment) -------------------------------------------------
    // 'pending' for credit purchases awaiting settlement; 'settled' once paid
    status: text("status").notNull().$type<PurchaseStatus>().default("settled"),

    // -- Lifecycle (accounting workflow) -------------------------------------
    // brouillon → en_attente (submitted) → valide (cabinet-locked)
    reviewStatus: text("review_status")
      .notNull()
      .$type<PurchaseReviewStatus>()
      .default("en_attente"),

    // Lettrage: true once this supplier line has been matched against a
    // settlement in the grand-livre.
    isLettre: boolean("is_lettre").notNull().default(false),

    // Cabinet workflow: who validated and when; optionally corrected account.
    validatedById: integer("validated_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    // If the PME chose the wrong charge account, the cabinet can override it
    // here (the underlying journal line is updated atomically at validation).
    correctedChargeAccount: text("corrected_charge_account"),
    correctedChargeName: text("corrected_charge_name"),

    // The general-ledger transaction carrying the initial SYSCOHADA journal
    // lines for this purchase (Dr Charge/TVA / Cr 4011 or 5211 or 552xxx).
    transactionId: integer("transaction_id").references(() => transactionsTable.id, {
      onDelete: "set null",
    }),

    // Set once a credit purchase is settled: the settlement transaction
    // (Dr 4011 / Cr 4472 AIB / Cr 5211 or 552xxx).
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
    index("purchases_review_status_idx").on(table.reviewStatus),
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
