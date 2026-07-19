import {
  boolean,
  doublePrecision,
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
import { usersTable } from "./users";

// Module M21-Settings: Cabinet-level VAT rate & SYSCOHADA account configuration.
//
// Each row defines one VAT code available to the cabinet's clients. On first
// access the backend lazy-seeds a firm's settings from the statutory Ivorian
// defaults; accountants can then adjust rate percentages or target accounts if
// legislation changes (e.g. a new rate decree, or an internal SYSCOHADA
// chart-of-accounts customisation).
//
// The invoicing engine (invoicing.ts / validate route) reads salesAccount from
// the matching row when posting the TVA collectée journal line, instead of
// hardcoding "443100". The vat-engine (liquidation builder) reads the
// configured accounts when building the periodic liquidation OD entry.
//
// Fields:
//  code            — stable machine key (e.g. "TVA_18", "TVA_9", "TVA_EXO")
//  label           — French display label shown in dropdowns and the settings UI
//  ratePercentage  — plain percentage value (18.0, 9.0, 0.0) — NOT a fraction
//  salesAccount    — SYSCOHADA account credited for TVA collectée (e.g. "443100")
//                    null for zero-rated / exempt codes that post no VAT line
//  purchaseAccount — SYSCOHADA account debited for TVA déductible sur biens &
//                    services (e.g. "445200"). The immobilisation sub-account
//                    (445100) is a structural asset-type distinction handled
//                    separately in the accounting engine.
//  isActive        — whether this code is available in dropdowns/invoicing
//  isEditable      — false for statutory codes (TVA_EXO) the cabinet cannot alter
//  updatedById     — audit trail: last cabinet user who modified this row

export const vatSettingsTable = pgTable(
  "vat_settings",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    // Stable machine code — never changes after insert (used by engines as key)
    code: text("code").notNull(),
    // French display label (e.g. "TVA Normale 18%")
    label: text("label").notNull(),
    // VAT rate as a plain percentage (18.0, 9.0, 0.0) — NOT a decimal fraction
    ratePercentage: doublePrecision("rate_percentage").notNull(),
    // SYSCOHADA credit account for TVA collectée on invoices/sales
    // Null for exempt / zero-rated codes where no TVA line is posted.
    salesAccount: text("sales_account"),
    // SYSCOHADA debit account for TVA déductible on regular goods & services
    // Null for exempt codes. (Immobilisation sub-account 445100 is handled
    // separately in the accounting engine, not via this field.)
    purchaseAccount: text("purchase_account"),
    // Whether this code is selectable in invoice / accounting dropdowns
    isActive: boolean("is_active").notNull().default(true),
    // Whether the cabinet can edit this row (false for TVA_EXO — statutory)
    isEditable: boolean("is_editable").notNull().default(true),
    // Audit trail: last cabinet accountant who modified this row
    updatedById: integer("updated_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("vat_settings_firm_id_idx").on(table.firmId),
    // One row per (firm, code) — prevents duplicates from concurrent lazy-seeds
    unique("vat_settings_firm_code_unique").on(table.firmId, table.code),
  ],
);

export const insertVatSettingSchema = createInsertSchema(vatSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVatSetting = z.infer<typeof insertVatSettingSchema>;
export type VatSetting = typeof vatSettingsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Statutory Ivorian defaults — seeded per firm on first access.
// Mirrors the hardcoded constants in vat-engine.ts.
// ---------------------------------------------------------------------------
export const VAT_SETTING_DEFAULTS: Omit<InsertVatSetting, "firmId" | "updatedById">[] = [
  {
    code: "TVA_18",
    label: "TVA Normale 18%",
    ratePercentage: 18,
    salesAccount: "443100",    // TVA collectée, taux normal (SYSCOHADA)
    purchaseAccount: "445200", // TVA déductible sur biens et services
    isActive: true,
    isEditable: true,
  },
  {
    code: "TVA_9",
    label: "TVA Réduite 9%",
    ratePercentage: 9,
    salesAccount: "443200",    // TVA collectée, taux réduit (SYSCOHADA)
    purchaseAccount: "445200", // TVA déductible sur biens et services
    isActive: true,
    isEditable: true,
  },
  {
    code: "TVA_EXO",
    label: "Exonéré de TVA",
    ratePercentage: 0,
    salesAccount: null,    // No TVA account posted for exempt transactions
    purchaseAccount: null,
    isActive: true,
    isEditable: false, // Statutory — rate and accounts cannot be modified
  },
];
