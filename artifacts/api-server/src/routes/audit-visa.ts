/**
 * Module M16 — AI Audit Assistant (Mission Visa)
 * POST /audit/visa-check/:clientId
 *
 * Compiles the Grand Livre, Balance des Comptes, and anomaly log for the
 * requested fiscal year, then calls the Gemini API to produce a structured
 * compliance checklist and an executive audit summary suitable for inclusion
 * in the permanent audit file.
 */
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  accountsTable,
} from "@workspace/db";
import { requireAuth, requireOwnClient, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  computeBalanceDesComptes,
  computeGrandLivre,
  type LedgerLine,
} from "../lib/reporting-engine";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Data fetching helpers — mirrors the pattern in reporting.ts exactly.
// ---------------------------------------------------------------------------
async function fetchValidatedLedgerLines(
  clientId: number,
  firmId: number,
): Promise<LedgerLine[]> {
  const rows = await db
    .select({
      accountNumber:            journalLinesTable.accountNumber,
      debitAmount:              journalLinesTable.debitAmount,
      creditAmount:             journalLinesTable.creditAmount,
      transactionDate:          transactionsTable.date,
      transactionType:          transactionsTable.type,
      category:                 transactionsTable.category,
      lineLabel:                journalLinesTable.label,
      transactionLabel:         transactionsTable.label,
      transactionPaymentType:   transactionsTable.paymentType,
      transactionSettledAt:     transactionsTable.settledAt,
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
      accountNumber:          row.accountNumber,
      accountName:            account?.name ?? row.accountNumber,
      accountClass:           account?.accountClass ?? (Number(row.accountNumber[0]) || 0),
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

async function fetchAnomalyTransactions(clientId: number, firmId: number) {
  return db.query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.clientId, clientId),
      eq(transactionsTable.firmId, firmId),
      eq(transactionsTable.status, "anomalie"),
    ),
    limit: 30,
  });
}

// ---------------------------------------------------------------------------
// Gemini system prompt — instructs the model to act as a SYSCOHADA auditor.
// All AI output fields must be in French; schema keys stay in English.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a senior Chartered Accountant (Expert-Comptable) and certified SYSCOHADA auditor responsible for issuing the "Visa National / SYSCOHADA" compliance certification for West African accounting firms operating under OHADA law.

Perform a rigorous compliance audit of the provided accounting data for the fiscal year under review. Audit every dimension listed below:

1. INTERNAL CONSISTENCY — verify that all Class 1-9 accounts are correctly classified; flag any account used for a purpose inconsistent with the SYSCOHADA chart of accounts.
2. CASH VIOLATIONS — any negative balance on Class 5 accounts (Trésorerie) is a critical irregularity and must be flagged as CRITICAL.
3. FISCAL RISK — flag unusually high Class 6 expense totals, expense-to-revenue ratios above 90 %, suspiciously round amounts, or atypical patterns that could attract tax authority scrutiny.
4. GRAND LIVRE ANOMALIES — flag uncleared suspense accounts (Class 47/48), excessive Class 4 outstanding receivables/payables, duplicate amounts, or entries with missing labels.
5. SYSCOHADA COMPLIANCE — flag any misclassified account, incorrect account numbering, or entries that violate OHADA Uniform Act on Accounting Law.
6. SYSTEM ANOMALIES — analyse every transaction flagged as "anomalie" by the accounting system and assess its materiality.

RESPONSE FORMAT: Return ONLY a valid JSON object — no markdown fences, no prose outside the JSON.

JSON schema (strict):
{
  "checkpoints": [
    {
      "id": "CP-001",
      "category": "Cash | Fiscal | Coherence | SYSCOHADA | Anomalies",
      "title": "Concise French title for the checkpoint (max 12 words)",
      "status": "PASSED | WARNING | CRITICAL",
      "severity": "OK | ATTENTION | CRITIQUE",
      "details": "2–5 sentences of detailed professional French analysis. Reference specific account numbers and amounts when flagging issues."
    }
  ],
  "executive_summary": "A complete, self-contained paragraph of 200–400 words in pristine professional French, suitable for direct inclusion in the permanent audit file (dossier permanent). Must name the client, the fiscal year, summarise the key findings, and conclude with a formal recommendation: whether the Visa National SYSCOHADA can be issued (délivré), issued with reservations (délivré sous réserve), or must be withheld pending corrections (différé en attente de corrections)."
}

Generate between 6 and 12 checkpoints. Every finding in executive_summary must be traceable to at least one checkpoint. All French text must be at the level of a senior Expert-Comptable filing with the Ordre des Experts-Comptables de Côte d'Ivoire.`;

// ---------------------------------------------------------------------------
// POST /audit/visa-check/:clientId?year=YYYY
// ---------------------------------------------------------------------------
router.post(
  "/audit/visa-check/:clientId",
  requirePermission("pilotage.view"),
  async (req, res) => {
    // ── 1. Parse & validate parameters ──────────────────────────────────────
    const clientId = parseInt(String(req.params.clientId), 10);
    if (isNaN(clientId)) {
      res.status(400).json({ error: "Invalid clientId parameter." });
      return;
    }
    if (!requireOwnClient(req, res, clientId)) return;

    const rawYear = req.query.year;
    const year    = rawYear ? parseInt(String(rawYear), 10) : new Date().getFullYear();
    if (isNaN(year) || year < 2000 || year > 2100) {
      res.status(400).json({ error: "Invalid year query parameter." });
      return;
    }

    // ── 2. Verify client ownership ───────────────────────────────────────────
    const client = await db.query.clientsTable.findFirst({
      where: and(
        eq(clientsTable.id, clientId),
        eq(clientsTable.firmId, req.user!.firmId),
      ),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    // ── 3. Fetch all source data in parallel ─────────────────────────────────
    const [ledgerLines, anomalyTransactions] = await Promise.all([
      fetchValidatedLedgerLines(clientId, req.user!.firmId),
      fetchAnomalyTransactions(clientId, req.user!.firmId),
    ]);

    const yearStart       = new Date(Date.UTC(year, 0, 1));
    const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));

    const grandLivreAccounts = computeGrandLivre(ledgerLines, yearStart, yearEndExclusive);
    const balance            = computeBalanceDesComptes(ledgerLines, yearStart, yearEndExclusive);

    // ── 4. Build the structured text payload for the AI ───────────────────────
    const totalRevenue  = balance
      .filter((r) => r.accountNumber.startsWith("7"))
      .reduce((s, r) => s + r.finalBalance, 0);
    const totalExpenses = balance
      .filter((r) => r.accountNumber.startsWith("6"))
      .reduce((s, r) => s + r.finalBalance, 0);
    const expenseRatioPct =
      totalRevenue > 0 ? ((totalExpenses / totalRevenue) * 100).toFixed(1) : "N/A";

    // A Class-5 (Trésorerie) account with a "crediteur" final balance is an overdraft — critical violation.
    const negativeCashAccounts = balance.filter(
      (r) => r.accountNumber.startsWith("5") && r.finalBalanceSide === "crediteur",
    );

    const balanceSummary = balance
      .map(
        (r) =>
          `${r.accountNumber} | ${r.accountName} | D=${r.totalDebit.toLocaleString("fr-FR")} | C=${r.totalCredit.toLocaleString("fr-FR")} | Solde=${r.finalBalanceSide === "crediteur" ? "-" : ""}${r.finalBalance.toLocaleString("fr-FR")} (${r.finalBalanceSide})`,
      )
      .join("\n");

    // Grand Livre: first 40 accounts, up to 8 movements each — keeps payload lean.
    const grandLivreSample = grandLivreAccounts
      .slice(0, 40)
      .map((acc) => {
        const movementsSample = acc.movements
          .slice(0, 8)
          .map((m) => `    ${m.date.toLocaleDateString("fr-FR")} | ${m.label ?? "—"} | D=${m.debitAmount.toLocaleString("fr-FR")} | C=${m.creditAmount.toLocaleString("fr-FR")} | Solde=${m.runningBalance.toLocaleString("fr-FR")} (${m.runningBalanceSide})`)
          .join("\n");
        return (
          `Compte ${acc.accountNumber} (${acc.accountName}) — Solde ouverture: ${acc.initialBalance.toLocaleString("fr-FR")} (${acc.initialBalanceSide}) | Solde clôture: ${acc.finalBalance.toLocaleString("fr-FR")} (${acc.finalBalanceSide})\n` +
          (movementsSample || "    (aucun mouvement sur l'exercice)")
        );
      })
      .join("\n\n");

    const anomalySummary =
      anomalyTransactions.length > 0
        ? anomalyTransactions
            .map(
              (t) =>
                `[ANOMALIE] ${t.date} | ${t.label ?? "—"} | Montant=${t.amount?.toLocaleString("fr-FR") ?? "?"} FCFA | Type=${t.type} | Codes=${JSON.stringify(t.anomalies)}`,
            )
            .join("\n")
        : "Aucune transaction en anomalie détectée pour cet exercice.";

    const payload = `
=== DOSSIER D'AUDIT : ${client.name} — Exercice ${year} ===
Client           : ${client.name}
Référentiel      : ${client.accountingSystem ?? "SYSCOHADA"}
Secteur          : ${client.sector ?? "Non renseigné"}
CA annuel        : ${client.annualTurnover != null ? client.annualTurnover.toLocaleString("fr-FR") + " FCFA" : "Non renseigné"}
Exercice audité  : ${year}

=== BALANCE DES COMPTES — ${balance.length} comptes ===
Numéro | Libellé | Total Débit | Total Crédit | Solde
${balanceSummary}

=== INDICATEURS CLÉS ===
Produits (Classe 7) : ${totalRevenue.toLocaleString("fr-FR")} FCFA
Charges (Classe 6)  : ${totalExpenses.toLocaleString("fr-FR")} FCFA
Ratio charges/CA    : ${expenseRatioPct} %

=== VIOLATIONS DE TRÉSORERIE (Classe 5 — Soldes négatifs) ===
${
  negativeCashAccounts.length > 0
    ? negativeCashAccounts
        .map((r) => `VIOLATION : Compte ${r.accountNumber} (${r.accountName}) = ${r.finalBalance.toLocaleString("fr-FR")} FCFA (solde créditeur)`)
        .join("\n")
    : "Aucun solde de trésorerie négatif détecté."
}

=== GRAND LIVRE — Échantillon (${Math.min(40, grandLivreAccounts.length)} comptes sur ${grandLivreAccounts.length}) ===
${grandLivreSample}

=== JOURNAL DES ANOMALIES SYSTÈME ===
${anomalySummary}
`.trim();

    // ── 5. Call Gemini ────────────────────────────────────────────────────────
    let rawResponse: string;
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error("DEEPSEEK_API_KEY environment variable is not set.");
      const dsResponse = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model:            "deepseek-chat",
          messages:         [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: payload },
          ],
          max_tokens:       8192,
          response_format:  { type: "json_object" },
        }),
      });
      if (!dsResponse.ok) {
        const errBody = await dsResponse.text();
        throw new Error(`DeepSeek ${dsResponse.status}: ${errBody}`);
      }
      const dsData = await dsResponse.json() as { choices: { message: { content: string } }[] };
      rawResponse = dsData.choices[0]?.message?.content ?? "";
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "DeepSeek audit API call failed");
      res
        .status(502)
        .json({ error: `Le service d'audit IA est temporairement indisponible. (${detail})` });
      return;
    }

    // ── 6. Parse & validate the AI response ──────────────────────────────────
    let parsed: { checkpoints: unknown[]; executive_summary: string };
    try {
      parsed = JSON.parse(rawResponse);
      if (!Array.isArray(parsed.checkpoints) || typeof parsed.executive_summary !== "string") {
        throw new Error("Unexpected response shape from AI.");
      }
    } catch (err) {
      req.log.error({ err, raw: rawResponse.slice(0, 500) }, "Failed to parse Gemini audit response");
      res.status(502).json({ error: "L'IA a retourné une réponse invalide. Veuillez réessayer." });
      return;
    }

    // ── 7. Audit trail ────────────────────────────────────────────────────────
    await logAudit({
      firmId:    req.user!.firmId,
      userId:    req.user!.id,
      userName:  req.user!.fullName,
      userRole:  req.user!.role,
      action:    AuditAction.LIASSE_FISCALE_EXPORT,
      entityType: "client",
      entityId:  clientId,
      details:   `Audit IA de conformité (Mission Visa M16) généré pour "${client.name}" — Exercice ${year}. ${parsed.checkpoints.length} points de contrôle, ${anomalyTransactions.length} anomalie(s) analysée(s).`,
      ipAddress: req.ip,
    });

    // ── 8. Return structured result ───────────────────────────────────────────
    res.json({
      clientId,
      clientName:        client.name,
      year,
      checkpoints:       parsed.checkpoints,
      executive_summary: parsed.executive_summary,
      generated_at:      new Date().toISOString(),
    });
  },
);

export default router;
