import { and, eq, gte, isNull, lt } from "drizzle-orm";
import {
  db,
  transactionsTable,
  journalLinesTable,
  fixedAssetsTable,
  financialAssetsLoansTable,
  fiscalYearClosingsTable,
  documentFoldersTable,
} from "@workspace/db";
import {
  getAnnuityForYear,
  deriveAmortissementAccount,
  deriveDotationAccount,
} from "./depreciation-engine";
import {
  getDueUnpostedInstallments,
  buildInstallmentJournalLines,
} from "./loan-amortization-engine";

// -------------------------------------------------------------------------
// Shared types
// -------------------------------------------------------------------------

export interface ClosingStep1Result {
  depreciationEntriesGenerated: number;
  depreciationEntriesSkipped: number;
  financeEntriesGenerated: number;
  financeEntriesSkipped: number;
}

export interface ClosingStep2Result {
  totalClass6Debits: number;
  totalClass7Credits: number;
  netResult: number; // positive = bénéfice (1301), negative = perte (1309)
  resultAccount: "1301" | "1309";
  closingTransactionId: number;
}

export interface ClosingStep4Result {
  accountsCarriedForward: number;
  openingTransactionId: number | null;
}

export interface ClosePeriodEngineResult {
  clientId: number;
  year: number;
  step1: ClosingStep1Result;
  step2: ClosingStep2Result;
  lockedAt: string;
  step4: ClosingStep4Result;
}

// -------------------------------------------------------------------------
// Period lock helpers (also exported for use in route guard middleware)
// -------------------------------------------------------------------------

/** True if the given year has been officially locked for this client. */
export async function isPeriodLocked(
  firmId: number,
  clientId: number,
  year: number,
): Promise<boolean> {
  const closing = await db.query.fiscalYearClosingsTable.findFirst({
    where: and(
      eq(fiscalYearClosingsTable.firmId, firmId),
      eq(fiscalYearClosingsTable.clientId, clientId),
      eq(fiscalYearClosingsTable.year, year),
    ),
  });
  return closing?.status === "LOCKED";
}

/** Thrown when an operation targets a LOCKED fiscal period. */
export class PeriodLockedError extends Error {
  readonly statusCode = 403;
  constructor(year: number) {
    super(
      `L'exercice ${year} est définitivement clôturé. Aucune écriture ne peut être ajoutée ou modifiée pour cet exercice.`,
    );
    this.name = "PeriodLockedError";
  }
}

// -------------------------------------------------------------------------
// Fiscal archive folder tree (GED integration)
// -------------------------------------------------------------------------

// The 4 canonical sub-folders created automatically inside each locked
// "Exercice YYYY" archive root when a fiscal year is closed (Step 3).
// `folderCategory` is the stable machine-readable key; `name` is the
// human-readable French label shown in the GED "Archives Fiscales" tab.
export const ARCHIVE_SUBFOLDERS = [
  {
    name: "01 — États Financiers & Liasse Fiscale (DSF)",
    folderCategory: "etats_financiers",
  },
  {
    name: "02 — Journaux & Grand Livre (Légal)",
    folderCategory: "journaux_grand_livre",
  },
  {
    name: "03 — Dossier d'Audit & Rapports (Cabinet)",
    folderCategory: "dossier_audit",
  },
  {
    name: "04 — Pièces Justificatives Majeures",
    folderCategory: "pieces_justificatives",
  },
] as const;

/**
 * Creates the locked GED archive tree for a closed fiscal year:
 *   • one root folder  → "Exercice {year}"  (isArchived=true, parentFolderId=null)
 *   • four sub-folders → the four canonical ARCHIVE_SUBFOLDERS underneath it
 *
 * Idempotent: skips silently if the root folder already exists so that
 * re-running the closing routine never produces duplicates.
 */
async function createFiscalArchiveFolders(
  firmId: number,
  clientId: number,
  year: number,
  createdById: number,
): Promise<void> {
  const existing = await db.query.documentFoldersTable.findFirst({
    where: and(
      eq(documentFoldersTable.firmId, firmId),
      eq(documentFoldersTable.clientId, clientId),
      eq(documentFoldersTable.fiscalYear, year),
      isNull(documentFoldersTable.parentFolderId),
    ),
  });
  if (existing) return; // already created — nothing to do

  // Root archive folder: "Exercice 2025"
  const [root] = await db
    .insert(documentFoldersTable)
    .values({
      firmId,
      clientId,
      parentFolderId: null,
      name: `Exercice ${year}`,
      isArchived: true,
      fiscalYear: year,
      folderCategory: null,
      createdById,
    })
    .returning();

  // Four fixed sub-folders underneath the root
  await db.insert(documentFoldersTable).values(
    ARCHIVE_SUBFOLDERS.map((sub) => ({
      firmId,
      clientId,
      parentFolderId: root.id,
      name: sub.name,
      isArchived: true,
      fiscalYear: year,
      folderCategory: sub.folderCategory,
      createdById,
    })),
  );
}

// -------------------------------------------------------------------------
// Internal step helpers
// -------------------------------------------------------------------------

/** Step 1a: generate + auto-validate depreciation dotations for the year. */
async function runDepreciationAdjustments(
  firmId: number,
  clientId: number,
  year: number,
  createdById: number,
): Promise<{ generated: number; skipped: number }> {
  const activeAssets = await db.query.fixedAssetsTable.findMany({
    where: and(
      eq(fixedAssetsTable.firmId, firmId),
      eq(fixedAssetsTable.clientId, clientId),
      eq(fixedAssetsTable.status, "ACTIF"),
    ),
  });

  let generated = 0;
  let skipped = 0;

  for (const asset of activeAssets) {
    if (asset.acquisitionDate.getFullYear() > year) {
      skipped++;
      continue;
    }
    // Pending-setup assets (auto-synced stubs) have null depreciation params —
    // skip them until the accountant completes their configuration.
    if (asset.depreciationType === null || asset.usefulLifeYears === null) {
      skipped++;
      continue;
    }
    const annuity = getAnnuityForYear(
      {
        acquisitionDate: asset.acquisitionDate,
        acquisitionCost: asset.acquisitionCost,
        depreciationType: asset.depreciationType,
        usefulLifeYears: asset.usefulLifeYears,
        salvageValue: asset.salvageValue,
      },
      year,
    );
    if (annuity === 0) {
      skipped++;
      continue;
    }

    const debitAccount = deriveDotationAccount(asset.accountNumber);
    const creditAccount = deriveAmortissementAccount(asset.accountNumber);

    // Closing entries are immediately validated — they are computed adjusting
    // entries that require no separate cabinet review.
    const [tx] = await db
      .insert(transactionsTable)
      .values({
        firmId,
        clientId,
        date: new Date(`${year}-12-31T00:00:00.000Z`),
        label: `Dotation aux amortissements — ${asset.label} — Exercice ${year}`,
        amount: annuity,
        type: "depense",
        category: null,
        paymentType: "cash",
        paymentMethod: null,
        status: "valide",
        source: "closing_result",
        createdById,
        anomalies: [],
        validatedAt: new Date(),
        validatedById: createdById,
      })
      .returning();

    await db.insert(journalLinesTable).values([
      {
        transactionId: tx.id,
        accountNumber: debitAccount,
        label: `Dotation — ${asset.label} — ${year}`,
        debitAmount: annuity,
        creditAmount: 0,
      },
      {
        transactionId: tx.id,
        accountNumber: creditAccount,
        label: `Amortissement — ${asset.label} — ${year}`,
        debitAmount: 0,
        creditAmount: annuity,
      },
    ]);

    generated++;
  }

  return { generated, skipped };
}

/** Step 1b: generate + auto-validate due financial installments for the year. */
async function runFinanceAdjustments(
  firmId: number,
  clientId: number,
  year: number,
  createdById: number,
): Promise<{ generated: number; skipped: number }> {
  const activeItems = await db.query.financialAssetsLoansTable.findMany({
    where: and(
      eq(financialAssetsLoansTable.firmId, firmId),
      eq(financialAssetsLoansTable.clientId, clientId),
      eq(financialAssetsLoansTable.status, "ACTIF"),
    ),
  });

  const yearEnd = new Date(`${year}-12-31T23:59:59.999Z`);
  let generated = 0;
  let skipped = 0;

  for (const item of activeItems) {
    const dueRows = getDueUnpostedInstallments(
      {
        principalAmount: item.principalAmount,
        annualInterestRate: item.annualInterestRate,
        startDate: item.startDate,
        termMonths: item.termMonths,
        paymentFrequency: item.paymentFrequency,
      },
      item.installmentsPosted,
      yearEnd,
    );

    // Only book installments that fall within the closing fiscal year.
    const yearDueRows = dueRows.filter((r) => r.dueDate.getFullYear() <= year);

    if (yearDueRows.length === 0) {
      skipped++;
      continue;
    }

    let lastInstallmentNumber = item.installmentsPosted;

    for (const row of yearDueRows) {
      const lines = buildInstallmentJournalLines({
        type: item.type,
        accountNumber: item.accountNumber,
        principalAmount: row.principalAmount,
        interestAmount: row.interestAmount,
      });
      const total = row.principalAmount + row.interestAmount;

      const [tx] = await db
        .insert(transactionsTable)
        .values({
          firmId,
          clientId,
          date: row.dueDate,
          label: `${item.type === "EMPRUNT_BANCAIRE" ? "Échéance emprunt" : "Échéance prêt"} — ${item.label} — Échéance n°${row.installmentNumber}`,
          amount: total,
          type: item.type === "EMPRUNT_BANCAIRE" ? "depense" : "recette",
          category: null,
          paymentType: "cash",
          paymentMethod: "virement",
          status: "valide",
          source: "closing_result",
          createdById,
          anomalies: [],
          validatedAt: new Date(),
          validatedById: createdById,
        })
        .returning();

      await db.insert(journalLinesTable).values(
        lines.map((l) => ({
          transactionId: tx.id,
          accountNumber: l.accountNumber,
          label: `${l.label} — ${item.label} n°${row.installmentNumber}`,
          debitAmount: l.debitAmount,
          creditAmount: l.creditAmount,
        })),
      );

      lastInstallmentNumber = row.installmentNumber;
      generated++;
    }

    await db
      .update(financialAssetsLoansTable)
      .set({ installmentsPosted: lastInstallmentNumber })
      .where(eq(financialAssetsLoansTable.id, item.id));
  }

  return { generated, skipped };
}

/**
 * Step 2: aggregate Class 6 and 7 balances from all validated transactions
 * within the fiscal year, then post the result-clearing entry (virement au
 * compte de résultat) to account 131 (bénéfice) or 139 (perte).
 */
async function computeAndPostNetResult(
  firmId: number,
  clientId: number,
  year: number,
  createdById: number,
): Promise<ClosingStep2Result> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));

  const rows = await db
    .select({
      accountNumber: journalLinesTable.accountNumber,
      debitAmount: journalLinesTable.debitAmount,
      creditAmount: journalLinesTable.creditAmount,
    })
    .from(journalLinesTable)
    .innerJoin(transactionsTable, eq(journalLinesTable.transactionId, transactionsTable.id))
    .where(
      and(
        eq(transactionsTable.clientId, clientId),
        eq(transactionsTable.firmId, firmId),
        eq(transactionsTable.status, "valide"),
        gte(transactionsTable.date, yearStart),
        lt(transactionsTable.date, yearEndExclusive),
      ),
    );

  // Accumulate net debit/credit per account.
  const accountBalances = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    const cur = accountBalances.get(row.accountNumber) ?? { debit: 0, credit: 0 };
    accountBalances.set(row.accountNumber, {
      debit: cur.debit + row.debitAmount,
      credit: cur.credit + row.creditAmount,
    });
  }

  // Class 6 (charges) — normal debit balance.
  let totalClass6Debits = 0;
  const class6Lines: Array<{ accountNumber: string; netDebit: number }> = [];
  for (const [acct, bal] of accountBalances.entries()) {
    if (!acct.startsWith("6")) continue;
    const net = bal.debit - bal.credit;
    if (net > 0) {
      totalClass6Debits += net;
      class6Lines.push({ accountNumber: acct, netDebit: net });
    }
  }

  // Class 7 (produits) — normal credit balance.
  let totalClass7Credits = 0;
  const class7Lines: Array<{ accountNumber: string; netCredit: number }> = [];
  for (const [acct, bal] of accountBalances.entries()) {
    if (!acct.startsWith("7")) continue;
    const net = bal.credit - bal.debit;
    if (net > 0) {
      totalClass7Credits += net;
      class7Lines.push({ accountNumber: acct, netCredit: net });
    }
  }

  const netResult = totalClass7Credits - totalClass6Debits;
  const resultAccount: "1301" | "1309" = netResult >= 0 ? "1301" : "1309";
  const absNet = Math.abs(netResult);

  // Build the balanced closing entry:
  //   Dr each Class 7 account (clearing revenues to zero)
  //   Cr each Class 6 account (clearing expenses to zero)
  //   Cr 1301 if bénéfice, or Dr 1309 if perte
  const closingLines: Array<{
    accountNumber: string;
    label: string;
    debitAmount: number;
    creditAmount: number;
  }> = [];

  for (const l of class7Lines) {
    closingLines.push({
      accountNumber: l.accountNumber,
      label: `Solde créditeur — Produits ${l.accountNumber} — Exercice ${year}`,
      debitAmount: l.netCredit,
      creditAmount: 0,
    });
  }
  for (const l of class6Lines) {
    closingLines.push({
      accountNumber: l.accountNumber,
      label: `Solde débiteur — Charges ${l.accountNumber} — Exercice ${year}`,
      debitAmount: 0,
      creditAmount: l.netDebit,
    });
  }
  if (netResult >= 0) {
    closingLines.push({
      accountNumber: "130100",
      label: `Résultat net de l'exercice — Bénéfice — Exercice ${year}`,
      debitAmount: 0,
      creditAmount: absNet,
    });
  } else {
    closingLines.push({
      accountNumber: "130900",
      label: `Résultat net de l'exercice — Perte — Exercice ${year}`,
      debitAmount: absNet,
      creditAmount: 0,
    });
  }

  const totalAmount =
    class7Lines.reduce((s, l) => s + l.netCredit, 0) +
    class6Lines.reduce((s, l) => s + l.netDebit, 0);

  const [closingTx] = await db
    .insert(transactionsTable)
    .values({
      firmId,
      clientId,
      date: new Date(`${year}-12-31T23:59:00.000Z`),
      label: `Clôture annuelle et virement du résultat — Exercice ${year}`,
      amount: totalAmount,
      type: "depense",
      category: null,
      paymentType: "cash",
      paymentMethod: null,
      status: "valide",
      source: "closing_result",
      createdById,
      anomalies: [],
      validatedAt: new Date(),
      validatedById: createdById,
    })
    .returning();

  if (closingLines.length > 0) {
    await db.insert(journalLinesTable).values(
      closingLines.map((l) => ({ ...l, transactionId: closingTx.id })),
    );
  }

  return {
    totalClass6Debits,
    totalClass7Credits,
    netResult,
    resultAccount,
    closingTransactionId: closingTx.id,
  };
}

/**
 * Step 4: carry forward the closing balances of permanent accounts (Classes
 * 1-5) as the Journal des À-nouveaux for year+1.
 */
async function generateOpeningBalances(
  firmId: number,
  clientId: number,
  year: number,
  createdById: number,
): Promise<ClosingStep4Result> {
  // Include ALL validated entries up to and including the closing year (so
  // the result account 131/139 we just posted is included).
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));

  const rows = await db
    .select({
      accountNumber: journalLinesTable.accountNumber,
      debitAmount: journalLinesTable.debitAmount,
      creditAmount: journalLinesTable.creditAmount,
    })
    .from(journalLinesTable)
    .innerJoin(transactionsTable, eq(journalLinesTable.transactionId, transactionsTable.id))
    .where(
      and(
        eq(transactionsTable.clientId, clientId),
        eq(transactionsTable.firmId, firmId),
        eq(transactionsTable.status, "valide"),
        lt(transactionsTable.date, yearEndExclusive),
      ),
    );

  // Net balance per balance-sheet account (Classes 1–5 + result 131/139).
  const balances = new Map<string, number>(); // positive = debit balance
  for (const row of rows) {
    const cls = row.accountNumber[0];
    if (!cls || !["1", "2", "3", "4", "5"].includes(cls)) continue;
    const cur = balances.get(row.accountNumber) ?? 0;
    balances.set(row.accountNumber, cur + row.debitAmount - row.creditAmount);
  }

  const aNouvLines: Array<{
    accountNumber: string;
    label: string;
    debitAmount: number;
    creditAmount: number;
  }> = [];

  for (const [acct, net] of balances.entries()) {
    if (net === 0) continue;
    aNouvLines.push({
      accountNumber: acct,
      label: `À-nouveau — ${acct} — Exercice ${year + 1}`,
      debitAmount: net > 0 ? net : 0,
      creditAmount: net < 0 ? -net : 0,
    });
  }

  if (aNouvLines.length === 0) {
    return { accountsCarriedForward: 0, openingTransactionId: null };
  }

  const totalAmount = aNouvLines.reduce(
    (s, l) => s + l.debitAmount + l.creditAmount,
    0,
  );

  const [aNouvTx] = await db
    .insert(transactionsTable)
    .values({
      firmId,
      clientId,
      date: new Date(`${year + 1}-01-01T00:00:00.000Z`),
      label: `Journal des À-nouveaux — Exercice ${year + 1} (reprise soldes exercice ${year})`,
      amount: totalAmount,
      type: "recette",
      category: null,
      paymentType: "cash",
      paymentMethod: null,
      status: "valide",
      source: "a_nouveaux",
      createdById,
      anomalies: [],
      validatedAt: new Date(),
      validatedById: createdById,
    })
    .returning();

  await db.insert(journalLinesTable).values(
    aNouvLines.map((l) => ({ ...l, transactionId: aNouvTx.id })),
  );

  return {
    accountsCarriedForward: aNouvLines.length,
    openingTransactionId: aNouvTx.id,
  };
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/** Run the full 4-step SYSCOHADA fiscal year closing routine. */
export async function closeFiscalYear(
  firmId: number,
  clientId: number,
  year: number,
  createdById: number,
): Promise<ClosePeriodEngineResult> {
  if (await isPeriodLocked(firmId, clientId, year)) {
    throw new PeriodLockedError(year);
  }

  // Step 1 — Year-end adjustments.
  const dep = await runDepreciationAdjustments(firmId, clientId, year, createdById);
  const fin = await runFinanceAdjustments(firmId, clientId, year, createdById);
  const step1: ClosingStep1Result = {
    depreciationEntriesGenerated: dep.generated,
    depreciationEntriesSkipped: dep.skipped,
    financeEntriesGenerated: fin.generated,
    financeEntriesSkipped: fin.skipped,
  };

  // Step 2 — Net result & clearing entry.
  const step2 = await computeAndPostNetResult(firmId, clientId, year, createdById);

  // Step 3 — Lock the period.
  const now = new Date();
  await db
    .insert(fiscalYearClosingsTable)
    .values({
      firmId,
      clientId,
      year,
      status: "LOCKED",
      netResult: step2.netResult,
      netResultAccount: step2.resultAccount,
      openingBalanceGenerated: false,
      lockedAt: now,
      lockedById: createdById,
    })
    .onConflictDoUpdate({
      target: [
        fiscalYearClosingsTable.firmId,
        fiscalYearClosingsTable.clientId,
        fiscalYearClosingsTable.year,
      ],
      set: {
        status: "LOCKED",
        netResult: step2.netResult,
        netResultAccount: step2.resultAccount,
        lockedAt: now,
        lockedById: createdById,
      },
    });

  // Step 4 — Generate À-nouveaux for year+1.
  const step4 = await generateOpeningBalances(firmId, clientId, year, createdById);

  await db
    .update(fiscalYearClosingsTable)
    .set({ openingBalanceGenerated: step4.openingTransactionId !== null })
    .where(
      and(
        eq(fiscalYearClosingsTable.firmId, firmId),
        eq(fiscalYearClosingsTable.clientId, clientId),
        eq(fiscalYearClosingsTable.year, year),
      ),
    );

  // Step 5 — Create the locked GED archive folder tree for this fiscal year.
  // Runs after the period lock so the folders are created only on a successful
  // close. Idempotent: safe to re-run if the closing is retried.
  await createFiscalArchiveFolders(firmId, clientId, year, createdById);

  return { clientId, year, step1, step2, lockedAt: now.toISOString(), step4 };
}
