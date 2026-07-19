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
import { transactionsTable } from "./accounting";

// Module M21 (Télédéclaration TVA - Formulaire D-201/VA): one row per
// firm/client/period, snapshotting the Section A/B/C figures computed by
// artifacts/api-server/src/lib/vat-engine.ts at the moment the accountant
// posted the liquidation entry. GET endpoints for *viewing* the declaration
// always recompute live from the validated ledger (same pattern as M19's
// closing-status) -- a row here only exists once "Générer l'écriture
// comptable de liquidation" has actually been used, so it is both the
// snapshot of what was declared and the anti-double-post boundary via
// postedTransactionId.
export const vatDeclarationsTable = pgTable(
  "vat_declarations",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // Période de déclaration mensuelle, format "YYYY-MM" (ex: "2026-07").
    period: text("period").notNull(),

    // -- Section A : Chiffre d'affaires & TVA collectée --
    caHt18: integer("ca_ht_18").notNull(),
    caHt9: integer("ca_ht_9").notNull(),
    caExoneree: integer("ca_exoneree").notNull(),
    caExport: integer("ca_export").notNull(),
    tvaCollectee18: integer("tva_collectee_18").notNull(),
    tvaCollectee9: integer("tva_collectee_9").notNull(),

    // -- Section B : TVA déductible --
    tvaDeductibleImmo: integer("tva_deductible_immo").notNull(),
    tvaDeductibleBiensServices: integer("tva_deductible_biens_services").notNull(),

    // -- Section C : Liquidation --
    // Crédit de TVA reporté du mois précédent (Section C, ligne "report").
    creditAnterieurReporte: integer("credit_anterieur_reporte").notNull().default(0),
    // TVA nette à payer (444100) -- 0 si le mois dégage un crédit.
    tvaNetteAPayer: integer("tva_nette_a_payer").notNull().default(0),
    // Nouveau crédit de TVA à reporter au mois suivant (445400) -- 0 si le
    // mois est en position de paiement.
    creditATNouveauReporter: integer("credit_a_nouveau_reporter").notNull().default(0),

    // Set once the liquidation entry (débit 443, crédit 445/444) has been
    // posted -- prevents re-posting the same period twice.
    postedTransactionId: integer("posted_transaction_id").references(
      () => transactionsTable.id,
      { onDelete: "set null" },
    ),
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
    index("vat_declarations_firm_id_idx").on(table.firmId),
    index("vat_declarations_client_id_idx").on(table.clientId),
    index("vat_declarations_period_idx").on(table.period),
    // One posted declaration per firm/client/period -- recomputation before
    // posting is always live, so this only guards the actually-posted row.
    unique("vat_declarations_firm_client_period_unique").on(
      table.firmId,
      table.clientId,
      table.period,
    ),
  ],
);

export const insertVatDeclarationSchema = createInsertSchema(vatDeclarationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVatDeclaration = z.infer<typeof insertVatDeclarationSchema>;
export type VatDeclaration = typeof vatDeclarationsTable.$inferSelect;
