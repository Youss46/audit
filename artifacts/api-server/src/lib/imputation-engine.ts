/**
 * imputation-engine.ts — Service d'imputation automatique SYSCOHADA
 *
 * Détermine les comptes débit/crédit d'une écriture à partir d'une clé de
 * catégorie, d'un mode de paiement et/ou du type de transaction (dépense /
 * recette). Interroge la table `transaction_categories` en priorité, se
 * rabat sur les constantes statiques du moteur comptable, puis sur le compte
 * d'attente 471 en dernier recours (flagForReview = true).
 *
 * Usage :
 *   const result = await imputeAccount({ categoryKey: "loyer", paymentMethod: "bank" });
 *   // → { debitAccount: "622", creditAccount: "5211", flagForReview: false, ... }
 */

import { db } from "@workspace/db";
import { transactionCategoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  PURCHASE_CATEGORIES,
  CATEGORY_RULES,
  MOBILE_MONEY_PROVIDER_ACCOUNTS,
  MOBILE_MONEY_PROVIDER_LABELS,
} from "./accounting-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImputationInput {
  /** Clé de catégorie (ex. "loyer", "vente_marchandises"). */
  categoryKey?: string | null;
  /** Mode de paiement pour déterminer le compte de contrepartie trésorerie. */
  paymentMethod?: "especes" | "mobile_money" | "cheque" | "virement" | null;
  /** Fournisseur de Mobile Money (ex. "wave", "orange_money"). */
  mmProvider?: string | null;
  /** Type explicite quand la catégorie est inconnue. */
  transactionType?: "depense" | "recette" | null;
}

export interface ImputationResult {
  /** Compte débité (ex. "622" pour un loyer dépense). */
  debitAccount: string;
  debitLabel: string;
  /** Compte crédité (ex. "5211" pour un virement). */
  creditAccount: string;
  creditLabel: string;
  /** Taux TVA par défaut (en %) pour cette catégorie. */
  defaultTvaRate: number;
  vatEligible: boolean;
  /**
   * true si aucune imputation précise n'a été trouvée — le compte d'attente
   * 471 est utilisé et l'écriture doit être revue par le Cabinet.
   */
  flagForReview: boolean;
  /** Source de résolution : "db" | "static" | "fallback". */
  source: "db" | "static" | "fallback";
}

// ---------------------------------------------------------------------------
// Helpers : compte trésorerie selon mode de paiement
// ---------------------------------------------------------------------------

function resolveTreasuryAccount(
  paymentMethod?: string | null,
  mmProvider?: string | null,
): { account: string; label: string } {
  if (!paymentMethod || paymentMethod === "virement" || paymentMethod === "cheque") {
    const accountMap: Record<string, { account: string; label: string }> = {
      virement:     { account: "5211", label: "Banques locales" },
      cheque:       { account: "513",  label: "Chèques à encaisser" },
    };
    if (paymentMethod && accountMap[paymentMethod]) return accountMap[paymentMethod];
    return { account: "5211", label: "Banques locales" };
  }
  if (paymentMethod === "especes") {
    return { account: "571", label: "Caisse" };
  }
  if (paymentMethod === "mobile_money") {
    const acct  = mmProvider ? (MOBILE_MONEY_PROVIDER_ACCOUNTS[mmProvider] ?? "552") : "552";
    const label = mmProvider ? (MOBILE_MONEY_PROVIDER_LABELS[mmProvider]   ?? "Monnaie électronique") : "Monnaie électronique";
    return { account: acct, label };
  }
  return { account: "5211", label: "Banques locales" };
}

// ---------------------------------------------------------------------------
// Moteur principal
// ---------------------------------------------------------------------------

export async function imputeAccount(input: ImputationInput): Promise<ImputationResult> {
  const treasury = resolveTreasuryAccount(input.paymentMethod, input.mmProvider);

  // ── 1. Résolution depuis la base de données ──────────────────────────────
  if (input.categoryKey) {
    const rows = await db
      .select()
      .from(transactionCategoriesTable)
      .where(eq(transactionCategoriesTable.key, input.categoryKey))
      .limit(1);
    const dbRow = rows[0] ?? null;

    if (dbRow) {
      const isDepense = dbRow.transactionType === "depense";
      return {
        debitAccount:  isDepense ? dbRow.defaultAccountNumber : treasury.account,
        debitLabel:    isDepense ? dbRow.displayName          : treasury.label,
        creditAccount: isDepense ? treasury.account           : dbRow.defaultAccountNumber,
        creditLabel:   isDepense ? treasury.label             : dbRow.displayName,
        defaultTvaRate: dbRow.defaultTvaRate,
        vatEligible:   dbRow.vatEligible,
        flagForReview: false,
        source:        "db",
      };
    }
  }

  // ── 2. Repli sur PURCHASE_CATEGORIES (statique) ───────────────────────────
  if (input.categoryKey && input.categoryKey in PURCHASE_CATEGORIES) {
    const cat = PURCHASE_CATEGORIES[input.categoryKey as keyof typeof PURCHASE_CATEGORIES];
    return {
      debitAccount:  cat.account,
      debitLabel:    cat.accountName,
      creditAccount: treasury.account,
      creditLabel:   treasury.label,
      defaultTvaRate: cat.vatEligible ? 18 : 0,
      vatEligible:   cat.vatEligible,
      flagForReview: false,
      source:        "static",
    };
  }

  // ── 3. Repli sur CATEGORY_RULES (statique) ────────────────────────────────
  if (input.categoryKey && input.categoryKey in CATEGORY_RULES) {
    const rule = CATEGORY_RULES[input.categoryKey];
    const isDepense = rule.type === "depense";
    return {
      debitAccount:  isDepense ? rule.counterpartAccount : treasury.account,
      debitLabel:    isDepense ? rule.counterpartName    : treasury.label,
      creditAccount: isDepense ? treasury.account        : rule.counterpartAccount,
      creditLabel:   isDepense ? treasury.label          : rule.counterpartName,
      defaultTvaRate: 0,
      vatEligible:   false,
      flagForReview: false,
      source:        "static",
    };
  }

  // ── 4. Compte d'attente 471 (dernier recours) ────────────────────────────
  const isDepense = (input.transactionType ?? "depense") === "depense";
  return {
    debitAccount:  isDepense ? "471" : treasury.account,
    debitLabel:    isDepense ? "Compte d'attente (à imputer)"  : treasury.label,
    creditAccount: isDepense ? treasury.account : "472",
    creditLabel:   isDepense ? treasury.label   : "Compte d'attente (à imputer)",
    defaultTvaRate: 0,
    vatEligible:   false,
    flagForReview: true,
    source:        "fallback",
  };
}
