import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  accountsTable,
  dsfMappingRulesTable,
} from "@workspace/db";
import { GetDsfParams, GetDsfResponse } from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { computeBalanceDesComptes, type LedgerLine } from "../lib/reporting-engine";
import { computeDsf, type DsfMappingRuleInput } from "../lib/dsf-engine";
import { generateDsfExcel } from "../lib/export-engine";

const router: IRouter = Router();

router.use(requireAuth);

// Same fetch as reporting.ts's fetchValidatedLedgerLines: only "valide"
// journal lines ever feed a filed financial statement. Duplicated here
// (rather than imported) because reporting.ts does not export it -- kept
// intentionally minimal (DSF only needs account/debit/credit/date, not the
// category/paymentType fields reporting.ts also enriches with).
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

async function findAuthorizedClient(req: Parameters<typeof requireOwnClient>[0], clientId: number) {
  return db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
}

/** All mapping rules (global, not firm-scoped — the SYSCOHADA mapping is standardized). */
async function fetchDsfMappingRules(): Promise<DsfMappingRuleInput[]> {
  const rows = await db.query.dsfMappingRulesTable.findMany();
  return rows.map((r) => ({ lineCode: r.lineCode, accountPatterns: r.accountPatterns }));
}

async function computeDsfForClient(clientId: number, firmId: number, year: number) {
  const lines = await fetchValidatedLedgerLines(clientId, firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const balances = computeBalanceDesComptes(lines, yearStart, yearEndExclusive);
  const rules = await fetchDsfMappingRules();
  return computeDsf(balances, rules);
}

// ---------------------------------------------------------------------------
// GET /tax/dsf/:clientId/:year — full DSF (Bilan, Compte de Résultat, TFT)
// ---------------------------------------------------------------------------

router.get("/tax/dsf/:clientId/:year", async (req, res) => {
  const { clientId, year } = GetDsfParams.parse(req.params);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const dsf = await computeDsfForClient(clientId, req.user!.firmId, year);
  res.json(GetDsfResponse.parse(dsf));
});

// ---------------------------------------------------------------------------
// GET /tax/exports/dsf?clientId=N&year=YYYY — Liasse Fiscale (Excel, 3 feuilles)
// Query-param download route (not part of the typed OpenAPI/Orval contract),
// same convention as /reports/exports/* and /tax/exports/vat-annex.
// ---------------------------------------------------------------------------

router.get("/tax/exports/dsf", async (req, res) => {
  const clientId = parseInt(String(req.query.clientId));
  const year = parseInt(String(req.query.year));
  if (isNaN(clientId) || isNaN(year)) {
    res.status(400).json({ error: "Paramètres invalides (clientId, year requis)." });
    return;
  }
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const dsf = await computeDsfForClient(clientId, req.user!.firmId, year);
  const buffer = await generateDsfExcel(client.name, year, dsf);
  const slug = `${client.name.replace(/[^a-zA-Z0-9]/g, "_")}_LiasseFiscale_DSF_${year}`;

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.xlsx"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer);

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.LIASSE_FISCALE_EXPORT,
    entityType: "client",
    entityId: clientId,
    details: `Export Liasse Fiscale DSF (Bilan, Compte de Résultat, TFT) — exercice ${year}, format Excel — pour "${client.name}"`,
    ipAddress: req.ip,
  });
});

export default router;
