import { and, eq } from "drizzle-orm";
import {
  db,
  transactionsTable,
  journalLinesTable,
  employeesTable,
  payslipsTable,
  type Employee,
  type MaritalStatus,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Module M20 (Gestion de la Paie, ITS & CNPS) -- Ivorian payroll engine.
//
// Implements the classical (pre-2024-reform) three-tax breakdown explicitly
// requested for this module: IS ("Impôt sur Salaires"), CN ("Contribution
// Nationale"), and ITS/IGR (via quotient familial), plus the CNPS social
// contributions. NOTE: Ordonnance n°2023-718/719 (effective 01/01/2024)
// merged IS + CN + IGR into a single unified ITS computed on the full gross
// (no 20% abattement) with a flat RICF family-charge reduction instead of a
// quotient-familial division. This engine intentionally keeps the three
// components separate, as specified for this module -- if the client's
// bulletins de paie must reflect the post-2024 unified barème instead,
// the ITS/IGR bracket + RICF logic below is the section to swap out.
//
// Brackets and ceilings sourced from CGI Articles 119 bis / 120 (via
// legal-text aggregator, Feb 2026) for the classical IGR/ITS scale and
// quotient-familial parts table, and from FDFP publications for the
// apprenticeship/continuing-training payroll taxes. CNPS rates and
// ceilings, and the IS/CN formulas, were provided directly by the firm.
// ---------------------------------------------------------------------------

// -- Prime de transport ------------------------------------------------------
// Exonérée jusqu'à ce plafond mensuel ; l'excédent est réintégré dans
// l'assiette imposable/cotisable.
export const TRANSPORT_ALLOWANCE_EXEMPTION = 30_000;

// -- CNPS ---------------------------------------------------------------------
export const CNPS_RETIREMENT_CEILING_MONTHLY = 45_000_000 / 12; // 3 750 000 FCFA
export const CNPS_SOCIAL_CEILING_MONTHLY = 750_000; // Prestations familiales / AT

export const CNPS_EMPLOYEE_RATE = 0.063; // Part salarié, retraite
export const CNPS_EMPLOYER_RETRAITE_RATE = 0.077; // Part employeur, retraite
export const CNPS_EMPLOYER_PF_RATE = 0.0575; // Prestations familiales
export const CNPS_EMPLOYER_AT_RATE_DEFAULT = 2; // Accidents du travail, % (2 à 5 selon secteur)

// -- IS (Impôt sur Salaires) --------------------------------------------------
// 1,2% appliqué sur 80% de l'assiette imposable.
export const IS_RATE = 0.012;
export const IS_BASE_FRACTION = 0.8;

// -- CN (Contribution Nationale) ----------------------------------------------
// Barème progressif par tranches, appliqué sur la même assiette à 80% que l'IS.
const CN_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 50_000, rate: 0 },
  { upTo: 130_000, rate: 0.015 },
  { upTo: 200_000, rate: 0.05 },
  { upTo: Infinity, rate: 0.1 },
];

// -- ITS / IGR (quotient familial) -------------------------------------------
// Abattement forfaitaire pour frais professionnels avant calcul du quotient.
export const ITS_ABATEMENT_RATE = 0.15;

// Barème progressif mensuel par tranches, appliqué au quotient (assiette / parts).
const ITS_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 75_000, rate: 0 },
  { upTo: 240_000, rate: 0.16 },
  { upTo: 800_000, rate: 0.21 },
  { upTo: 2_400_000, rate: 0.24 },
  { upTo: 8_000_000, rate: 0.28 },
  { upTo: Infinity, rate: 0.32 },
];

export const ITS_MAX_PARTS = 5;

// -- Taxes patronales sur la masse salariale (FDFP) --------------------------
export const TAXE_APPRENTISSAGE_RATE = 0.004;
export const TAXE_FORMATION_CONTINUE_RATE = 0.006;

/** Applies a progressive bracket table (in FCFA) to a base amount. */
function applyProgressiveBrackets(base: number, brackets: { upTo: number; rate: number }[]): number {
  let tax = 0;
  let lowerBound = 0;
  for (const bracket of brackets) {
    if (base <= lowerBound) break;
    const taxableInBracket = Math.min(base, bracket.upTo) - lowerBound;
    if (taxableInBracket > 0) tax += taxableInBracket * bracket.rate;
    lowerBound = bracket.upTo;
  }
  return tax;
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

export interface PayrollCalculationInput {
  baseSalary: number;
  transportAllowance: number;
  otherTaxablePrimes: number;
  maritalStatus: MaritalStatus;
  dependentChildren: number;
  workAccidentRate: number; // percent, e.g. 2 for 2%
}

export interface PayrollCalculationResult {
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

/** Runs the full Ivorian payroll calculation for a single employee/period. */
export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const round = Math.round;

  const grossSalary =
    input.baseSalary + input.transportAllowance + input.otherTaxablePrimes;
  const taxableTransport = Math.max(0, input.transportAllowance - TRANSPORT_ALLOWANCE_EXEMPTION);
  const grossTaxable = input.baseSalary + taxableTransport + input.otherTaxablePrimes;

  // -- CNPS ---
  const retirementBase = Math.min(grossTaxable, CNPS_RETIREMENT_CEILING_MONTHLY);
  const socialBase = Math.min(grossTaxable, CNPS_SOCIAL_CEILING_MONTHLY);
  const cnpsEmployeeAmount = round(retirementBase * CNPS_EMPLOYEE_RATE);
  const cnpsEmployerRetraite = round(retirementBase * CNPS_EMPLOYER_RETRAITE_RATE);
  const cnpsEmployerPrestationsFamiliales = round(socialBase * CNPS_EMPLOYER_PF_RATE);
  const cnpsEmployerAccidentTravail = round(socialBase * (input.workAccidentRate / 100));

  // -- IS & CN (base commune : 80% de l'assiette imposable) ---
  const isCnBase = grossTaxable * IS_BASE_FRACTION;
  const isAmount = round(isCnBase * IS_RATE);
  const cnAmount = round(applyProgressiveBrackets(isCnBase, CN_BRACKETS));

  // -- ITS/IGR (quotient familial) ---
  const fiscalParts = computeFiscalParts(input.maritalStatus, input.dependentChildren);
  const itsBase = grossTaxable * (1 - ITS_ABATEMENT_RATE);
  const quotient = itsBase / fiscalParts;
  const itsAmount = round(applyProgressiveBrackets(quotient, ITS_BRACKETS) * fiscalParts);

  const netSalary = grossSalary - cnpsEmployeeAmount - isAmount - cnAmount - itsAmount;

  // -- Taxes patronales (masse salariale) ---
  const taxeApprentissage = round(grossTaxable * TAXE_APPRENTISSAGE_RATE);
  const taxeFormationContinue = round(grossTaxable * TAXE_FORMATION_CONTINUE_RATE);

  const totalEmployerCost =
    grossSalary +
    cnpsEmployerRetraite +
    cnpsEmployerPrestationsFamiliales +
    cnpsEmployerAccidentTravail +
    taxeApprentissage +
    taxeFormationContinue;

  return {
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

/** Convenience wrapper computing payroll directly from an Employee row. */
export function calculatePayrollForEmployee(employee: Employee): PayrollCalculationResult {
  return calculatePayroll({
    baseSalary: employee.baseSalary,
    transportAllowance: employee.transportAllowance,
    otherTaxablePrimes: employee.otherTaxablePrimes,
    maritalStatus: employee.maritalStatus,
    dependentChildren: employee.dependentChildren,
    workAccidentRate: employee.workAccidentRate,
  });
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
  totalDebit661: number; // Charges de personnel (salaires bruts)
  totalDebit664: number; // Charges sociales (part employeur)
  totalCredit422: number; // Personnel, rémunérations dues (net à payer)
  totalCredit431: number; // CNPS (part salarié + part employeur)
  totalCredit447: number; // État, impôts sur salaires (IS + CN + ITS)
}

/**
 * Aggregates every un-posted, calculated payslip for a client/period into
 * one balanced OD (Opération Diverse) journal entry, pre-validated
 * (status: "valide") -- follows the same direct-DB-insert pattern used by
 * the M17/M18/M19 engines for system-generated ledger entries.
 *
 * Debit 661 (Salaires bruts) + 664 (Charges sociales employeur)
 * Credit 422 (Net à payer) + 431 (CNPS) + 447 (État, ITS/IS/CN)
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

  return await db.transaction(async (tx) => {
    const [transaction] = await tx
      .insert(transactionsTable)
      .values({
        firmId,
        clientId,
        date,
        label: `Paie du mois ${period} — ${unposted.length} bulletin(s)`,
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
      { transactionId: transaction.id, accountNumber: "661", debitAmount: totalGross, label: "Salaires bruts" },
      {
        transactionId: transaction.id,
        accountNumber: "664",
        debitAmount: totalEmployerCharges,
        label: "Charges sociales (part employeur)",
      },
      { transactionId: transaction.id, accountNumber: "422", creditAmount: totalNet, label: "Personnel, net à payer" },
      { transactionId: transaction.id, accountNumber: "431", creditAmount: totalCnps, label: "CNPS à décaisser" },
      {
        transactionId: transaction.id,
        accountNumber: "447",
        creditAmount: totalTaxes,
        label: "État, impôts sur salaires (IS/CN/ITS/FDFP)",
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
      totalDebit661: totalGross,
      totalDebit664: totalEmployerCharges,
      totalCredit422: totalNet,
      totalCredit431: totalCnps,
      totalCredit447: totalTaxes,
    };
  });
}
