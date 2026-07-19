// Module M18: bank amortization engine (Tableau d'amortissement financier)
// for Immobilisations Financières & Emprunts. Pure functions — no DB
// access, no side effects.
//
// Uses the standard "constant annuity" (annuités constantes) method: the
// periodic payment is the same every installment, with the interest share
// shrinking and the principal share growing over the life of the loan.
// When annualInterestRate is 0 (e.g. an interest-free rental deposit or
// staff advance), the annuity degenerates to an equal split of principal.
//
// All monetary values are integers (FCFA). Rates are stored as a percentage
// (e.g. 8.5 for 8.5%).

import type { PaymentFrequency } from "@workspace/db";

export interface AmortizationRow {
  installmentNumber: number;
  dueDate: Date;
  /** Constant periodic payment (Annuité). */
  annuity: number;
  /** Interest share of this installment (Intérêts). */
  interestAmount: number;
  /** Principal share of this installment (Capital remboursé). */
  principalAmount: number;
  /** Capital restant dû after this installment is paid. */
  remainingCapital: number;
  /** True once this installment has been booked to the ledger. */
  posted: boolean;
}

export interface LoanScheduleParams {
  principalAmount: number;
  annualInterestRate: number;
  startDate: Date;
  termMonths: number;
  paymentFrequency: PaymentFrequency;
}

const MONTHS_PER_PERIOD: Record<PaymentFrequency, number> = {
  MENSUEL: 1,
  TRIMESTRIEL: 3,
  ANNUEL: 12,
};

const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  MENSUEL: 12,
  TRIMESTRIEL: 4,
  ANNUEL: 1,
};

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Build the full multi-period amortization schedule for a loan or financial
 * asset. `installmentsPosted` (0 by default) marks how many of the leading
 * rows are already booked to the general ledger — used purely to set the
 * `posted` flag on each row for display, the schedule itself doesn't change.
 */
export function buildLoanAmortizationSchedule(
  params: LoanScheduleParams,
  installmentsPosted = 0,
): AmortizationRow[] {
  const { principalAmount, annualInterestRate, startDate, termMonths, paymentFrequency } = params;
  const monthsPerPeriod = MONTHS_PER_PERIOD[paymentFrequency];
  const periodsPerYear = PERIODS_PER_YEAR[paymentFrequency];
  const numberOfPeriods = Math.round(termMonths / monthsPerPeriod);
  if (numberOfPeriods <= 0 || principalAmount <= 0) return [];

  const periodicRate = annualInterestRate / 100 / periodsPerYear;

  // Constant annuity formula: A = P * r / (1 - (1+r)^-n). Falls back to an
  // equal principal split when the rate is 0 (no interest to amortize).
  const rawAnnuity =
    periodicRate === 0
      ? principalAmount / numberOfPeriods
      : (principalAmount * periodicRate) / (1 - Math.pow(1 + periodicRate, -numberOfPeriods));

  const rows: AmortizationRow[] = [];
  let remainingCapital = principalAmount;

  for (let i = 1; i <= numberOfPeriods; i++) {
    const interestAmount = Math.round(remainingCapital * periodicRate);
    let principalPortion: number;
    let annuity: number;

    if (i === numberOfPeriods) {
      // Last installment absorbs any rounding residual so the loan lands
      // exactly on zero instead of drifting by a few FCFA.
      principalPortion = remainingCapital;
      annuity = principalPortion + interestAmount;
    } else {
      annuity = Math.round(rawAnnuity);
      principalPortion = annuity - interestAmount;
    }

    remainingCapital = Math.max(0, remainingCapital - principalPortion);

    rows.push({
      installmentNumber: i,
      dueDate: addMonths(startDate, i * monthsPerPeriod),
      annuity,
      interestAmount,
      principalAmount: principalPortion,
      remainingCapital,
      posted: i <= installmentsPosted,
    });
  }

  return rows;
}

/**
 * Installments that are due as of `asOfDate` but not yet posted — what
 * POST /finance/generate-journal-entries books for one item.
 */
export function getDueUnpostedInstallments(
  params: LoanScheduleParams,
  installmentsPosted: number,
  asOfDate: Date,
): AmortizationRow[] {
  const schedule = buildLoanAmortizationSchedule(params, installmentsPosted);
  return schedule.filter((row) => row.installmentNumber > installmentsPosted && row.dueDate <= asOfDate);
}

/**
 * Derives the SYSCOHADA journal accounts for one installment payment.
 * - EMPRUNT_BANCAIRE (we owe the bank): Debit the loan account (capital) +
 *   6711 (interest), Credit the treasury account.
 * - IMMOBILISATION_FINANCIERE (someone owes us): Debit the treasury
 *   account, Credit the item account (capital) + 7711 (interest, if any).
 *
 * TREASURY_ACCOUNT is a fixed "521" default (Banques) rather than a
 * per-client bank account, since the app has no per-client multi-bank-account
 * setup yet — this can be swapped for a dynamic lookup once that exists.
 */
const TREASURY_ACCOUNT = "521"; // Banques — specific sub-account, not the "52" class parent.
const INTEREST_EXPENSE_ACCOUNT = "6711"; // Intérêts des emprunts (specific sub-account, not "671" parent).
const INTEREST_INCOME_ACCOUNT = "7711"; // Intérêts des prêts (specific sub-account, not "771" parent).

export function buildInstallmentJournalLines(input: {
  type: "EMPRUNT_BANCAIRE" | "IMMOBILISATION_FINANCIERE";
  accountNumber: string;
  principalAmount: number;
  interestAmount: number;
}): Array<{ accountNumber: string; label: string; debitAmount: number; creditAmount: number }> {
  const { type, accountNumber, principalAmount, interestAmount } = input;

  if (type === "EMPRUNT_BANCAIRE") {
    const lines = [
      {
        accountNumber,
        label: "Remboursement du capital",
        debitAmount: principalAmount,
        creditAmount: 0,
      },
    ];
    if (interestAmount > 0) {
      lines.push({
        accountNumber: INTEREST_EXPENSE_ACCOUNT,
        label: "Frais financiers — intérêts des emprunts",
        debitAmount: interestAmount,
        creditAmount: 0,
      });
    }
    lines.push({
      accountNumber: TREASURY_ACCOUNT,
      label: "Banque",
      debitAmount: 0,
      creditAmount: principalAmount + interestAmount,
    });
    return lines;
  }

  // IMMOBILISATION_FINANCIERE
  const lines = [
    {
      accountNumber: TREASURY_ACCOUNT,
      label: "Banque",
      debitAmount: principalAmount + interestAmount,
      creditAmount: 0,
    },
    {
      accountNumber,
      label: "Diminution du prêt",
      debitAmount: 0,
      creditAmount: principalAmount,
    },
  ];
  if (interestAmount > 0) {
    lines.push({
      accountNumber: INTEREST_INCOME_ACCOUNT,
      label: "Intérêts encaissés",
      debitAmount: 0,
      creditAmount: interestAmount,
    });
  }
  return lines;
}
