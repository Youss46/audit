import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  accountsTable,
} from "@workspace/db";
import {
  GetBalanceDesComptesQueryParams,
  GetBalanceDesComptesResponse,
  GetBilanSimplifieQueryParams,
  GetBilanSimplifieResponse,
  GetCompteDeResultatQueryParams,
  GetCompteDeResultatResponse,
  GetGrandLivreQueryParams,
  GetGrandLivreResponse,
  GetPilotageDashboardQueryParams,
  GetPilotageDashboardResponse,
  ExportLiasseFiscaleBody,
  ExportLiasseFiscaleResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { CATEGORY_RULES } from "../lib/accounting-engine";
import {
  computeBalanceDesComptes,
  computeBilanSimplifie,
  computeCompteDeResultat,
  computeGrandLivre,
  computePilotageAggregates,
  type LedgerLine,
} from "../lib/reporting-engine";
import {
  generateBalancePdf,
  generateBalanceExcel,
  generateFinancialStatementsPdf,
  generateFinancialStatementsExcel,
} from "../lib/export-engine";

const router: IRouter = Router();

router.use(requireAuth);

const MOIS_FR = [
  "Janv.",
  "Févr.",
  "Mars",
  "Avr.",
  "Mai",
  "Juin",
  "Juil.",
  "Août",
  "Sept.",
  "Oct.",
  "Nov.",
  "Déc.",
];

// Every reporting statement is computed live from the validated ("valide")
// general ledger only -- an "à valider" or "anomalie" entry has not been
// accepted into the books yet and must never appear in a financial
// statement. Fetches every validated journal line ever booked for the
// client (not just the selected year) so the aggregation functions can
// correctly split "solde initial" (before the fiscal year) from "mouvements
// de l'exercice" (within it).
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
      // Module M21: needed to reconstruct the "comptabilité de trésorerie"
      // (cash-basis) view of the dashboard.
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

// Module M3 reporting: "La Balance des Comptes".
router.get("/reports/balance", requirePermission("pilotage.view"), async (req, res) => {
  const { clientId, year } = GetBalanceDesComptesQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const rows = computeBalanceDesComptes(lines, yearStart, yearEndExclusive);

  res.json(GetBalanceDesComptesResponse.parse({ clientId, year, rows }));
});

// Module M3 reporting: "Le Bilan Simplifié".
router.get("/reports/bilan", requirePermission("pilotage.view"), async (req, res) => {
  const { clientId, year } = GetBilanSimplifieQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const bilan = computeBilanSimplifie(lines, yearStart, yearEndExclusive);

  res.json(GetBilanSimplifieResponse.parse({ clientId, year, ...bilan }));
});

// Module M3 reporting: "Le Compte de Résultat Simplifié".
router.get("/reports/compte-resultat", requirePermission("pilotage.view"), async (req, res) => {
  const { clientId, year } = GetCompteDeResultatQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const compteResultat = computeCompteDeResultat(lines, yearStart, yearEndExclusive);

  res.json(GetCompteDeResultatResponse.parse({ clientId, year, ...compteResultat }));
});

// Module M3 reporting: "Le Grand Livre" -- every SYSCOHADA account grouped
// with its chronological movements and running balance.
router.get("/reports/grand-livre", requirePermission("pilotage.view"), async (req, res) => {
  const { clientId, year } = GetGrandLivreQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const accounts = computeGrandLivre(lines, yearStart, yearEndExclusive);

  res.json(GetGrandLivreResponse.parse({ clientId, year, accounts }));
});

// Module P4/M21 (Tableau de Bord Dirigeant): plain-language dashboard for
// the PME director, plus the richer executive KPIs (marge, trésorerie
// mensuelle, seuil de rentabilité, répartition par nature) added by M21.
router.get("/reports/pilotage", requirePermission("pilotage.view"), async (req, res) => {
  const { clientId, year, basis, month } = GetPilotageDashboardQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const aggregates = computePilotageAggregates(
    lines,
    yearStart,
    yearEndExclusive,
    new Date(),
    basis ?? "engagement",
    month ?? null,
  );

  const monthLabel = (point: { year: number; month: number }) => `${MOIS_FR[point.month - 1]} ${point.year}`;

  res.json(
    GetPilotageDashboardResponse.parse({
      clientId,
      year,
      basis: basis ?? "engagement",
      tresorerieNette: aggregates.tresorerieNette,
      chiffreAffairesParMois: aggregates.chiffreAffairesParMois.map((point) => ({
        year: point.year,
        month: point.month,
        label: monthLabel(point),
        total: point.total,
      })),
      topDepenses: aggregates.topDepenses.map((entry) => ({
        categoryKey: entry.categoryKey,
        label: CATEGORY_RULES[entry.categoryKey]?.label ?? entry.categoryKey,
        total: entry.total,
      })),
      chargesParMois: aggregates.chargesParMois.map((point) => ({
        year: point.year,
        month: point.month,
        label: monthLabel(point),
        total: point.total,
      })),
      margeBruteParMois: aggregates.margeBruteParMois.map((point) => ({
        year: point.year,
        month: point.month,
        label: monthLabel(point),
        chiffreAffaires: point.chiffreAffaires,
        margeBrute: point.margeBrute,
        tauxMarge: point.tauxMarge,
      })),
      tresorerieParMois: aggregates.tresorerieParMois.map((point) => ({
        year: point.year,
        month: point.month,
        label: monthLabel(point),
        total: point.total,
      })),
      depensesParNature: aggregates.depensesParNature,
      seuilRentabilite: aggregates.seuilRentabilite,
      kpis: aggregates.kpis,
    }),
  );
});

// Module M3 Export Engine: real file generation routes.
// Both routes share the same query-param shape: clientId, year, format.
// They stream the binary result directly instead of returning JSON, so they
// are NOT wired through the OpenAPI codegen – the frontend calls them with
// fetch() + Authorization header and converts the response to a blob.

const EXPORT_FORMAT = ["pdf", "excel"] as const;
type ExportFormat = (typeof EXPORT_FORMAT)[number];

function parseExportParams(query: Record<string, unknown>): {
  clientId: number;
  year: number;
  format: ExportFormat;
} | null {
  const clientId = parseInt(String(query.clientId));
  const year = parseInt(String(query.year));
  const format = String(query.format ?? "pdf");
  if (isNaN(clientId) || isNaN(year) || !EXPORT_FORMAT.includes(format as ExportFormat)) return null;
  return { clientId, year, format: format as ExportFormat };
}

function sendFile(
  res: Parameters<typeof requireOwnClient>[1],
  buffer: Buffer,
  format: ExportFormat,
  filename: string,
): void {
  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
  } else {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  }
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer);
}

// GET /reports/exports/balance?clientId=N&year=YYYY&format=pdf|excel
// Streams a formatted Balance des Comptes document.
router.get("/reports/exports/balance", requirePermission("pilotage.view"), async (req, res) => {
  const params = parseExportParams(req.query as Record<string, unknown>);
  if (!params) {
    res.status(400).json({ error: "Paramètres invalides (clientId, year, format requis)." });
    return;
  }
  const { clientId, year, format } = params;
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const rows = computeBalanceDesComptes(lines, yearStart, yearEndExclusive);

  const buffer =
    format === "pdf"
      ? await generateBalancePdf(client.name, year, rows)
      : await generateBalanceExcel(client.name, year, rows);

  const slug = `${client.name.replace(/[^a-zA-Z0-9]/g, "_")}_Balance_${year}`;
  sendFile(res, buffer, format, slug);

  // Audit log – same action as before for traceability
  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.LIASSE_FISCALE_EXPORT,
    entityType: "client",
    entityId: clientId,
    details: `Export Balance des comptes (exercice ${year}, format ${format.toUpperCase()}) pour "${client.name}"`,
    ipAddress: req.ip,
  });
});

// GET /reports/exports/financial-statements?clientId=N&year=YYYY&format=pdf|excel
// Streams a full financial bundle: Bilan Actif/Passif + Compte de Résultat.
router.get("/reports/exports/financial-statements", requirePermission("pilotage.view"), async (req, res) => {
  const params = parseExportParams(req.query as Record<string, unknown>);
  if (!params) {
    res.status(400).json({ error: "Paramètres invalides (clientId, year, format requis)." });
    return;
  }
  const { clientId, year, format } = params;
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));
  const bilan = computeBilanSimplifie(lines, yearStart, yearEndExclusive);
  const compteResultat = computeCompteDeResultat(lines, yearStart, yearEndExclusive);

  const buffer =
    format === "pdf"
      ? await generateFinancialStatementsPdf(client.name, year, bilan, compteResultat)
      : await generateFinancialStatementsExcel(client.name, year, bilan, compteResultat);

  const slug = `${client.name.replace(/[^a-zA-Z0-9]/g, "_")}_EtatsFinanciers_${year}`;
  sendFile(res, buffer, format, slug);

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.LIASSE_FISCALE_EXPORT,
    entityType: "client",
    entityId: clientId,
    details: `Export États financiers (exercice ${year}, format ${format.toUpperCase()}) pour "${client.name}"`,
    ipAddress: req.ip,
  });
});

// Mocked "Exporter au format liasse fiscale (PDF)" action: no PDF is
// generated in this MVP, but every export attempt is still logged to the
// module M9 audit trail, since it's a compliance-relevant action a firm
// would want a trace of regardless.
router.post("/reports/export-liasse", requirePermission("pilotage.view"), async (req, res) => {
  const body = ExportLiasseFiscaleBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const client = await findAuthorizedClient(req, body.clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const REPORT_LABELS: Record<string, string> = {
    balance: "Balance des comptes",
    bilan: "Bilan simplifié",
    compte_resultat: "Compte de résultat simplifié",
  };

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.LIASSE_FISCALE_EXPORT,
    entityType: "client",
    entityId: body.clientId,
    details: `Export "${REPORT_LABELS[body.reportType] ?? body.reportType}" (exercice ${body.year}) pour "${client.name}"`,
    ipAddress: req.ip,
  });

  res.json(ExportLiasseFiscaleResponse.parse({ logged: true }));
});

export default router;
