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
import { documentsTable } from "./documents";

// Module M28 (Facturier Client & Auto-Génération de Pièces).
// Structured invoice registry for Espace PME clients: chronological invoice
// numbering (FAC-YYYY-XXXX, no gaps once issued), professional PDF receipt
// generation, and automatic SYSCOHADA double-entry posting on validation
// (Débit 411 Clients / Crédit 706 Prestations / Crédit 443 TVA Facturée).
//
// All monetary amounts are stored as integers in FCFA (matching every other
// table in this schema — no decimal currency).  VAT rates are stored as
// integer percentages (18 = 18 %).

export const INVOICE_STATUSES = ["BROUILLON", "VALIDE", "PARTIELLEMENT_PAYE", "PAYE", "ANNULE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export const invoicesTable = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // Chronological invoice number, assigned at validation time only.
    // NULL while the record is still a BROUILLON (draft).
    // Format: FAC-YYYY-XXXX (sequential per firm+client+year, no gaps).
    invoiceNumber: text("invoice_number"),
    // Buyer information (the PME's customer, not the cabinet's client).
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    customerAddress: text("customer_address"),
    // Totals computed server-side from invoice_items on every write.
    subtotalHt: integer("subtotal_ht").notNull().default(0),
    // Integer percentage — e.g. 18 means 18 %.  Per-item rates in invoice_items
    // can override this at the row level; this field is the invoice-wide default.
    vatRate: integer("vat_rate").notNull().default(18),
    vatAmount: integer("vat_amount").notNull().default(0),
    totalTtc: integer("total_ttc").notNull().default(0),
    invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: text("status").notNull().$type<InvoiceStatus>().default("BROUILLON"),
    notes: text("notes"),
    // PDF receipt auto-generated on validation, persisted in the documents
    // table (base64), then linked here.  NULL until the invoice is validated.
    pdfDocumentId: integer("pdf_document_id").references(() => documentsTable.id, {
      onDelete: "set null",
    }),
    // Transaction automatically posted on validation:
    // Débit 411 / Crédit 706 / Crédit 443100.  NULL until validated.
    postedTransactionId: integer("posted_transaction_id"),
    createdById: integer("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // Partial payment tracking: cumulative amount received so far (FCFA).
    // 0 until a first payment is recorded; equals totalTtc when fully paid.
    amountPaid: integer("amount_paid").notNull().default(0),
    // Set when a reminder email/notification is sent for this invoice.
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("invoices_firm_id_idx").on(table.firmId),
    index("invoices_client_id_idx").on(table.clientId),
    index("invoices_status_idx").on(table.status),
  ],
);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  invoiceNumber: true,
  subtotalHt: true,
  vatAmount: true,
  totalTtc: true,
  pdfDocumentId: true,
  postedTransactionId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

// ---------------------------------------------------------------------------
// Invoice Items (line items)
// ---------------------------------------------------------------------------
export const invoiceItemsTable = pgTable(
  "invoice_items",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    designation: text("designation").notNull(),
    quantity: integer("quantity").notNull().default(1),
    // Unit price HT in FCFA.
    unitPrice: integer("unit_price").notNull().default(0),
    // Row-level VAT rate (integer %).  Defaults to the invoice-level vatRate.
    vatRate: integer("vat_rate").notNull().default(18),
    // Computed: quantity × unit_price (HT, no VAT).
    totalItemHt: integer("total_item_ht").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("invoice_items_invoice_id_idx").on(table.invoiceId)],
);

export const insertInvoiceItemSchema = createInsertSchema(invoiceItemsTable).omit({
  id: true,
  totalItemHt: true,
  createdAt: true,
});
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Invoice Products Catalog (article / service library)
// ---------------------------------------------------------------------------
// Re-usable article/service definitions per cabinet (firm). When adding a line
// to a draft invoice the UI autocompletes from this catalog; designation,
// unit price and VAT rate are pre-filled and remain editable per-invoice.
export const invoiceProductsTable = pgTable(
  "invoice_products",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    designation: text("designation").notNull(),
    defaultUnitPrice: integer("default_unit_price").notNull().default(0),
    vatRate: integer("vat_rate").notNull().default(18),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("invoice_products_firm_id_idx").on(table.firmId)],
);

export type InvoiceProduct = typeof invoiceProductsTable.$inferSelect;
