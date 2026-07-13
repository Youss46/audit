// Module M21 (Télédéclaration TVA - Formulaire D-201/VA), Côte d'Ivoire.
//
// Deliberately framework-free and side-effect-free (mirrors
// reporting-engine.ts / closing-engine.ts): routes/tax.ts fetches validated
// transactions + journal lines from Postgres, groups them by transaction,
// and calls into the pure functions below. This keeps the CA-bucketing and
// liquidation-balancing algorithms unit-testable without a database.
//
// SYSCOHADA / DGI account map used by this module:
//   443100 — TVA collectée, taux normal 18%   (credit, sales)
//   443200 — TVA collectée, taux réduit 9%    (credit, sales)
//   444100 — TVA à décaisser (net payable)    (credit, liquidation)
//   445100 — TVA déductible sur immobilisations (debit, purchases)
//   445200 — TVA déductible sur biens et services (debit, purchases)
//   445400 — Crédit de TVA à reporter          (debit = new credit c/f,
//                                                credit = clears prior credit)

export const VAT_RATE_NORMAL = 18;
export const VAT_RATE_REDUIT = 9;
export const STANDARD_VAT_RATES = [0, VAT_RATE_REDUIT, VAT_RATE_NORMAL] as const;

export const ACCOUNT_TVA_COLLECTEE_18 = "443100";
export const ACCOUNT_TVA_COLLECTEE_9 = "443200";
export const ACCOUNT_TVA_A_DECAISSER = "444100";
export const ACCOUNT_TVA_DEDUCTIBLE_IMMO = "445100";
export const ACCOUNT_TVA_DEDUCTIBLE_BIENS_SERVICES = "445200";
export const ACCOUNT_CREDIT_TVA_REPORTE = "445400";

// True for any account in the VAT collection/deduction classes (443 TVA
// Collectée, 445 TVA Déductible) -- used to block VAT-account postings for
// a client whose dossier is marked non-assujetti (isVatRegistered = false).
// Deliberately matches on the class prefix rather than the exact constants
// above, since a sub-account (e.g. "4451001") must be blocked too.
export function isVatAccount(accountNumber: string): boolean {
  return accountNumber.startsWith("443") || accountNumber.startsWith("445");
}

// Thrown when an operation would post to a VAT account (443/445) for a
// client whose dossier says they are not subject to VAT. The full
// TTC (Toutes Taxes Comprises) amount for such a client belongs entirely
// on the class 6 (charge) or class 2 (immobilisation) counterpart account.
export class ClientNotVatRegisteredError extends Error {
  readonly statusCode = 400;
  constructor() {
    super(
      "Cette entité n'est pas assujettie à la TVA. Veuillez comptabiliser le montant TTC directement en charge/immobilisation.",
    );
    this.name = "ClientNotVatRegisteredError";
  }
}

/** One journal line, scoped to the transaction it belongs to. */
export interface VatJournalLine {
  accountNumber: string;
  debitAmount: number;
  creditAmount: number;
}

/** A validated transaction with its journal lines, for a given period. */
export interface VatTransactionGroup {
  transactionId: number;
  date: Date;
  label: string;
  category: string | null;
  supplierName: string | null;
  supplierNcc: string | null;
  invoiceNumber: string | null;
  lines: VatJournalLine[];
}

function netCredit(lines: VatJournalLine[], accountNumber: string): number {
  return lines
    .filter((l) => l.accountNumber === accountNumber)
    .reduce((s, l) => s + (l.creditAmount - l.debitAmount), 0);
}

function netDebit(lines: VatJournalLine[], accountNumber: string): number {
  return lines
    .filter((l) => l.accountNumber === accountNumber)
    .reduce((s, l) => s + (l.debitAmount - l.creditAmount), 0);
}

function isExportCategory(category: string | null): boolean {
  return /export/i.test(category ?? "");
}

// ---------------------------------------------------------------------------
// Section A : Chiffre d'affaires imposable & TVA collectée
// ---------------------------------------------------------------------------

export interface VatSectionA {
  caHt18: number;
  caHt9: number;
  caExoneree: number;
  caExport: number;
  tvaCollectee18: number;
  tvaCollectee9: number;
}

/**
 * Buckets each sales transaction's Class-7 (produits) credit amount into
 * the D-201/VA CA lines, by pairing it against any 443100/443200 credit
 * line booked in the same transaction. A Class-7 credit with no 443xxx
 * line is non-taxable CA -- split into "export" vs "exonérée" via a text
 * match on the transaction's category (the only signal the ledger carries
 * for this distinction today).
 */
export function computeVatSectionA(groups: VatTransactionGroup[]): VatSectionA {
  const result: VatSectionA = {
    caHt18: 0,
    caHt9: 0,
    caExoneree: 0,
    caExport: 0,
    tvaCollectee18: 0,
    tvaCollectee9: 0,
  };

  for (const group of groups) {
    const class7Credit = group.lines
      .filter((l) => l.accountNumber.startsWith("7"))
      .reduce((s, l) => s + (l.creditAmount - l.debitAmount), 0);
    if (class7Credit <= 0) continue;

    const tva18 = netCredit(group.lines, ACCOUNT_TVA_COLLECTEE_18);
    const tva9 = netCredit(group.lines, ACCOUNT_TVA_COLLECTEE_9);

    if (tva18 > 0) {
      result.caHt18 += class7Credit;
      result.tvaCollectee18 += tva18;
    } else if (tva9 > 0) {
      result.caHt9 += class7Credit;
      result.tvaCollectee9 += tva9;
    } else if (isExportCategory(group.category)) {
      result.caExport += class7Credit;
    } else {
      result.caExoneree += class7Credit;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Section B : TVA déductible (+ État Annexé)
// ---------------------------------------------------------------------------

export interface VatSectionB {
  tvaDeductibleImmo: number;
  tvaDeductibleBiensServices: number;
}

export function computeVatSectionB(groups: VatTransactionGroup[]): VatSectionB {
  let tvaDeductibleImmo = 0;
  let tvaDeductibleBiensServices = 0;
  for (const group of groups) {
    tvaDeductibleImmo += netDebit(group.lines, ACCOUNT_TVA_DEDUCTIBLE_IMMO);
    tvaDeductibleBiensServices += netDebit(group.lines, ACCOUNT_TVA_DEDUCTIBLE_BIENS_SERVICES);
  }
  return { tvaDeductibleImmo, tvaDeductibleBiensServices };
}

export interface VatAnnexRow {
  transactionId: number;
  date: Date;
  label: string;
  supplierName: string | null;
  supplierNcc: string | null;
  invoiceNumber: string | null;
  baseHt: number;
  tvaDeductible: number;
  tauxTva: number;
  missingNcc: boolean;
}

/** Rounds a computed rate to the nearest standard DGI VAT rate (0/9/18%). */
function nearestStandardRate(rate: number): number {
  return STANDARD_VAT_RATES.reduce((closest, candidate) =>
    Math.abs(candidate - rate) < Math.abs(closest - rate) ? candidate : closest,
  );
}

/**
 * One row per purchase transaction carrying a 445100/445200 debit line --
 * this app's convention is one invoice per transaction, so transaction-level
 * aggregation matches "one row per purchase invoice" in the DGI annex.
 */
export function computeVatAnnex(groups: VatTransactionGroup[]): VatAnnexRow[] {
  const rows: VatAnnexRow[] = [];

  for (const group of groups) {
    const tvaImmo = netDebit(group.lines, ACCOUNT_TVA_DEDUCTIBLE_IMMO);
    const tvaBiensServices = netDebit(group.lines, ACCOUNT_TVA_DEDUCTIBLE_BIENS_SERVICES);
    const tvaDeductible = tvaImmo + tvaBiensServices;
    if (tvaDeductible <= 0) continue;

    const baseHt = group.lines
      .filter(
        (l) =>
          l.accountNumber !== ACCOUNT_TVA_DEDUCTIBLE_IMMO &&
          l.accountNumber !== ACCOUNT_TVA_DEDUCTIBLE_BIENS_SERVICES,
      )
      .reduce((s, l) => s + (l.debitAmount - l.creditAmount), 0);

    const rawRate = baseHt > 0 ? (tvaDeductible / baseHt) * 100 : 0;

    rows.push({
      transactionId: group.transactionId,
      date: group.date,
      label: group.label,
      supplierName: group.supplierName,
      supplierNcc: group.supplierNcc,
      invoiceNumber: group.invoiceNumber,
      baseHt,
      tvaDeductible,
      tauxTva: nearestStandardRate(rawRate),
      missingNcc: !group.supplierNcc || group.supplierNcc.trim() === "",
    });
  }

  return rows.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ---------------------------------------------------------------------------
// Section C : Liquidation
// ---------------------------------------------------------------------------

export interface VatSectionC {
  tvaCollecteeTotale: number;
  tvaDeductibleTotale: number;
  creditAnterieurReporte: number;
  tvaNetteAPayer: number;
  creditATNouveauReporter: number;
}

export function computeVatSectionC(
  sectionA: VatSectionA,
  sectionB: VatSectionB,
  creditAnterieurReporte: number,
): VatSectionC {
  const tvaCollecteeTotale = sectionA.tvaCollectee18 + sectionA.tvaCollectee9;
  const tvaDeductibleTotale = sectionB.tvaDeductibleImmo + sectionB.tvaDeductibleBiensServices;
  const tvaNette = tvaCollecteeTotale - tvaDeductibleTotale - creditAnterieurReporte;

  return {
    tvaCollecteeTotale,
    tvaDeductibleTotale,
    creditAnterieurReporte,
    tvaNetteAPayer: tvaNette >= 0 ? tvaNette : 0,
    creditATNouveauReporter: tvaNette < 0 ? -tvaNette : 0,
  };
}

export interface VatDeclarationResult {
  clientId: number;
  period: string;
  sectionA: VatSectionA;
  sectionB: VatSectionB;
  sectionC: VatSectionC;
}

export function computeVatDeclaration(
  clientId: number,
  period: string,
  groups: VatTransactionGroup[],
  creditAnterieurReporte: number,
): VatDeclarationResult {
  const sectionA = computeVatSectionA(groups);
  const sectionB = computeVatSectionB(groups);
  const sectionC = computeVatSectionC(sectionA, sectionB, creditAnterieurReporte);
  return { clientId, period, sectionA, sectionB, sectionC };
}

// ---------------------------------------------------------------------------
// Liquidation journal entry (débit 443, crédit 444/445)
// ---------------------------------------------------------------------------

export interface VatLiquidationLine {
  accountNumber: string;
  label: string;
  debitAmount: number;
  creditAmount: number;
}

/**
 * Builds the balanced liquidation OD entry for a period:
 *   Dr 443100/443200 — clears TVA collectée for the period
 *   Cr 445100/445200 — clears TVA déductible for the period
 *   Cr 445400        — clears the prior period's carried-forward credit
 *                       (if any)
 *   Cr 444100        — TVA nette à payer (if the period is payable), OR
 *   Dr 445400        — new credit to carry forward (if the period is a
 *                       credit position)
 * Always balances by construction -- see M21 design notes for the algebra.
 */
export function buildVatLiquidationLines(
  sectionA: VatSectionA,
  sectionB: VatSectionB,
  sectionC: VatSectionC,
  period: string,
): VatLiquidationLine[] {
  const lines: VatLiquidationLine[] = [];

  if (sectionA.tvaCollectee18 > 0) {
    lines.push({
      accountNumber: ACCOUNT_TVA_COLLECTEE_18,
      label: `Liquidation TVA ${period} — TVA collectée 18%`,
      debitAmount: sectionA.tvaCollectee18,
      creditAmount: 0,
    });
  }
  if (sectionA.tvaCollectee9 > 0) {
    lines.push({
      accountNumber: ACCOUNT_TVA_COLLECTEE_9,
      label: `Liquidation TVA ${period} — TVA collectée 9%`,
      debitAmount: sectionA.tvaCollectee9,
      creditAmount: 0,
    });
  }
  if (sectionB.tvaDeductibleImmo > 0) {
    lines.push({
      accountNumber: ACCOUNT_TVA_DEDUCTIBLE_IMMO,
      label: `Liquidation TVA ${period} — TVA déductible immobilisations`,
      debitAmount: 0,
      creditAmount: sectionB.tvaDeductibleImmo,
    });
  }
  if (sectionB.tvaDeductibleBiensServices > 0) {
    lines.push({
      accountNumber: ACCOUNT_TVA_DEDUCTIBLE_BIENS_SERVICES,
      label: `Liquidation TVA ${period} — TVA déductible biens et services`,
      debitAmount: 0,
      creditAmount: sectionB.tvaDeductibleBiensServices,
    });
  }
  if (sectionC.creditAnterieurReporte > 0) {
    lines.push({
      accountNumber: ACCOUNT_CREDIT_TVA_REPORTE,
      label: `Liquidation TVA ${period} — apurement du crédit antérieur`,
      debitAmount: 0,
      creditAmount: sectionC.creditAnterieurReporte,
    });
  }
  if (sectionC.tvaNetteAPayer > 0) {
    lines.push({
      accountNumber: ACCOUNT_TVA_A_DECAISSER,
      label: `Liquidation TVA ${period} — TVA nette à payer`,
      debitAmount: 0,
      creditAmount: sectionC.tvaNetteAPayer,
    });
  }
  if (sectionC.creditATNouveauReporter > 0) {
    lines.push({
      accountNumber: ACCOUNT_CREDIT_TVA_REPORTE,
      label: `Liquidation TVA ${period} — crédit de TVA à reporter`,
      debitAmount: sectionC.creditATNouveauReporter,
      creditAmount: 0,
    });
  }

  return lines;
}

export class VatPeriodAlreadyPostedError extends Error {
  readonly statusCode = 409;
  constructor(period: string) {
    super(`La déclaration de TVA de la période ${period} a déjà été comptabilisée.`);
    this.name = "VatPeriodAlreadyPostedError";
  }
}

export class NoVatActivityError extends Error {
  readonly statusCode = 400;
  constructor(period: string) {
    super(
      `Aucune opération soumise à TVA n'a été trouvée dans le grand livre validé pour la période ${period}.`,
    );
    this.name = "NoVatActivityError";
  }
}
