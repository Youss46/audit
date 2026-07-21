/**
 * imputation-engine.ts — Service d'imputation automatique SYSCOHADA
 *
 * Détermine les comptes débit/crédit d'une écriture à partir d'une clé de
 * catégorie, d'un mode de paiement et/ou du type de transaction (dépense /
 * recette). Interroge la table `transaction_categories` en priorité, se
 * rabat sur les constantes statiques du moteur comptable, puis sur le compte
 * d'attente 471000 en dernier recours (flagForReview = true).
 *
 * Règle absolue : TOUS les comptes résolus sont en 6 chiffres.
 * La fonction pad6() garantit cette invariante même si la DB renvoie un code
 * historique en 3 ou 4 chiffres.
 *
 *   pad6 convention :
 *     3c → ABC100   (ex. "571" → "571100")
 *     4c → ABCD00   (ex. "6052" → "605200", "5211" → "521100")
 *     5c → ABCDE0
 *     6c → identité
 *
 * Usage :
 *   const result = await imputeAccount({ categoryKey: "loyer", paymentMethod: "bank" });
 *   // → { debitAccount: "622100", creditAccount: "521100", flagForReview: false, ... }
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
  /** Compte débité — toujours en 6 chiffres (ex. "622100" pour un loyer dépense). */
  debitAccount: string;
  debitLabel: string;
  /** Compte crédité — toujours en 6 chiffres (ex. "521100" pour un virement). */
  creditAccount: string;
  creditLabel: string;
  /** Taux TVA par défaut (en %) pour cette catégorie. */
  defaultTvaRate: number;
  vatEligible: boolean;
  /**
   * true si aucune imputation précise n'a été trouvée — le compte d'attente
   * 471000 est utilisé et l'écriture doit être revue par le Cabinet.
   */
  flagForReview: boolean;
  /** Source de résolution : "db" | "static" | "fallback". */
  source: "db" | "static" | "fallback";
}

// ---------------------------------------------------------------------------
// Helper : normalisation vers 6 chiffres obligatoires
// ---------------------------------------------------------------------------

/**
 * Garantit que tout numéro de compte est en 6 chiffres.
 *
 * Règles :
 *   3 chiffres → append "100"   (571 → 571100)
 *   4 chiffres → append "00"    (6052 → 605200 ; 5211 → 521100)
 *   5 chiffres → append "0"
 *   ≥ 6        → identité
 *
 * Comptes spéciaux (attente) : 471 → 471000, 472 → 472000 sont
 * naturellement couverts par la règle 3c → append "100" (471 + 100 = 471100),
 * mais la convention interne utilise 471000/472000 pour signaler
 * l'absence de sous-compte réel. Ces deux cas sont donc traités explicitement.
 */
export function pad6(account: string): string {
  if (account === "471") return "471000";
  if (account === "472") return "472000";
  const len = account.length;
  if (len >= 6) return account;
  if (len === 5) return account + "0";
  if (len === 4) return account + "00";
  if (len === 3) return account + "100";
  return account;
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
      virement: { account: "521100", label: "Banques locales" },
      cheque:   { account: "513100", label: "Chèques à encaisser" },
    };
    if (paymentMethod && accountMap[paymentMethod]) return accountMap[paymentMethod];
    return { account: "521100", label: "Banques locales" };
  }
  if (paymentMethod === "especes") {
    return { account: "571100", label: "Caisse principale" };
  }
  if (paymentMethod === "mobile_money") {
    const rawAcct  = mmProvider ? (MOBILE_MONEY_PROVIDER_ACCOUNTS[mmProvider] ?? "552100") : "552100";
    const account  = pad6(rawAcct);
    const label    = mmProvider ? (MOBILE_MONEY_PROVIDER_LABELS[mmProvider]   ?? "Monnaie électronique") : "Monnaie électronique";
    return { account, label };
  }
  return { account: "521100", label: "Banques locales" };
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
      const rawAccount   = pad6(dbRow.defaultAccountNumber);
      const isDepense    = dbRow.transactionType === "depense";
      return {
        debitAccount:  isDepense ? rawAccount      : treasury.account,
        debitLabel:    isDepense ? dbRow.displayName : treasury.label,
        creditAccount: isDepense ? treasury.account  : rawAccount,
        creditLabel:   isDepense ? treasury.label    : dbRow.displayName,
        defaultTvaRate: dbRow.defaultTvaRate,
        vatEligible:   dbRow.vatEligible,
        flagForReview: false,
        source:        "db",
      };
    }
  }

  // ── 2. Repli sur PURCHASE_CATEGORIES (statique) ───────────────────────────
  if (input.categoryKey && input.categoryKey in PURCHASE_CATEGORIES) {
    const cat     = PURCHASE_CATEGORIES[input.categoryKey as keyof typeof PURCHASE_CATEGORIES];
    const account = pad6(cat.account);
    return {
      debitAccount:  account,
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
    const rule      = CATEGORY_RULES[input.categoryKey];
    const account   = pad6(rule.counterpartAccount);
    const isDepense = rule.type === "depense";
    return {
      debitAccount:  isDepense ? account          : treasury.account,
      debitLabel:    isDepense ? rule.counterpartName : treasury.label,
      creditAccount: isDepense ? treasury.account  : account,
      creditLabel:   isDepense ? treasury.label    : rule.counterpartName,
      defaultTvaRate: 0,
      vatEligible:   false,
      flagForReview: false,
      source:        "static",
    };
  }

  // ── 4. Compte d'attente 471000/472000 (dernier recours) ──────────────────
  const isDepense = (input.transactionType ?? "depense") === "depense";
  return {
    debitAccount:  isDepense ? "471000" : treasury.account,
    debitLabel:    isDepense ? "Compte d'attente débiteurs (à imputer)"  : treasury.label,
    creditAccount: isDepense ? treasury.account : "472000",
    creditLabel:   isDepense ? treasury.label   : "Compte d'attente créditeurs (à imputer)",
    defaultTvaRate: 0,
    vatEligible:   false,
    flagForReview: true,
    source:        "fallback",
  };
}
