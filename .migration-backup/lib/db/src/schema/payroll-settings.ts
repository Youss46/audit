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

// Module M20-Settings: Cabinet-level payroll tax & social contribution rates.
//
// Each row stores one configurable rate or ceiling scoped to a cabinet firm.
// On first access the backend lazy-seeds a firm's settings from the statutory
// defaults; accountants can then update them whenever legislation changes
// (e.g. a new CNPS ceiling decree or a revised FDFP rate).
//
// The payroll calculation engine (payroll-engine.ts) reads these rows at
// calculation time instead of using hardcoded constants, so any change here
// is immediately reflected on the next payroll run.
//
// Fields:
//  category      — display group: "CNPS" | "ITS" | "FDFP" | "TRANSPORT"
//  ruleName      — French label shown in the UI settings table
//  ruleKey       — stable machine key used by the engine (never changes)
//  ratePercentage — decimal fraction (e.g. 0.077 = 7.7%); null for ceiling-only
//  ceilingAmount  — FCFA integer ceiling; null for rate-only rows
//  isEditable    — false for statutory brackets (ITS) that are not adjustable
//  updatedById   — last cabinet user who edited this row (audit trail)

export const PAYROLL_SETTING_CATEGORIES = ["CNPS", "ITS", "FDFP", "TRANSPORT"] as const;
export type PayrollSettingCategory = (typeof PAYROLL_SETTING_CATEGORIES)[number];

export const payrollSettingsTable = pgTable(
  "payroll_settings",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    // Display group (CNPS, ITS, FDFP, TRANSPORT)
    category: text("category").notNull().$type<PayrollSettingCategory>(),
    // French display label (e.g. "Part Patronale Retraite")
    ruleName: text("rule_name").notNull(),
    // Stable machine key consumed by the payroll engine
    // (e.g. "cnps_employer_retraite_rate"). Never changed after insert.
    ruleKey: text("rule_key").notNull(),
    // Rate as a decimal fraction (0.077 = 7.7%). Null for ceiling-only rows.
    ratePercentage: doublePrecision("rate_percentage"),
    // FCFA ceiling (3_375_000 for CNPS, 30_000 for transport exemption).
    // Null for pure-rate rows.
    ceilingAmount: integer("ceiling_amount"),
    // false for rows backed by statutory tax brackets that the UI should
    // display but not allow editing (e.g. ITS abattement).
    isEditable: boolean("is_editable").notNull().default(true),
    // Audit: last accountant who changed this row
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
    index("payroll_settings_firm_id_idx").on(table.firmId),
    // One row per (firm, ruleKey) — prevents duplicates if the lazy-seed
    // is called concurrently during a period of heavy usage.
    unique("payroll_settings_firm_rule_unique").on(table.firmId, table.ruleKey),
  ],
);

export const insertPayrollSettingSchema = createInsertSchema(payrollSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPayrollSetting = z.infer<typeof insertPayrollSettingSchema>;
export type PayrollSetting = typeof payrollSettingsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Statutory defaults — mirrors the constants in payroll-engine.ts.
// Used by the lazy-seed helper and by tests.
// ---------------------------------------------------------------------------
export const PAYROLL_SETTING_DEFAULTS: Omit<
  InsertPayrollSetting,
  "firmId" | "updatedById"
>[] = [
  // ── CNPS ─────────────────────────────────────────────────────────────────
  {
    category: "CNPS",
    ruleName: "Cotisation salariale (Retraite)",
    ruleKey: "cnps_employee_rate",
    ratePercentage: 0.063,
    ceilingAmount: null,
    isEditable: true,
  },
  {
    category: "CNPS",
    ruleName: "Part patronale — Régime de retraite",
    ruleKey: "cnps_employer_retraite_rate",
    ratePercentage: 0.077,
    ceilingAmount: null,
    isEditable: true,
  },
  {
    category: "CNPS",
    ruleName: "Part patronale — Prestations familiales",
    ruleKey: "cnps_employer_pf_rate",
    ratePercentage: 0.0575,
    ceilingAmount: null,
    isEditable: true,
  },
  {
    category: "CNPS",
    ruleName: "Accidents du travail (taux par défaut)",
    ruleKey: "cnps_employer_at_rate_default",
    ratePercentage: 0.02,
    ceilingAmount: null,
    isEditable: true,
  },
  {
    category: "CNPS",
    ruleName: "Plafond mensuel de cotisation CNPS",
    ruleKey: "cnps_ceiling_monthly",
    ratePercentage: null,
    ceilingAmount: 3_375_000,
    isEditable: true,
  },
  // ── ITS (Impôt sur les Traitements et Salaires) ───────────────────────────
  {
    category: "ITS",
    ruleName: "Abattement forfaitaire (base imposable ITS)",
    ruleKey: "its_taxable_base_abattement",
    ratePercentage: 0.15, // 15% abattement → base = 85% of grossTaxable
    ceilingAmount: null,
    isEditable: false, // statutory; cannot be modified by the cabinet
  },
  // ── FDFP (Fonds de Développement de la Formation Professionnelle) ──────────
  {
    category: "FDFP",
    ruleName: "Taxe d'apprentissage",
    ruleKey: "taxe_apprentissage_rate",
    ratePercentage: 0.004,
    ceilingAmount: null,
    isEditable: true,
  },
  {
    category: "FDFP",
    ruleName: "Taxe de formation professionnelle continue",
    ruleKey: "taxe_formation_continue_rate",
    ratePercentage: 0.006,
    ceilingAmount: null,
    isEditable: true,
  },
  // ── Transport ─────────────────────────────────────────────────────────────
  {
    category: "TRANSPORT",
    ruleName: "Plafond d'exonération — Prime de transport",
    ruleKey: "transport_allowance_exemption",
    ratePercentage: null,
    ceilingAmount: 30_000,
    isEditable: true,
  },
];
