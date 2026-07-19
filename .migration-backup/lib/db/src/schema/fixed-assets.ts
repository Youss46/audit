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

// Module M17 (Gestion des Immobilisations & Amortissements).
// SYSCOHADA Class 2 fixed asset registry with automated straight-line and
// declining-balance depreciation. The schedule is computed on-the-fly from
// these five core parameters so no schedule rows are ever stored --
// recomputing is instant and guarantees the table is always consistent
// with any parameter edit.

export const DEPRECIATION_TYPES = ["LINEAIRE", "DEGRESSIF"] as const;
export type DepreciationType = (typeof DEPRECIATION_TYPES)[number];

export const FIXED_ASSET_STATUSES = ["ACTIF", "RETIRE"] as const;
export type FixedAssetStatus = (typeof FIXED_ASSET_STATUSES)[number];

export const fixedAssetsTable = pgTable(
  "fixed_assets",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // SYSCOHADA Class 2 account (e.g. "241100" Matériel de transport,
    // "231000" Bâtiments, "211000" Immobilisations incorporelles).
    accountNumber: text("account_number").notNull(),
    // Human-readable designation (e.g. "Camion de livraison Toyota Hilux").
    label: text("label").notNull(),
    // Date the asset entered the balance sheet (drives prorata temporis
    // calculation for the first year's depreciation annuity).
    acquisitionDate: timestamp("acquisition_date", { withTimezone: true }).notNull(),
    // Valeur d'origine brute HT (gross cost excluding VAT), in FCFA.
    acquisitionCost: integer("acquisition_cost").notNull(),
    // "LINEAIRE" = straight-line; "DEGRESSIF" = declining-balance with
    // SYSCOHADA coefficients and automatic switch to linear when linear
    // gives a higher annuity.
    depreciationType: text("depreciation_type")
      .$type<DepreciationType | null>()
      .default("LINEAIRE"),
    // Durée d'utilisation économique (e.g. 5 for rolling stock, 20 for
    // buildings). Determines the annual linear rate and the schedule length.
    usefulLifeYears: integer("useful_life_years"),
    // Valeur résiduelle estimée en fin de vie (FCFA). Depreciation stops
    // when VNC reaches this floor. Default is 0 (fully depreciated).
    salvageValue: integer("salvage_value").notNull().default(0),
    status: text("status").notNull().$type<FixedAssetStatus>().default("ACTIF"),
    // Auto-sync provenance: when a validated accounting transaction contains a
    // Class 2 debit line, a pending stub is created and linked to that entry
    // so the accountant can trace the origin and complete the parameters.
    syncedFromTransactionId: integer("synced_from_transaction_id"),
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
    index("fixed_assets_firm_id_idx").on(table.firmId),
    index("fixed_assets_client_id_idx").on(table.clientId),
    index("fixed_assets_status_idx").on(table.status),
  ],
);

export const insertFixedAssetSchema = createInsertSchema(fixedAssetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFixedAsset = z.infer<typeof insertFixedAssetSchema>;
export type FixedAsset = typeof fixedAssetsTable.$inferSelect;

// -- Asset depreciation postings ---------------------------------------------
// One row per (asset, fiscal year) once a "Générer les dotations" run has
// booked that asset's annuity to the OD journal. This is the anti-duplicate
// boundary for /assets/generate-closings: a unique constraint on
// (assetId, fiscalYear) makes it impossible to silently double-post the same
// asset's dotation for the same exercice, and lets the route tell a genuinely
// "nothing new to do" re-run apart from a partial run that still has other
// assets left to post. No FK to `transactionsTable` (defined in
// accounting.ts) to avoid a schema-file import cycle -- same pattern as
// `postedTransactionId` on invoices/payslips/VAT declarations.
export const assetDepreciationPostingsTable = pgTable(
  "asset_depreciation_postings",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => fixedAssetsTable.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    transactionId: integer("transaction_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("asset_depreciation_postings_asset_year_unique").on(
      table.assetId,
      table.fiscalYear,
    ),
    index("asset_depreciation_postings_asset_id_idx").on(table.assetId),
  ],
);

export type AssetDepreciationPosting = typeof assetDepreciationPostingsTable.$inferSelect;
