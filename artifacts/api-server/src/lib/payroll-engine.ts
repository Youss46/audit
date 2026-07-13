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

  // -- CNPS (plafond unique, part salariale sur le salaire brut total) ---
  const cnpsBase = Math.min(grossSalary, CNPS_CEILING_MONTHLY);
  const cnpsEmployeeAmount = round(cnpsBase * CNPS_EMPLOYEE_RATE);
  const cnpsEmployerRetraite = round(cnpsBase * CNPS_EMPLOYER_RETRAITE_RATE);
  const cnpsEmployerPrestationsFamiliales = round(cnpsBase * CNPS_EMPLOYER_PF_RATE);
  const cnpsEmployerAccidentTravail = round(cnpsBase * (input.workAccidentRate / 100));

  // -- ITS unifié (base imposable = assiette x 0,85, barème direct + RICF) ---
  const fiscalParts = computeFiscalParts(input.maritalStatus, input.dependentChildren);
  const taxableBase = grossTaxable * ITS_TAXABLE_BASE_RATE;
  const grossIts = computeGrossIts(taxableBase);
  const itsAmount = round(grossIts * (1 - ricfReductionRate(fiscalParts)));

  // IS et CN n'existent plus depuis la réforme (fusionnés dans l'ITS) ; les
  // champs sont conservés à 0 pour la compatibilité des bulletins historiques.
  const isAmount = 0;
  const cnAmount = 0;

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
  totalCredit447: number; // État, impôts sur salaires (ITS unifié)
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
        label: "État, impôts sur salaires (ITS/FDFP)",
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
