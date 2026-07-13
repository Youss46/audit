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
      .notNull()
      .$type<DepreciationType>()
      .default("LINEAIRE"),
    // Durée d'utilisation économique (e.g. 5 for rolling stock, 20 for
    // buildings). Determines the annual linear rate and the schedule length.
    usefulLifeYears: integer("useful_life_years").notNull(),
    // Valeur résiduelle estimée en fin de vie (FCFA). Depreciation stops
    // when VNC reaches this floor. Default is 0 (fully depreciated).
    salvageValue: integer("salvage_value").notNull().default(0),
    status: text("status").notNull().$type<FixedAssetStatus>().default("ACTIF"),
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
