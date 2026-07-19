// Module M27 (Scoring Financier & Évaluation d'Entreprise): financial-health
// diagnostics and a business-valuation workbench, both derived from the same
// DSF/Bilan computation module M24 already built (dsf-engine.ts) rather than
// re-deriving the balance sheet / income statement from the ledger a second
// time. Deliberately framework-free and side-effect-free, same convention as
// reporting-engine.ts / dsf-engine.ts — routes/scoring.ts owns DB I/O.
//
// All identifiers, formulas and comments in English; every user-facing
// string (risk explanations) is French, meant to be read directly by an
// accountant or presented to a bank / partner.

import type { DsfResult } from "./dsf-engine";

export const RISK_CATEGORIES = ["FAIBLE_RISQUE", "RISQUE_MODERE", "RISQUE_ELEVE"] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Step 1 — Extract the core variables the whole module is built on, from the
// already-computed DSF result (Bilan Actif/Passif, Compte de Résultat).
// ---------------------------------------------------------------------------

export interface ScoringCoreMetrics {
  totalAssets: number; // Bilan Actif "BK" — Total Général Actif
  totalLiabilitiesAndEquity: number; // Bilan Passif "DZ" — Total Général Passif (== totalAssets when balanced)
  currentAssets: number; // Actif Circulant "BD" + Trésorerie-Actif "BJ"
  currentLiabilities: number; // Passif Circulant "DJ" + Trésorerie-Passif "DV"
  totalEquity: number; // Capitaux Propres "CH"
  totalDebts: number; // Dettes Financières "DD" + Passif Circulant "DJ" + Trésorerie-Passif "DV"
  netIncome: number; // Résultat Net "XI"
  ebitda: number; // Excédent Brut d'Exploitation "XC" — used as the EBITDA proxy (SYSCOHADA has no literal EBITDA line)
  ebit: number; // Résultat d'Exploitation "XD"
  sales: number; // Chiffre d'affaires: ventes de marchandises "TA" + ventes de produits fabriqués "TB"
  retainedEarnings: number; // Report à Nouveau "CD" + Primes/Réserves "CB"
}

function findActif(dsf: DsfResult, code: string): number {
  return dsf.bilanActif.find((l) => l.lineCode === code)?.netN ?? 0;
}
function findPassif(dsf: DsfResult, code: string): number {
  return dsf.bilanPassif.find((l) => l.lineCode === code)?.montantN ?? 0;
}
function findResultatProduits(dsf: DsfResult, code: string): number {
  return dsf.compteResultat.find((l) => l.lineCode === code)?.produits ?? 0;
}
function findResultatSolde(dsf: DsfResult, code: string): number {
  return dsf.compteResultat.find((l) => l.lineCode === code)?.solde ?? 0;
}

export function extractCoreMetrics(dsf: DsfResult): ScoringCoreMetrics {
  const currentAssets = findActif(dsf, "BD") + findActif(dsf, "BJ");
  const currentLiabilities = findPassif(dsf, "DJ") + findPassif(dsf, "DV");
  const totalEquity = findPassif(dsf, "CH");
  const totalDebts = findPassif(dsf, "DD") + findPassif(dsf, "DJ") + findPassif(dsf, "DV");

  return {
    totalAssets: dsf.totalBilanActif,
    totalLiabilitiesAndEquity: dsf.totalBilanPassif,
    currentAssets,
    currentLiabilities,
    totalEquity,
    totalDebts,
    netIncome: findResultatSolde(dsf, "XI"),
    ebitda: findResultatSolde(dsf, "XC"),
    ebit: findResultatSolde(dsf, "XD"),
    sales: findResultatProduits(dsf, "TA") + findResultatProduits(dsf, "TB"),
    retainedEarnings: findPassif(dsf, "CD") + findPassif(dsf, "CB"),
  };
}

// ---------------------------------------------------------------------------
// Step 2 — Ratios (Rentabilité / Liquidité / Solvabilité)
// ---------------------------------------------------------------------------

export interface ScoringRatios {
  returnOnEquity: number | null; // Net_Income / Total_Equity (ROE)
  currentRatio: number | null; // Current_Assets / Current_Liabilities
  debtToEquity: number | null; // Total_Debts / Total_Equity
  // Ratio d'autonomie financière (part des ressources propres dans le
  // financement total du bilan) — the "solvency_ratio" DB column.
  solvencyRatio: number | null;
  netWorkingCapital: number; // Current_Assets - Current_Liabilities (BFR / FRNG)
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function computeRatios(m: ScoringCoreMetrics): ScoringRatios {
  return {
    returnOnEquity: safeDivide(m.netIncome, m.totalEquity),
    currentRatio: safeDivide(m.currentAssets, m.currentLiabilities),
    debtToEquity: safeDivide(m.totalDebts, m.totalEquity),
    solvencyRatio: safeDivide(m.totalEquity, m.totalLiabilitiesAndEquity),
    netWorkingCapital: m.currentAssets - m.currentLiabilities,
  };
}

// ---------------------------------------------------------------------------
// Step 3 — Z-Score adapted for African PMEs (regional Altman-style model)
// ---------------------------------------------------------------------------

export interface ZScoreResult {
  zScore: number;
  riskCategory: RiskCategory;
  riskExplanationFr: string;
}

const RISK_EXPLANATIONS_FR: Record<RiskCategory, string> = {
  FAIBLE_RISQUE:
    "La structure financière est saine. L'entreprise présente une forte capacité de remboursement et un risque de défaillance très limité à court et moyen terme. Les équilibres bilanciels (fonds propres, endettement, trésorerie) sont maîtrisés.",
  RISQUE_MODERE:
    "La structure financière présente des signaux de vigilance à surveiller. Sans être alarmante, la situation justifie un suivi rapproché de la trésorerie, du niveau d'endettement et du besoin en fonds de roulement au cours des prochains exercices.",
  RISQUE_ELEVE:
    "La structure financière est fragile et le risque de défaillance à court terme est significatif. Une action corrective rapide est recommandée : renforcement des fonds propres, réduction de l'endettement, amélioration du besoin en fonds de roulement et de la capacité de remboursement.",
};

/**
 * Z = 1.2·(BFR/Actif) + 1.4·(Report à nouveau & réserves/Actif) +
 *     3.3·(EBIT/Actif) + 0.6·(Capitaux propres/Dettes) + 0.999·(CA/Actif)
 *
 * Coefficients follow the classic Altman Z-Score formula (adapted here to
 * SYSCOHADA line items — "Working Capital" -> BFR, "Book Value of Equity"
 * -> Capitaux Propres, "Total Liabilities" -> Total_Debts). Thresholds are
 * the standard Z>2.9 / 1.23<Z≤2.9 / Z≤1.23 bands, relabelled with the
 * cabinet's own risk vocabulary.
 */
export function computeZScore(m: ScoringCoreMetrics): ZScoreResult {
  const totalAssets = m.totalAssets;
  const workingCapital = m.currentAssets - m.currentLiabilities;

  const term1 = totalAssets !== 0 ? 1.2 * (workingCapital / totalAssets) : 0;
  const term2 = totalAssets !== 0 ? 1.4 * (m.retainedEarnings / totalAssets) : 0;
  const term3 = totalAssets !== 0 ? 3.3 * (m.ebit / totalAssets) : 0;
  const term4 = m.totalDebts !== 0 ? 0.6 * (m.totalEquity / m.totalDebts) : 0;
  const term5 = totalAssets !== 0 ? 0.999 * (m.sales / totalAssets) : 0;

  const zScore = term1 + term2 + term3 + term4 + term5;

  const riskCategory: RiskCategory = zScore > 2.9 ? "FAIBLE_RISQUE" : zScore > 1.23 ? "RISQUE_MODERE" : "RISQUE_ELEVE";

  return { zScore, riskCategory, riskExplanationFr: RISK_EXPLANATIONS_FR[riskCategory] };
}

// ---------------------------------------------------------------------------
// Step 4 — Business valuation (Évaluation d'Entreprise)
// ---------------------------------------------------------------------------

export interface ValuationInputs {
  /** Sector multiple applied to EBE/EBITDA, e.g. 6 for "6x EBE". Sector-standard range: 4x-8x. */
  ebitdaMultiplier: number;
  /** Capitalization rate for the "capitalisation du résultat" alternative view, e.g. 0.10 for 10%. */
  capitalizationRate: number;
}

export interface ValuationResult {
  /** Méthode Patrimoniale (Actif Net Réévalué) — here, Total Capitaux Propres (no revaluation adjustments applied). */
  equityValue: number;
  /** Méthode des Multiples — EBE (EBITDA proxy) × sector multiplier. */
  ebitdaMultiplierValue: number;
  /** Alternative "capitalisation du résultat net" view — netIncome / capitalizationRate, shown for context alongside the two primary methods. */
  capitalizedEarningsValue: number;
}

export function computeValuation(m: ScoringCoreMetrics, inputs: ValuationInputs): ValuationResult {
  return {
    equityValue: Math.round(m.totalEquity),
    ebitdaMultiplierValue: Math.round(m.ebitda * inputs.ebitdaMultiplier),
    capitalizedEarningsValue:
      inputs.capitalizationRate > 0 ? Math.round(m.netIncome / inputs.capitalizationRate) : 0,
  };
}
