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

// Module M24 (DSF / Liasse Fiscale SYSCOHADA Révisé) — account-to-line
// mapping rules driving the automated financial-statements generator
// (artifacts/api-server/src/lib/dsf-engine.ts). One row per statement line
// (or per calculation leaf feeding a Compte de Résultat / TFT formula).
// Shared across every firm/tenant -- the SYSCOHADA mapping is standardized,
// not tenant-specific (same convention as the `accounts` chart of accounts).
// Seeded once per environment (see lib/db/src/seed-dsf-mapping-rules.ts);
// safe to re-run (upsert on statement_type + line_code).
export const DSF_STATEMENT_TYPES = [
  "BILAN_ACTIF",
  "BILAN_PASSIF",
  "COMPTE_DE_RESULTAT",
  "TFT",
] as const;
export type DsfStatementType = (typeof DSF_STATEMENT_TYPES)[number];

// SUM_DEBIT / SUM_CREDIT: sum the matching accounts' final (or current-year,
// depending on the line) debit-side / credit-side balance. NET_BALANCE:
// sum(credit) - sum(debit) over the same accounts, used for the "variation"
// lines (stocks, créances, dettes) in the Compte de Résultat and TFT where
// both directions of the same account patterns are needed together.
export const DSF_MAPPING_OPERATIONS = [
  "SUM_DEBIT",
  "SUM_CREDIT",
  "NET_BALANCE",
] as const;
export type DsfMappingOperation = (typeof DSF_MAPPING_OPERATIONS)[number];

export const dsfMappingRulesTable = pgTable(
  "dsf_mapping_rules",
  {
    id: serial("id").primaryKey(),
    statementType: text("statement_type").notNull().$type<DsfStatementType>(),
    // Official line code for BILAN_ACTIF/BILAN_PASSIF/COMPTE_DE_RESULTAT/TFT
    // display lines (e.g. "AB", "CA", "XB"), or an internal calculation key
    // for a Compte de Résultat / TFT leaf value that feeds a derived
    // intermediate balance (e.g. "CR_ACHATS_MATIERES", "TFT_STOCKS").
    lineCode: text("line_code").notNull(),
    lineLabel: text("line_label").notNull(),
    // Comma-separated account-number prefixes, e.g. "24,23" or "701,707".
    accountPatterns: text("account_patterns").notNull(),
    operation: text("operation").notNull().$type<DsfMappingOperation>(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("dsf_mapping_rules_statement_line_unique").on(
      table.statementType,
      table.lineCode,
    ),
    index("dsf_mapping_rules_statement_type_idx").on(table.statementType),
  ],
);

export const insertDsfMappingRuleSchema = createInsertSchema(
  dsfMappingRulesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDsfMappingRule = z.infer<typeof insertDsfMappingRuleSchema>;
export type DsfMappingRule = typeof dsfMappingRulesTable.$inferSelect;
