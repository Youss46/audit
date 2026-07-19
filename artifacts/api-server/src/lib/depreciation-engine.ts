// Module M17: Depreciation calculation engine.
// Pure functions — no DB access, no side effects. Two methods:
//   buildSchedule() → full multi-year tableau d'amortissement
//   getAnnuityForYear() → the single-year dotation for generate-closings
//
// All monetary values are integers (FCFA). Rates are floating-point fractions
// (0.0–1.0). The engine respects the salvage value floor so VNC never drops
// below it. Prorata temporis is computed on the SYSCOHADA commercial-year
// convention: a 360-day year made of twelve 30-day months (not actual
// calendar days / 365).

import type { DepreciationType } from "@workspace/db";

export interface DepreciationScheduleRow {
  year: number;
  /** VNC at the start of this fiscal year (= acquisitionCost for year 1). */
  openingVNC: number;
  /** Base used for depreciation calc this year (depreciable base for LINEAIRE,
   *  opening VNC for DEGRESSIF). */
  depreciableBase: number;
  /** Effective rate applied this year (0.0–1.0), prorata-adjusted for year 1. */
  rate: number;
  /** Dotation annuelle (FCFA, integer). */
  annuity: number;
  /** Cumulative amortissements from inception through end of this year. */
  cumulativeDepreciation: number;
  /** VNC fin d'exercice = acquisitionCost − cumulativeDepreciation. */
  closingVNC: number;
  /** True when this is a partial first year (acquired after 1 Jan). */
  isProrata: boolean;
}

export interface AssetDepreciationParams {
  acquisitionDate: Date;
  acquisitionCost: number;
  depreciationType: DepreciationType;
  usefulLifeYears: number;
  salvageValue: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Number of days (max 360) in a fiscal year, per the SYSCOHADA convention. */
const DAYS_PER_YEAR = 360;

/**
 * Number of days from acquisitionDate (inclusive) to the end of that fiscal
 * year, on the SYSCOHADA "année commerciale" basis: twelve 30-day months
 * (360-day year), not actual calendar days. Used for prorata temporis on the
 * first fiscal year.
 *
 * Example: acquisition on 2026-04-10 → 21 remaining days in April
 * (30 - 10 + 1) + 8 full months (May..December) × 30 = 21 + 240 = 261 days.
 */
function prorataDaysInAcquisitionYear(acquisitionDate: Date): number {
  const day = Math.min(acquisitionDate.getDate(), 30);
  const month = acquisitionDate.getMonth(); // 0 (January) .. 11 (December)
  const daysInAcquisitionMonth = 30 - day + 1;
  const remainingFullMonths = 11 - month;
  return daysInAcquisitionMonth + remainingFullMonths * DAYS_PER_YEAR / 12;
}

/** True if the asset was acquired after Jan 1, requiring a partial first year. */
function isPartialFirstYear(acquisitionDate: Date): boolean {
  return acquisitionDate.getMonth() !== 0 || acquisitionDate.getDate() !== 1;
}

// ---------------------------------------------------------------------------
// Straight-line (LINEAIRE)
// ---------------------------------------------------------------------------

function buildLinearSchedule(params: AssetDepreciationParams): DepreciationScheduleRow[] {
  const { acquisitionDate, acquisitionCost, usefulLifeYears, salvageValue } = params;
  const depreciableBase = Math.max(0, acquisitionCost - salvageValue);
  if (depreciableBase === 0 || usefulLifeYears === 0) return [];

  const rate = 1 / usefulLifeYears;
  const fullAnnuity = Math.round(depreciableBase / usefulLifeYears);
  const acquisitionYear = acquisitionDate.getFullYear();
  const partial = isPartialFirstYear(acquisitionDate);
  const days = prorataDaysInAcquisitionYear(acquisitionDate);
  const year1Annuity = partial ? Math.round(fullAnnuity * days / DAYS_PER_YEAR) : fullAnnuity;

  // A partial first year spills one extra year at the end.
  const totalRows = partial ? usefulLifeYears + 1 : usefulLifeYears;
  const rows: DepreciationScheduleRow[] = [];
  let cumulative = 0;
  let openingVNC = acquisitionCost;

  for (let i = 0; i < totalRows; i++) {
    if (openingVNC <= salvageValue) break;

    let annuity: number;
    let effectiveRate: number;

    if (i === 0) {
      annuity = year1Annuity;
      effectiveRate = partial ? rate * days / DAYS_PER_YEAR : rate;
    } else if (i === totalRows - 1) {
      // Last row: absorb any rounding residual so VNC lands exactly on
      // salvageValue.
      annuity = openingVNC - salvageValue;
      effectiveRate = rate;
    } else {
      annuity = fullAnnuity;
      effectiveRate = rate;
    }

    annuity = Math.min(annuity, openingVNC - salvageValue);
    annuity = Math.max(annuity, 0);
    cumulative += annuity;

    rows.push({
      year: acquisitionYear + i,
      openingVNC,
      depreciableBase,
      rate: effectiveRate,
      annuity,
      cumulativeDepreciation: cumulative,
      closingVNC: acquisitionCost - cumulative,
      isProrata: i === 0 && partial,
    });

    openingVNC = acquisitionCost - cumulative;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Declining-balance (DEGRESSIF) — SYSCOHADA coefficients
// ---------------------------------------------------------------------------

/** SYSCOHADA/French declining-balance coefficient based on useful life. */
function degressifCoefficient(usefulLifeYears: number): number {
  if (usefulLifeYears <= 2) return 1.0;
  if (usefulLifeYears <= 4) return 1.5;
  if (usefulLifeYears <= 6) return 2.0;
  return 2.5;
}

function buildDegressifSchedule(params: AssetDepreciationParams): DepreciationScheduleRow[] {
  const { acquisitionDate, acquisitionCost, usefulLifeYears, salvageValue } = params;
  if (acquisitionCost <= salvageValue || usefulLifeYears === 0) return [];

  const coeff = degressifCoefficient(usefulLifeYears);
  const linearRate = 1 / usefulLifeYears;
  const degRate = linearRate * coeff;

  const acquisitionYear = acquisitionDate.getFullYear();
  const partial = isPartialFirstYear(acquisitionDate);
  const days = prorataDaysInAcquisitionYear(acquisitionDate);

  // A partial first year requires one extra row at the end (the "tail").
  const totalRows = partial ? usefulLifeYears + 1 : usefulLifeYears;
  const rows: DepreciationScheduleRow[] = [];
  let cumulative = 0;
  let openingVNC = acquisitionCost;

  // remainingEconomicYears counts full economic years left, starting at
  // usefulLifeYears, decremented each row regardless of prorata.
  let remainingEconomicYears = usefulLifeYears;

  for (let i = 0; i < totalRows; i++) {
    if (openingVNC <= salvageValue) break;

    let annuity: number;
    let effectiveRate: number;

    if (i === 0) {
      // First (possibly partial) year: apply degRate with prorata.
      const rawDeg = openingVNC * degRate * (partial ? days / DAYS_PER_YEAR : 1);
      annuity = Math.round(rawDeg);
      effectiveRate = degRate * (partial ? days / DAYS_PER_YEAR : 1);
    } else {
      // Choose the higher of declining-balance and straight-line fallback.
      const degAnnuity = Math.round(openingVNC * degRate);
      const linAnnuity =
        remainingEconomicYears > 0 ? Math.round(openingVNC / remainingEconomicYears) : openingVNC;

      if (linAnnuity >= degAnnuity) {
        // Switched to linear — take equal shares for the remaining years.
        annuity = linAnnuity;
        effectiveRate = remainingEconomicYears > 0 ? 1 / remainingEconomicYears : 1;
      } else {
        annuity = degAnnuity;
        effectiveRate = degRate;
      }
    }

    // Never depreciate below salvageValue.
    annuity = Math.min(annuity, openingVNC - salvageValue);
    annuity = Math.max(annuity, 0);
    cumulative += annuity;

    rows.push({
      year: acquisitionYear + i,
      openingVNC,
      depreciableBase: openingVNC,
      rate: effectiveRate,
      annuity,
      cumulativeDepreciation: cumulative,
      closingVNC: acquisitionCost - cumulative,
      isProrata: i === 0 && partial,
    });

    openingVNC = acquisitionCost - cumulative;
    remainingEconomicYears = Math.max(0, remainingEconomicYears - 1);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full multi-year depreciation schedule (tableau d'amortissement)
 * for an asset. Returns an empty array if the asset has zero depreciable base
 * or zero useful life.
 */
export function buildDepreciationSchedule(
  params: AssetDepreciationParams,
): DepreciationScheduleRow[] {
  if (params.depreciationType === "LINEAIRE") {
    return buildLinearSchedule(params);
  }
  return buildDegressifSchedule(params);
}

/**
 * Compute the cumulative depreciation (amortissements cumulés) through the
 * end of a given fiscal year, used to display VNC on the asset registry.
 * Returns 0 if the year is before the acquisition year.
 * Returns the maximum depreciable amount if the year is past the schedule end.
 */
export function getCumulativeDepreciation(
  params: AssetDepreciationParams,
  fiscalYear: number,
): number {
  const schedule = buildDepreciationSchedule(params);
  let total = 0;
  for (const row of schedule) {
    if (row.year > fiscalYear) break;
    total = row.cumulativeDepreciation;
  }
  return total;
}

/**
 * Return the depreciation annuity (dotation) for a specific fiscal year.
 * Returns 0 if the asset has not yet been acquired or is fully depreciated
 * by that year.
 */
export function getAnnuityForYear(
  params: AssetDepreciationParams,
  fiscalYear: number,
): number {
  const schedule = buildDepreciationSchedule(params);
  const row = schedule.find((r) => r.year === fiscalYear);
  return row?.annuity ?? 0;
}

/**
 * Derive the SYSCOHADA amortissement credit account from a Class 2 asset
 * account number using the standard French/SYSCOHADA sub-account mapping:
 *   "2" + "8" + assetAccount[1] + assetAccount[2..4]
 * Example: "241100" → "284110"
 */
export function deriveAmortissementAccount(assetAccountNumber: string): string {
  if (assetAccountNumber.length < 3) return "28" + assetAccountNumber.slice(1);
  return "28" + assetAccountNumber[1] + assetAccountNumber.slice(2, 5);
}

/**
 * Choose the appropriate dotation (681) charge account per the SYSCOHADA
 * révisé nomenclature:
 *   Class 20 (charges immobilisées / frais d'établissement) → 6811
 *   Class 21 (immobilisations incorporelles)                → 6812
 *   Classes 22-24+ (immobilisations corporelles)             → 6813
 */
export function deriveDotationAccount(assetAccountNumber: string): string {
  if (assetAccountNumber.startsWith("20")) return "6811";
  if (assetAccountNumber.startsWith("21")) return "6812";
  return "6813";
}
