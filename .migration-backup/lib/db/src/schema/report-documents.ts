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

// Module M25 (Générateur de Synthèses Financières & Documents Juridiques) —
// automated compilation of standard cabinet documents (rapport de gestion,
// lettre de commentaires, lettre de mission, synthèse de performance) from
// an HTML template with `{{PLACEHOLDER}}` tags that get hydrated with the
// client's real financial figures for the selected fiscal year (see
// artifacts/api-server/src/lib/document-hydrator.ts).
//
// Templates are global boilerplate shared across every firm (same
// convention as `accountsTable` / `dsfMappingRulesTable`) -- the wording is
// standardized administrative French, not tenant-specific. A cabinet
// generates a `Generated_Documents` row per client/year/template, edits the
// hydrated text in the in-app rich-text editor, then either saves further
// edits (status stays DRAFT) or finalizes it (status flips to FINAL,
// immutable from then on -- see the finalize route in
// artifacts/api-server/src/routes/report-documents.ts).

export const DOCUMENT_TEMPLATE_TYPES = [
  "RAPPORT_GESTION",
  "LETTRE_COMMENTAIRES",
  "LETTRE_MISSION",
  "SYNTHESE_PERFORMANCE",
] as const;
export type DocumentTemplateType = (typeof DOCUMENT_TEMPLATE_TYPES)[number];

export const GENERATED_DOCUMENT_STATUSES = ["DRAFT", "FINAL"] as const;
export type GeneratedDocumentStatus = (typeof GENERATED_DOCUMENT_STATUSES)[number];

export const documentTemplatesTable = pgTable(
  "document_templates",
  {
    id: serial("id").primaryKey(),
    templateType: text("template_type").notNull().$type<DocumentTemplateType>(),
    title: text("title").notNull(),
    // Rich HTML layout with `{{COMPANY_NAME}}`, `{{FISCAL_YEAR}}`,
    // `{{TURNOVER}}`, `{{NET_INCOME}}`, `{{EQUITY}}`, `{{CASH_BALANCE}}` and
    // a few comparison/context placeholders -- see document-hydrator.ts for
    // the exhaustive, authoritative list of supported tags.
    contentHtml: text("content_html").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("document_templates_title_unique").on(table.title),
    index("document_templates_type_idx").on(table.templateType),
  ],
);

export const generatedDocumentsTable = pgTable(
  "generated_documents",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    templateId: integer("template_id").notNull().references(() => documentTemplatesTable.id),
    // Denormalized at creation time so the document's category survives
    // even if the source template is later edited or removed.
    templateType: text("template_type").notNull().$type<DocumentTemplateType>(),
    year: integer("year").notNull(),
    title: text("title").notNull(),
    // The compiled-then-edited HTML -- the single source of truth rendered
    // by the WYSIWYG editor and by the on-demand PDF export. Not a
    // `document_url`: nothing is written to object storage, so a URL would
    // point nowhere -- the PDF is rendered fresh from this HTML every time
    // it's requested.
    contentHtml: text("content_html").notNull(),
    status: text("status").notNull().default("DRAFT").$type<GeneratedDocumentStatus>(),
    createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    index("generated_documents_firm_client_idx").on(table.firmId, table.clientId),
    index("generated_documents_client_year_idx").on(table.clientId, table.year),
  ],
);

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type DocumentTemplate = typeof documentTemplatesTable.$inferSelect;

export const insertGeneratedDocumentSchema = createInsertSchema(generatedDocumentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  finalizedAt: true,
});
export type InsertGeneratedDocument = z.infer<typeof insertGeneratedDocumentSchema>;
export type GeneratedDocument = typeof generatedDocumentsTable.$inferSelect;
