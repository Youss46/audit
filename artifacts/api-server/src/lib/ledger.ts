/**
 * Shared ledger data-fetching helpers.
 * Used by both the AI Audit route (audit-visa.ts) and the Checklist Analyze
 * route (missions.ts) so the same DB join pattern is never duplicated.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  journalLinesTable,
  transactionsTable,
} from "@workspace/db";
import type { LedgerLine } from "./reporting-engine";

// ---------------------------------------------------------------------------
// Validated ledger lines for an entire client portfolio (all fiscal years).
// The caller slices to the desired period using computeBalanceDesComptes /
// computeGrandLivre, which handle the year-start / year-end filter.
// ---------------------------------------------------------------------------
export async function fetchValidatedLedgerLines(
  clientId: number,
  firmId: number,
): Promise<LedgerLine[]> {
  const rows = await db
    .select({
      accountNumber:          journalLinesTable.accountNumber,
      debitAmount:            journalLinesTable.debitAmount,
      creditAmount:           journalLinesTable.creditAmount,
      transactionDate:        transactionsTable.date,
      transactionType:        transactionsTable.type,
      category:               transactionsTable.category,
      lineLabel:              journalLinesTable.label,
      transactionLabel:       transactionsTable.label,
      transactionPaymentType: transactionsTable.paymentType,
      transactionSettledAt:   transactionsTable.settledAt,
    })
    .from(journalLinesTable)
    .innerJoin(
      transactionsTable,
      eq(journalLinesTable.transactionId, transactionsTable.id),
    )
    .where(
      and(
        eq(transactionsTable.clientId, clientId),
        eq(transactionsTable.firmId, firmId),
        eq(transactionsTable.status, "valide"),
      ),
    );

  if (rows.length === 0) return [];

  const accountNumbers = Array.from(new Set(rows.map((r) => r.accountNumber)));
  const accounts =
    accountNumbers.length > 0
      ? await db.query.accountsTable.findMany({
          where: (a, { inArray: inn }) => inn(a.accountNumber, accountNumbers),
        })
      : [];
  const byNumber = new Map(accounts.map((a) => [a.accountNumber, a]));

  return rows.map((row) => {
    const acc = byNumber.get(row.accountNumber);
    return {
      accountNumber:          row.accountNumber,
      accountName:            acc?.name ?? row.accountNumber,
      accountClass:           acc?.accountClass ?? (Number(row.accountNumber[0]) || 0),
      debitAmount:            row.debitAmount,
      creditAmount:           row.creditAmount,
      transactionDate:        row.transactionDate,
      transactionType:        row.transactionType,
      category:               row.category,
      label:                  row.lineLabel ?? row.transactionLabel,
      transactionPaymentType: row.transactionPaymentType,
      transactionSettledAt:   row.transactionSettledAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Transactions flagged as anomalies by the accounting system.
// ---------------------------------------------------------------------------
export async function fetchAnomalyTransactions(clientId: number, firmId: number) {
  return db.query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.clientId, clientId),
      eq(transactionsTable.firmId, firmId),
      eq(transactionsTable.status, "anomalie"),
    ),
    limit: 30,
  });
}
