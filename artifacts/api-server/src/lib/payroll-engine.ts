import { and, eq } from "drizzle-orm";
import {
  db,
  transactionsTable,
  journalLinesTable,
  employeesTable,
  payslipsTable,
  payrollSettingsTable,
  type Employee,
  type MaritalStatus,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Module M20 (Gestion de la Paie, ITS & CNPS) -- Ivorian payroll engine.
//
// Implements the unified post-reform ITS (Ordonnance n°2023-718/719,
// effective 01/01/2024): IS, CN and IGR are merged into a single ITS,
// computed on a taxable base (85% of gross taxable salary, i.e. a flat 15%
// abattement) run through one progressive bracket scale, then reduced by a
// flat RICF percentage keyed on the number of family parts (no more
// quotient-familial division of the base). `isAmount` / `cnAmount` are kept
// at 0 (fields retained in the schema/API for backward compatibility with
// bulletins issued under the pre-reform regime) -- the full income-tax
// withholding now lives entirely in `itsAmount`.
//
// Official parameters (brackets, RICF table, CNPS rates/ceiling) provided
// directly by the firm, Feb 2026.
// ---------------------------------------------------------------------------

// -- Prime de transport ------------------------------------------------------
// Exonérée jusqu'à ce plafond mensuel ; l'excédent est réintégré dans
// l'assiette imposable/cotisable.
export const TRANSPORT_ALLOWANCE_EXEMPTION = 30_000;

// -- CNPS ---------------------------------------------------------------------
// Plafond unique CNPS (part salariale et patronale), FCFA/mois.
export const CNPS_CEILING_MONTHLY = 3_375_000;

export const CNPS_EMPLOYEE_RATE = 0.063; // Part salarié, retraite
export const CNPS_EMPLOYER_RETRAITE_RATE = 0.077; // Part employeur, retraite
export const CNPS_EMPLOYER_PF_RATE = 0.0575; // Prestations familiales
export const CNPS_EMPLOYER_AT_RATE_DEFAULT = 2; // Accidents du travail, % (2 à 5 selon secteur)

// -- ITS unifié (post-réforme 2024) -------------------------------------------
// Base imposable = Salaire Brut Imposable x 0,85 (abattement forfaitaire de 15%).
export const ITS_TAXABLE_BASE_RATE = 0.85;

// ---------------------------------------------------------------------------
// Dynamic rates — loaded from payroll_settings table per firm.
// Falls back to the hardcoded constants above when DB rows are absent.
// ---------------------------------------------------------------------------

export interface PayrollRates {
  cnpsEmployeeRate: number;          // fraction, e.g. 0.063
  cnpsEmployerRetraiteRate: number;  // fraction, e.g. 0.077
  cnpsEmployerPfRate: number;        // fraction, e.g. 0.0575
  cnpsCeilingMonthly: number;        // FCFA, e.g. 3_375_000
  itsTaxableBaseRate: number;        // fraction kept (1 - abattement), e.g. 0.85
  taxeApprentissageRate: number;     // fraction, e.g. 0.004
  taxeFormationContinueRate: number; // fraction, e.g. 0.006
  transportAllowanceExemption: number; // FCFA, e.g. 30_000
}

export function getDefaultPayrollRates(): PayrollRates {
  return {
    cnpsEmployeeRate: CNPS_EMPLOYEE_RATE,
    cnpsEmployerRetraiteRate: CNPS_EMPLOYER_RETRAITE_RATE,
    cnpsEmployerPfRate: CNPS_EMPLOYER_PF_RATE,
    cnpsCeilingMonthly: CNPS_CEILING_MONTHLY,
    itsTaxableBaseRate: ITS_TAXABLE_BASE_RATE,
    taxeApprentissageRate: TAXE_APPRENTISSAGE_RATE,
    taxeFormationContinueRate: TAXE_FORMATION_CONTINUE_RATE,
    transportAllowanceExemption: TRANSPORT_ALLOWANCE_EXEMPTION,
  };
}

/**
 * Loads firm-specific payroll rates from the payroll_settings table.
 * Falls back to the statutory hardcoded constants for any missing row.
 * Triggers the lazy-seed implicitly via the GET route on first access;
 * here we just read whatever rows exist.
 */
export async function loadFirmPayrollRates(firmId: number): Promise<PayrollRates> {
  const rows = await db.query.payrollSettingsTable.findMany({
    where: eq(payrollSettingsTable.firmId, firmId),
  });

  const byKey = Object.fromEntries(rows.map((r) => [r.ruleKey, r]));
  const defaults = getDefaultPayrollRates();

  const rate = (key: string, fallback: number): number =>
    byKey[key]?.ratePercentage ?? fallback;
  const ceiling = (key: string, fallback: number): number =>
    byKey[key]?.ceilingAmount ?? fallback;
  const abattement = byKey["its_taxable_base_abattement"]?.ratePercentage;

  return {
    cnpsEmployeeRate: rate("cnps_employee_rate", defaults.cnpsEmployeeRate),
    cnpsEmployerRetraiteRate: rate("cnps_employer_retraite_rate", defaults.cnpsEmployerRetraiteRate),
    cnpsEmployerPfRate: rate("cnps_employer_pf_rate", defaults.cnpsEmployerPfRate),
    cnpsCeilingMonthly: ceiling("cnps_ceiling_monthly", defaults.cnpsCeilingMonthly),
    // its_taxable_base_abattement stores the abattement fraction (0.15);
    // the engine uses the complement (base rate = 1 - abattement).
    itsTaxableBaseRate: abattement !== undefined && abattement !== null
      ? 1 - abattement
      : defaults.itsTaxableBaseRate,
    taxeApprentissageRate: rate("taxe_apprentissage_rate", defaults.taxeApprentissageRate),
    taxeFormationContinueRate: rate("taxe_formation_continue_rate", defaults.taxeFormationContinueRate),
    transportAllowanceExemption: ceiling("transport_allowance_exemption", defaults.transportAllowanceExemption),
  };
}

// Barème progressif mensuel par tranches (méthode des "correctifs"/déductions
// cumulatives) : impôt brut = base x taux - correctif, sur la base imposable
// (déjà abattue de 15%), sans division par le quotient familial.
const ITS_BRACKETS: { upTo: number; rate: number; deduction: number }[] = [
  { upTo: 75_000, rate: 0, deduction: 0 },
  { upTo: 240_000, rate: 0.16, deduction: 12_000 },
  { upTo: 800_000, rate: 0.21, deduction: 24_000 },
  { upTo: 2_400_000, rate: 0.24, deduction: 48_000 },
  { upTo: 8_000_000, rate: 0.28, deduction: 144_000 },
  { upTo: Infinity, rate: 0.32, deduction: 464_000 },
];

export const ITS_MAX_PARTS = 5;

// Réduction pour Charges de Famille (RICF), en % de l'impôt brut, appliquée
// selon le nombre de parts (N). Table officielle par palier de 0,5 part.
const RICF_REDUCTION_BY_PARTS: Record<number, number> = {
  1: 0,
  1.5: 0.1,
  2: 0.15,
  2.5: 0.2,
  3: 0.25,
  3.5: 0.3,
  4: 0.35,
  4.5: 0.4,
  5: 0.45,
};

// -- Taxes patronales sur la masse salariale (FDFP) --------------------------
export const TAXE_APPRENTISSAGE_RATE = 0.004;
export const TAXE_FORMATION_CONTINUE_RATE = 0.006;


/** Applies the ITS quick-deduction bracket scale to a taxable base (FCFA). */
function computeGrossIts(base: number): number {
  if (base <= 0) return 0;
  for (const bracket of ITS_BRACKETS) {
    if (base <= bracket.upTo) {
      return Math.max(0, base * bracket.rate - bracket.deduction);
    }
  }
  return 0; // unreachable: last bracket's upTo is Infinity
}

/** RICF reduction rate (0 to 0.45) for a given number of family parts. */
function ricfReductionRate(parts: number): number {
  return RICF_REDUCTION_BY_PARTS[parts] ?? 0;
}

/**
 * Nombre de parts fiscales (quotient familial) selon la situation
 * matrimoniale et le nombre d'enfants à charge (CGI Art. 120) :
 * base 1 part (célibataire/divorcé/veuf sans enfant) ou 2 parts (marié
 * sans enfant), + 0,5 part par enfant à charge, plafonné à 5 parts.
 */
export function computeFiscalParts(maritalStatus: MaritalStatus, dependentChildren: number): number {
  const base = maritalStatus === "MARIE" ? 2 : 1;
  const parts = base + 0.5 * Math.max(0, dependentChildren);
  return Math.min(parts, ITS_MAX_PARTS);
}

// ---------------------------------------------------------------------------
// Prime d'ancienneté (Ivorian labour law, Art. 37 Code du Travail CI)
// ---------------------------------------------------------------------------
// Barème officiel :
//   < 2 ans  → 0 %
//   2 ans    → 2 %  (base = salaire de base)
//   3–24 ans → +1 % par année supplémentaire (ex: 5 ans = 5 %)
//   ≥ 25 ans → plafond de 25 %
// La prime est incluse dans le salaire brut imposable/cotisable.
// ---------------------------------------------------------------------------

/**
 * Nombre d'années de service complètes entre la date d'embauche et la
 * période traitée (format "YYYY-MM"). Une année est complète quand le même
 * mois calendaire est atteint une année plus tard.
 */
export function computeYearsOfService(hireDate: string, period: string): number {
  const [periodYear, periodMonth] = period.split("-").map(Number);
  const hireParts = hireDate.split("-").map(Number);
  const hireYear = hireParts[0];
  const hireMonth = hireParts[1]; // 1-based
  const rawYears = periodYear - hireYear;
  // Subtract 1 if the hire-month anniversary has not yet been reached this year.
  const adjusted = periodMonth >= hireMonth ? rawYears : rawYears - 1;
  return Math.max(0, adjusted);
}

/**
 * Taux d'ancienneté applicable selon les années de service complètes.
 * Retourne une fraction (ex: 0.05 pour 5 %).
 */
export function computeSeniorityRate(yearsOfService: number): number {
  if (yearsOfService < 2) return 0;
  return Math.min(yearsOfService, 25) / 100;
}

/**
 * Calcule la prime d'ancienneté en FCFA arrondie à l'unité.
 * Base = salaire de base de l'employé.
 */
export function computePrimeAnciennete(
  baseSalary: number,
  hireDate: string | null,
  period: string,
): number {
  if (!hireDate) return 0;
  const years = computeYearsOfService(hireDate, period);
  const rate = computeSeniorityRate(years);
  return Math.round(baseSalary * rate);
}

export interface PayrollCalculationInput {
  baseSalary: number;
  transportAllowance: number;
  otherTaxablePrimes: number;
  /** Prime d'ancienneté pré-calculée via computePrimeAnciennete(). */
  primeAnciennete: number;
  maritalStatus: MaritalStatus;
  dependentChildren: number;
  workAccidentRate: number; // percent, e.g. 2 for 2%
}

export interface PayrollCalculationResult {
  primeAnciennete: number;
  grossSalary: number;
  grossTaxable: number;
  cnpsEmployeeAmount: number;
  isAmount: number;
  cnAmount: number;
  itsAmount: number;
  netSalary: number;
  cnpsEmployerRetraite: number;
  cnpsEmployerPrestationsFamiliales: number;
  cnpsEmployerAccidentTravail: number;
  taxeApprentissage: number;
  taxeFormationContinue: number;
  totalEmployerCost: number;
  fiscalParts: number;
}

/**
 * Runs the full Ivorian payroll calculation for a single employee/period.
 * Pass `rates` (from `loadFirmPayrollRates`) to use firm-specific DB values;
 * omit it to fall back to the statutory hardcoded constants.
 */
export function calculatePayroll(
  input: PayrollCalculationInput,
  rates?: PayrollRates,
): PayrollCalculationResult {
  const r = rates ?? getDefaultPayrollRates();
  const round = Math.round;

  // Prime d'ancienneté intégrée dans le brut imposable et cotisable.
  const primeAnciennete = input.primeAnciennete;

  const grossSalary =
    input.baseSalary + primeAnciennete + input.transportAllowance + input.otherTaxablePrimes;
  const taxableTransport = Math.max(0, input.transportAllowance - r.transportAllowanceExemption);
  // Brut imposable = base + ancienneté + transport taxable + autres primes
  const grossTaxable = input.baseSalary + primeAnciennete + taxableTransport + input.otherTaxablePrimes;

  // -- CNPS (plafond unique, part salariale sur le salaire brut total) ---
  const cnpsBase = Math.min(grossSalary, r.cnpsCeilingMonthly);
  const cnpsEmployeeAmount = round(cnpsBase * r.cnpsEmployeeRate);
  const cnpsEmployerRetraite = round(cnpsBase * r.cnpsEmployerRetraiteRate);
  const cnpsEmployerPrestationsFamiliales = round(cnpsBase * r.cnpsEmployerPfRate);
  const cnpsEmployerAccidentTravail = round(cnpsBase * (input.workAccidentRate / 100));

  // -- ITS unifié (base imposable = assiette x itsTaxableBaseRate, barème direct + RICF) ---
  const fiscalParts = computeFiscalParts(input.maritalStatus, input.dependentChildren);
  const taxableBase = grossTaxable * r.itsTaxableBaseRate;
  const grossIts = computeGrossIts(taxableBase);
  const itsAmount = round(grossIts * (1 - ricfReductionRate(fiscalParts)));

  // IS et CN n'existent plus depuis la réforme (fusionnés dans l'ITS) ; les
  // champs sont conservés à 0 pour la compatibilité des bulletins historiques.
  const isAmount = 0;
  const cnAmount = 0;

  const netSalary = grossSalary - cnpsEmployeeAmount - isAmount - cnAmount - itsAmount;

  // -- Taxes patronales (masse salariale) ---
  const taxeApprentissage = round(grossTaxable * r.taxeApprentissageRate);
  const taxeFormationContinue = round(grossTaxable * r.taxeFormationContinueRate);

  const totalEmployerCost =
    grossSalary +
    cnpsEmployerRetraite +
    cnpsEmployerPrestationsFamiliales +
    cnpsEmployerAccidentTravail +
    taxeApprentissage +
    taxeFormationContinue;

  return {
    primeAnciennete,
    grossSalary,
    grossTaxable,
    cnpsEmployeeAmount,
    isAmount,
    cnAmount,
    itsAmount,
    netSalary,
    cnpsEmployerRetraite,
    cnpsEmployerPrestationsFamiliales,
    cnpsEmployerAccidentTravail,
    taxeApprentissage,
    taxeFormationContinue,
    totalEmployerCost,
    fiscalParts,
  };
}

/**
 * Convenience wrapper computing payroll directly from an Employee row.
 * `period` ("YYYY-MM") is required to compute the prime d'ancienneté.
 */
export function calculatePayrollForEmployee(
  employee: Employee,
  period: string,
  rates?: PayrollRates,
): PayrollCalculationResult {
  return calculatePayroll(
    {
      baseSalary: employee.baseSalary,
      transportAllowance: employee.transportAllowance,
      otherTaxablePrimes: employee.otherTaxablePrimes,
      primeAnciennete: computePrimeAnciennete(employee.baseSalary, employee.hireDate ?? null, period),
      maritalStatus: employee.maritalStatus,
      dependentChildren: employee.dependentChildren,
      workAccidentRate: employee.workAccidentRate,
    },
    rates,
  );
}

// ---------------------------------------------------------------------------
// Ledger posting
// ---------------------------------------------------------------------------

export class PayrollAlreadyPostedError extends Error {
  readonly statusCode = 409;
  constructor(period: string) {
    super(`La paie de la période ${period} a déjà été comptabilisée.`);
    this.name = "PayrollAlreadyPostedError";
  }
}

export class NoPayslipsToPostError extends Error {
  readonly statusCode = 400;
  constructor(period: string) {
    super(`Aucun bulletin de paie calculé n'a été trouvé pour la période ${period}.`);
    this.name = "NoPayslipsToPostError";
  }
}

export interface PostPayrollLedgerResult {
  transactionId: number;
  period: string;
  payslipsPosted: number;
  totalDebit6611: number;  // Charges de personnel (salaires bruts)
  totalDebit664: number;   // Charges sociales (part employeur + FDFP)
  totalCredit422: number;  // Personnel, rémunérations dues (net à payer)
  totalCredit4311: number; // CNPS (part salarié + part employeur)
  totalCredit4471: number; // État, impôts sur salaires (ITS unifié + FDFP)
}

/**
 * Aggregates every un-posted, calculated payslip for a client/period into
 * one balanced OD (Opération Diverse) journal entry, pre-validated
 * (status: "valide") -- follows the same direct-DB-insert pattern used by
 * the M17/M18/M19 engines for system-generated ledger entries.
 *
 * Debit 661 (Salaires bruts) + 664 (Charges sociales employeur)
 * Credit 422 (Net à payer) + 431 (CNPS) + 447 (État, ITS)
 */
export async function postPayrollLedger(
  firmId: number,
  clientId: number,
  period: string,
  userId: number,
): Promise<PostPayrollLedgerResult> {
  const payslips = await db.query.payslipsTable.findMany({
    where: and(
      eq(payslipsTable.firmId, firmId),
      eq(payslipsTable.clientId, clientId),
      eq(payslipsTable.period, period),
    ),
  });

  const unposted = payslips.filter((p) => p.postedTransactionId === null);
  if (payslips.length === 0) throw new NoPayslipsToPostError(period);
  if (unposted.length === 0) throw new PayrollAlreadyPostedError(period);

  const totalGross = unposted.reduce((s, p) => s + p.grossSalary, 0);
  const totalEmployerCharges = unposted.reduce(
    (s, p) =>
      s +
      p.cnpsEmployerRetraite +
      p.cnpsEmployerPrestationsFamiliales +
      p.cnpsEmployerAccidentTravail +
      p.taxeApprentissage +
      p.taxeFormationContinue,
    0,
  );
  const totalNet = unposted.reduce((s, p) => s + p.netSalary, 0);
  const totalCnps = unposted.reduce(
    (s, p) =>
      s +
      p.cnpsEmployeeAmount +
      p.cnpsEmployerRetraite +
      p.cnpsEmployerPrestationsFamiliales +
      p.cnpsEmployerAccidentTravail,
    0,
  );
  const totalTaxes = unposted.reduce(
    (s, p) => s + p.isAmount + p.cnAmount + p.itsAmount + p.taxeApprentissage + p.taxeFormationContinue,
    0,
  );

  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 28));

  // Label: "Centralisation de la paie - MM/YYYY"
  const monthStr = String(month).padStart(2, "0");
  const label = `Centralisation de la paie - ${monthStr}/${year}`;

  return await db.transaction(async (tx) => {
    const [transaction] = await tx
      .insert(transactionsTable)
      .values({
        firmId,
        clientId,
        date,
        label,
        amount: totalGross + totalEmployerCharges,
        type: "depense",
        paymentType: "credit",
        status: "valide",
        source: "manual_cabinet",
        validatedById: userId,
        validatedAt: new Date(),
        createdById: userId,
      })
      .returning();

    await tx.insert(journalLinesTable).values([
      // Débits — charges de l'exercice
      {
        transactionId: transaction.id,
        accountNumber: "661100",
        debitAmount: totalGross,
        label: "Personnel national — salaires bruts",
      },
      {
        transactionId: transaction.id,
        accountNumber: "664100",
        debitAmount: totalEmployerCharges,
        label: "Charges sociales patronales (CNPS + FDFP)",
      },
      // Crédits — dettes envers le personnel et l'État
      {
        transactionId: transaction.id,
        accountNumber: "422100",
        creditAmount: totalNet,
        label: "Personnel, rémunérations dues (net à payer)",
      },
      {
        transactionId: transaction.id,
        accountNumber: "431100",
        creditAmount: totalCnps,
        label: "CNPS — cotisations à reverser",
      },
      {
        transactionId: transaction.id,
        accountNumber: "447100",
        creditAmount: totalTaxes,
        label: "État — ITS, Taxe d'apprentissage et FDFP",
      },
    ]);

    for (const p of unposted) {
      await tx
        .update(payslipsTable)
        .set({ postedTransactionId: transaction.id })
        .where(eq(payslipsTable.id, p.id));
    }

    return {
      transactionId: transaction.id,
      period,
      payslipsPosted: unposted.length,
      totalDebit6611: totalGross,
      totalDebit664: totalEmployerCharges,
      totalCredit422: totalNet,
      totalCredit4311: totalCnps,
      totalCredit4471: totalTaxes,
    };
  });
}
