import { doublePrecision, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";

// Module M27 (Scoring Financier & Évaluation d'Entreprise): financial-health
// diagnostics (Z-Score, solvency, gearing, working capital) and a business
// valuation workbench (patrimonial / EBITDA-multiple approaches), both
// computed live from the same validated-ledger pipeline module M24 (DSF)
// already built. Every computation run is persisted here so the cabinet can
// track a client's risk trend and valuation history year over year, rather
// than only ever seeing the latest snapshot.
//
// Naming/type note: the product brief specifies UUID primary keys and a
// native SQL enum for risk_category. Following the same precedent as every
// other module in this schema (see collaboration.ts), we keep integer
// `serial` ids (not UUID) and a `text` column typed via `$type<...>` (not a
// native pg enum, which nothing else in this schema uses either) so this
// module stays consistent with the rest of the codebase instead of
// introducing a second id/enum scheme.
export const RISK_CATEGORIES = ["FAIBLE_RISQUE", "RISQUE_MODERE", "RISQUE_ELEVE"] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

// -- Financial_Scoring_Results --------------------------------------------
export const financialScoringResultsTable = pgTable(
  "financial_scoring_results",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    zScore: doublePrecision("z_score").notNull(),
    solvencyRatio: doublePrecision("solvency_ratio").notNull(),
    debtToEquity: doublePrecision("debt_to_equity").notNull(),
    // FCFA, signed integer -- same money convention as every other ledger
    // amount in this schema (no decimals).
    netWorkingCapital: integer("net_working_capital").notNull(),
    // Additional ratios the scoring engine computes (module brief section 2)
    // that don't have a dedicated column in the brief's DB spec but are
    // worth persisting alongside the score for the historical trend view.
    returnOnEquity: doublePrecision("return_on_equity").notNull(),
    currentRatio: doublePrecision("current_ratio").notNull(),
    riskCategory: text("risk_category").notNull().$type<RiskCategory>(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One persisted result per client/year -- recomputing overwrites
    // (upsert), it never accumulates duplicate rows for the same exercise.
    unique("financial_scoring_results_client_year_unique").on(table.clientId, table.year),
    index("financial_scoring_results_client_id_idx").on(table.clientId),
  ],
);

export type FinancialScoringResult = typeof financialScoringResultsTable.$inferSelect;

// -- Business_Valuations ---------------------------------------------------
export const businessValuationsTable = pgTable(
  "business_valuations",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    // FCFA, integer money convention.
    ebitdaMultiplierValue: integer("ebitda_multiplier_value").notNull(),
    equityValue: integer("equity_value").notNull(),
    // The multiplier the accountant chose on the slider (e.g. 5.5 for 5.5x
    // EBE) -- kept separate from the resulting FCFA value above.
    ebitdaMultiplierUsed: doublePrecision("ebitda_multiplier_used").notNull(),
    capitalizationRateUsed: doublePrecision("capitalization_rate_used").notNull(),
    customComments: text("custom_comments"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One saved valuation scenario per client/year -- saving again updates
    // it in place (upsert) so the accountant always has "the current
    // scenario", plus a history if we later want to keep prior runs.
    unique("business_valuations_client_year_unique").on(table.clientId, table.year),
    index("business_valuations_client_id_idx").on(table.clientId),
  ],
);

export type BusinessValuation = typeof businessValuationsTable.$inferSelect;
