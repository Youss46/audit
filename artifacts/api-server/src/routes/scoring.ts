import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  accountsTable,
  dsfMappingRulesTable,
  financialScoringResultsTable,
  businessValuationsTable,
} from "@workspace/db";
import {
  GetScoringDashboardParams,
  GetScoringDashboardResponse,
  SetValuationParams,
  SetValuationBody,
  SetValuationResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { computeBalanceDesComptes, type LedgerLine } from "../lib/reporting-engine";
import { computeDsf, type DsfMappingRuleInput } from "../lib/dsf-engine";
import { extractCoreMetrics, computeRatios, computeZScore, computeValuation } from "../lib/scoring-engine";
import { generateScoringExecutiveSummaryPdf } from "../lib/export-engine";

const router: IRouter = Router();

router.use(requireAuth);

// Default valuation scenario for a client/year that has never been saved
// yet — sector-standard midpoint of the 4x-8x EBE range, 10% capitalization
// rate. The accountant then adjusts these via the frontend sliders.
const DEFAULT_EBITDA_MULTIPLIER = 6;
const DEFAULT_CAPITALIZATION_RATE = 0.1;

// Same duplicated-fetch convention as routes/dsf.ts (reporting.ts does not
// export fetchValidatedLedgerLines): only "valide" journal lines ever feed a
// filed financial statement / scoring computation.
async function fetchValidatedLedgerLines(clientId: number, firmId: number): Promise<LedgerLine[]> {
  const rows = await db
    .select({
      accountNumber: journalLinesTable.accountNumber,
      debitAmount: journalLinesTable.debitAmount,
      creditAmount: journalLinesTable.creditAmount,
      transactionDate: transactionsTable.date,
      transactionType: transactionsTable.type,
      category: transactionsTable.category,
      lineLabel: journalLinesTable.label,
      transactionLabel: transactionsTable.label,
      transactionPaymentType: transactionsTable.paymentType,
      transactionSettledAt: transactionsTable.settledAt,
    })
    .from(journalLinesTable)
    .innerJoin(transactionsTable, eq(journalLinesTable.transactionId, transactionsTable.id))
    .where(
      and(
        eq(transactionsTable.clientId, clientId),
        eq(transactionsTable.firmId, firmId),
        eq(transactionsTable.status, "valide"),
      ),
    );

  const accountNumbers = Array.from(new Set(rows.map((r) => r.accountNumber)));
  const accounts =
    accountNumbers.length > 0
      ? await db.query.accountsTable.findMany({
          where: (a, { inArray }) => inArray(a.accountNumber, accountNumbers),
        })
      : [];
  const accountsByNumber = new Map(accounts.map((a) => [a.accountNumber, a]));

  return rows.map((row) => {
    const account = accountsByNumber.get(row.accountNumber);
    return {
      accountNumber: row.accountNumber,
      accountName: account?.name ?? row.accountNumber,
      accountClass: account?.accountClass ?? (Number(row.accountNumber[0]) || 0),
      debitAmount: row.debitAmount,
      creditAmount: row.creditAmount,
      transactionDate: row.transactionDate,
      transactionType: row.transactionType,
      category: row.category,
      label: row.lineLabel ?? row.transactionLabel,
      transactionPaymentType: row.transactionPaymentType,
      transactionSettledAt: row.transactionSettledAt,
    };
  });
}

async function findAuthorizedClient(firmId: number, clientId: number) {
  return db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)),
  });
}

async function fetchDsfMappingRules(): Promise<DsfMappingRuleInput[]> {
  const rows = await db.query.dsfMappingRulesTable.findMany();
  return rows.map((r) => ({ lineCode: r.lineCode, accountPatterns: r.accountPatterns }));
}

/** Recomputes core metrics + ratios + Z-Score live from the validated ledger. */
async function computeScoringForClient(clientId: number, firmId: number, year: number) {
  const lines = await fetchValidatedLedgerLines(clientId, firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const balances = computeBalanceDesComptes(lines, yearStart, yearEndExclusive);
  const rules = await fetchDsfMappingRules();
  const dsf = computeDsf(balances, rules);

  const metrics = extractCoreMetrics(dsf);
  const ratios = computeRatios(metrics);
  const zScoreResult = computeZScore(metrics);

  return { metrics, ratios, zScoreResult };
}

async function fetchOrCreateValuation(
  clientId: number,
  firmId: number,
  year: number,
  metrics: ReturnType<typeof extractCoreMetrics>,
) {
  const existing = await db.query.businessValuationsTable.findFirst({
    where: and(eq(businessValuationsTable.clientId, clientId), eq(businessValuationsTable.year, year)),
  });
  if (existing) return existing;

  const valuation = computeValuation(metrics, {
    ebitdaMultiplier: DEFAULT_EBITDA_MULTIPLIER,
    capitalizationRate: DEFAULT_CAPITALIZATION_RATE,
  });

  const [inserted] = await db
    .insert(businessValuationsTable)
    .values({
      firmId,
      clientId,
      year,
      ebitdaMultiplierValue: valuation.ebitdaMultiplierValue,
      equityValue: valuation.equityValue,
      ebitdaMultiplierUsed: DEFAULT_EBITDA_MULTIPLIER,
      capitalizationRateUsed: DEFAULT_CAPITALIZATION_RATE,
      customComments: null,
    })
    .onConflictDoNothing({
      target: [businessValuationsTable.clientId, businessValuationsTable.year],
    })
    .returning();

  if (inserted) return inserted;

  // Concurrent request already inserted it — re-read.
  return db.query.businessValuationsTable.findFirst({
    where: and(eq(businessValuationsTable.clientId, clientId), eq(businessValuationsTable.year, year)),
  });
}

// ---------------------------------------------------------------------------
// GET /analytics/scoring/:clientId/:year — full diagnostic dashboard
// (metrics, ratios, Z-Score + risk category, and the current/default
// valuation scenario), persisting the scoring snapshot on every call so the
// cabinet can track a client's risk trend year over year.
// ---------------------------------------------------------------------------

router.get("/analytics/scoring/:clientId/:year", async (req, res) => {
  const { clientId, year } = GetScoringDashboardParams.parse(req.params);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req.user!.firmId, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const { metrics, ratios, zScoreResult } = await computeScoringForClient(clientId, req.user!.firmId, year);

  const [scoringRow] = await db
    .insert(financialScoringResultsTable)
    .values({
      firmId: req.user!.firmId,
      clientId,
      year,
      zScore: zScoreResult.zScore,
      solvencyRatio: ratios.solvencyRatio ?? 0,
      debtToEquity: ratios.debtToEquity ?? 0,
      netWorkingCapital: Math.round(ratios.netWorkingCapital),
      returnOnEquity: ratios.returnOnEquity ?? 0,
      currentRatio: ratios.currentRatio ?? 0,
      riskCategory: zScoreResult.riskCategory,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [financialScoringResultsTable.clientId, financialScoringResultsTable.year],
      set: {
        zScore: zScoreResult.zScore,
        solvencyRatio: ratios.solvencyRatio ?? 0,
        debtToEquity: ratios.debtToEquity ?? 0,
        netWorkingCapital: Math.round(ratios.netWorkingCapital),
        returnOnEquity: ratios.returnOnEquity ?? 0,
        currentRatio: ratios.currentRatio ?? 0,
        riskCategory: zScoreResult.riskCategory,
        computedAt: new Date(),
      },
    })
    .returning();

  const valuation = await fetchOrCreateValuation(clientId, req.user!.firmId, year, metrics);

  res.json(
    GetScoringDashboardResponse.parse({
      clientId,
      year,
      metrics,
      ratios,
      zScore: zScoreResult.zScore,
      riskCategory: zScoreResult.riskCategory,
      riskExplanationFr: zScoreResult.riskExplanationFr,
      computedAt: scoringRow.computedAt.toISOString(),
      valuation: {
        ebitdaMultiplierUsed: valuation!.ebitdaMultiplierUsed,
        ebitdaMultiplierValue: valuation!.ebitdaMultiplierValue,
        capitalizationRateUsed: valuation!.capitalizationRateUsed,
        capitalizedEarningsValue:
          valuation!.capitalizationRateUsed > 0 ? Math.round(metrics.netIncome / valuation!.capitalizationRateUsed) : 0,
        equityValue: valuation!.equityValue,
        customComments: valuation!.customComments,
        updatedAt: valuation!.updatedAt.toISOString(),
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// PUT /analytics/scoring/:clientId/:year/valuation — the accountant adjusts
// the EBITDA multiplier / capitalization rate sliders and saves the scenario.
// ---------------------------------------------------------------------------

router.put("/analytics/scoring/:clientId/:year/valuation", async (req, res) => {
  const { clientId, year } = SetValuationParams.parse(req.params);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req.user!.firmId, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const input = SetValuationBody.parse(req.body);
  const { metrics } = await computeScoringForClient(clientId, req.user!.firmId, year);
  const valuation = computeValuation(metrics, {
    ebitdaMultiplier: input.ebitdaMultiplier,
    capitalizationRate: input.capitalizationRate,
  });

  const [row] = await db
    .insert(businessValuationsTable)
    .values({
      firmId: req.user!.firmId,
      clientId,
      year,
      ebitdaMultiplierValue: valuation.ebitdaMultiplierValue,
      equityValue: valuation.equityValue,
      ebitdaMultiplierUsed: input.ebitdaMultiplier,
      capitalizationRateUsed: input.capitalizationRate,
      customComments: input.customComments ?? null,
    })
    .onConflictDoUpdate({
      target: [businessValuationsTable.clientId, businessValuationsTable.year],
      set: {
        ebitdaMultiplierValue: valuation.ebitdaMultiplierValue,
        equityValue: valuation.equityValue,
        ebitdaMultiplierUsed: input.ebitdaMultiplier,
        capitalizationRateUsed: input.capitalizationRate,
        customComments: input.customComments ?? null,
      },
    })
    .returning();

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.BUSINESS_VALUATION_UPDATE,
    entityType: "client",
    entityId: clientId,
    details: `Scénario d'évaluation d'entreprise mis à jour (multiple EBE ${input.ebitdaMultiplier}x, taux de capitalisation ${(input.capitalizationRate * 100).toFixed(1)}%) — exercice ${year}`,
    ipAddress: req.ip,
  });

  res.json(
    SetValuationResponse.parse({
      ebitdaMultiplierUsed: row.ebitdaMultiplierUsed,
      ebitdaMultiplierValue: row.ebitdaMultiplierValue,
      capitalizationRateUsed: row.capitalizationRateUsed,
      capitalizedEarningsValue: valuation.capitalizedEarningsValue,
      equityValue: row.equityValue,
      customComments: row.customComments,
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
});

// ---------------------------------------------------------------------------
// GET /analytics/exports/scoring?clientId=&year= — Executive summary PDF
// (query-param download route, same convention as /tax/exports/dsf).
// ---------------------------------------------------------------------------

router.get("/analytics/exports/scoring", async (req, res) => {
  const clientId = parseInt(String(req.query.clientId));
  const year = parseInt(String(req.query.year));
  if (isNaN(clientId) || isNaN(year)) {
    res.status(400).json({ error: "Paramètres invalides (clientId, year requis)." });
    return;
  }
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req.user!.firmId, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const { metrics, ratios, zScoreResult } = await computeScoringForClient(clientId, req.user!.firmId, year);
  const valuation = await fetchOrCreateValuation(clientId, req.user!.firmId, year, metrics);

  const buffer = await generateScoringExecutiveSummaryPdf(client.name, year, {
    ratios,
    zScoreResult,
    valuation: {
      ebitdaMultiplierUsed: valuation!.ebitdaMultiplierUsed,
      ebitdaMultiplierValue: valuation!.ebitdaMultiplierValue,
      capitalizationRateUsed: valuation!.capitalizationRateUsed,
      capitalizedEarningsValue:
        valuation!.capitalizationRateUsed > 0 ? Math.round(metrics.netIncome / valuation!.capitalizationRateUsed) : 0,
      equityValue: valuation!.equityValue,
      customComments: valuation!.customComments,
    },
  });
  const slug = `${client.name.replace(/[^a-zA-Z0-9]/g, "_")}_Scoring_Evaluation_${year}`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer);

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.SCORING_EXPORT,
    entityType: "client",
    entityId: clientId,
    details: `Export Synthèse Exécutive — Scoring Financier & Évaluation d'Entreprise — exercice ${year} — pour "${client.name}"`,
    ipAddress: req.ip,
  });
});

export default router;
