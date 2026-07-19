import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db, transactionsTable, type AnomalyCode, type TransactionType } from "@workspace/db";
import type { ComputedJournalLine } from "./accounting-engine";

// Module M8 (Anomalie & Doublon Detector): a rule-based safety net that runs
// automatically whenever an entry is created (or its journal lines are
// adjusted by the accountant), *before* it reaches final M3 validation.
// Every rule here is deterministic and explainable -- no black-box
// scoring -- so the accountant can always see exactly why an entry was
// flagged and decide whether to "Forcer la validation".

const DUPLICATE_WINDOW_HOURS = 24;
const SPIKE_LOOKBACK_MONTHS = 3;
const SPIKE_MULTIPLIER = 3;

export interface AnomalyDetectionInput {
  transactionId?: number; // omitted for a not-yet-inserted row
  firmId: number;
  clientId: number;
  date: Date;
  amount: number;
  category: string | null;
  type: TransactionType;
  journalLines: Pick<ComputedJournalLine, "accountNumber">[];
}

// Rule 1 (Doublons): another transaction for the same client, same exact
// amount, within a 24h window of this one's date. Excludes settlement/
// caisse_closure noise implicitly by only matching on client+amount+date --
// a genuine duplicate declaration (PME accidentally submitting twice, or a
// pièce scanned twice) always collides on those three fields regardless of
// source.
async function detectDuplicate(input: AnomalyDetectionInput): Promise<boolean> {
  const windowMs = DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000;
  const windowStart = new Date(input.date.getTime() - windowMs);
  const windowEnd = new Date(input.date.getTime() + windowMs);

  const conditions = [
    eq(transactionsTable.firmId, input.firmId),
    eq(transactionsTable.clientId, input.clientId),
    eq(transactionsTable.amount, input.amount),
    gte(transactionsTable.date, windowStart),
    lte(transactionsTable.date, windowEnd),
  ];
  if (input.transactionId != null) {
    conditions.push(ne(transactionsTable.id, input.transactionId));
  }

  const match = await db.query.transactionsTable.findFirst({
    where: and(...conditions),
  });
  return match != null;
}

// Rule 2 (Incohérence comptable): a dépense should never book its
// counterpart leg against a class 7 (produits) account, and a recette
// should never book against a class 6 (charges) account. The automated
// matching engine (accounting-engine.ts) never produces this by itself,
// but the accountant can manually redirect a journal line's account number
// (PATCH /transactions/:id/journal-lines), so this rule catches an account
// class left inconsistent with the operation's actual nature after such an
// edit.
function detectAccountingIncoherence(input: AnomalyDetectionInput): boolean {
  return input.journalLines.some((line) => {
    const accountClass = line.accountNumber.charAt(0);
    if (input.type === "depense" && accountClass === "7") return true;
    if (input.type === "recette" && accountClass === "6") return true;
    return false;
  });
}

// Rule 3 (Montant anormal): compares this amount against the trailing
// 3-month average for the same client + category. Flags it when it's more
// than 3x that average. Requires at least one prior entry in the window --
// a first-ever entry in a category has no baseline to compare against, so
// it is never flagged on that basis alone.
async function detectAmountSpike(input: AnomalyDetectionInput): Promise<boolean> {
  if (!input.category) return false;

  const lookbackStart = new Date(input.date);
  lookbackStart.setMonth(lookbackStart.getMonth() - SPIKE_LOOKBACK_MONTHS);

  const conditions = [
    eq(transactionsTable.firmId, input.firmId),
    eq(transactionsTable.clientId, input.clientId),
    eq(transactionsTable.category, input.category),
    gte(transactionsTable.date, lookbackStart),
    lte(transactionsTable.date, input.date),
  ];
  if (input.transactionId != null) {
    conditions.push(ne(transactionsTable.id, input.transactionId));
  }

  const [row] = await db
    .select({
      avgAmount: sql<string | null>`avg(${transactionsTable.amount})`,
      count: sql<string>`count(*)`,
    })
    .from(transactionsTable)
    .where(and(...conditions));

  const historyCount = Number(row?.count ?? 0);
  const average = row?.avgAmount != null ? Number(row.avgAmount) : null;
  if (historyCount < 1 || average == null || average <= 0) return false;

  return input.amount > average * SPIKE_MULTIPLIER;
}

export async function detectAnomalies(input: AnomalyDetectionInput): Promise<AnomalyCode[]> {
  const [isDuplicate, isIncoherent, isSpike] = await Promise.all([
    detectDuplicate(input),
    Promise.resolve(detectAccountingIncoherence(input)),
    detectAmountSpike(input),
  ]);

  const anomalies: AnomalyCode[] = [];
  if (isDuplicate) anomalies.push("DOUBLON_SUSPECT");
  if (isIncoherent) anomalies.push("INCOHERENCE_COMPTABLE");
  if (isSpike) anomalies.push("MONTANT_ANORMAL");
  return anomalies;
}
