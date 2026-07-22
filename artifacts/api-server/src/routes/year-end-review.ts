// POST /audit/year-end-review
// POST /audit/year-end-review/post-entry
//
// Examen de Fin d'Exercice (Year-End Closing & AI Audit Review).
// Appelle Claude (Anthropic) pour effectuer un audit complet selon les
// règles SYSCOHADA Révisé et retourne un rapport structuré JSON.

import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, lt, lte, sql, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  fixedAssetsTable,
  fiscalYearClosingsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { canAccessClient, requireOwnClient } from "../middlewares/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountBalance {
  accountNumber: string;
  debit: number;
  credit: number;
  net: number; // debit - credit
}

interface FixedAssetSummary {
  id: number;
  label: string;
  accountNumber: string;
  acquisitionCost: number;
  acquisitionDate: string;
  usefulLifeYears: number | null;
  depreciationType: string | null;
  salvageValue: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildYearRange(year: number) {
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const end   = new Date(`${year + 1}-01-01T00:00:00.000Z`);
  return { start, end };
}

/** Aggregate journal lines into per-account balances. */
function aggregateBalances(lines: { accountNumber: string; debitAmount: number; creditAmount: number }[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();
  for (const l of lines) {
    let entry = map.get(l.accountNumber);
    if (!entry) {
      entry = { accountNumber: l.accountNumber, debit: 0, credit: 0, net: 0 };
      map.set(l.accountNumber, entry);
    }
    entry.debit  += l.debitAmount;
    entry.credit += l.creditAmount;
    entry.net     = entry.debit - entry.credit;
  }
  return [...map.values()].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

/** Sum net balance for accounts starting with a given prefix. */
function sumClass(balances: AccountBalance[], prefix: string): number {
  return balances.filter(b => b.accountNumber.startsWith(prefix)).reduce((s, b) => s + b.net, 0);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// ============================================================================
// POST /audit/year-end-review
// Body: { clientId: number, year: number }
// ============================================================================

router.post("/audit/year-end-review", requireAuth, async (req, res) => {
  const { clientId: rawClientId, year: rawYear } = req.body as { clientId?: unknown; year?: unknown };

  const clientId = Number(rawClientId);
  const year     = Number(rawYear);

  if (!Number.isInteger(clientId) || clientId <= 0)
    return res.status(400).json({ error: "clientId invalide." });
  if (!Number.isInteger(year) || year < 1990 || year > 2100)
    return res.status(400).json({ error: "Exercice invalide." });
  if (!requireOwnClient(req, res, clientId)) return;

  // ── 1. Load client ──────────────────────────────────────────────────────
  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) return res.status(404).json({ error: "Client introuvable." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(503).json({ error: "Service IA non configuré (ANTHROPIC_API_KEY manquant)." });

  // ── 2. Load journal lines for target year ───────────────────────────────
  const { start: yrStart, end: yrEnd } = buildYearRange(year);

  const currentYearTx = await db.query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.firmId, req.user!.firmId),
      eq(transactionsTable.clientId, clientId),
      eq(transactionsTable.status, "valide"),
      gte(transactionsTable.date, yrStart),
      lt(transactionsTable.date, yrEnd),
    ),
    with: { journalLines: true },
    columns: {
      id: true, date: true, label: true, type: true, amount: true,
      paymentType: true, receiptFileData: false,
    },
  });

  // All journal lines for the year
  const currentLines = currentYearTx.flatMap(tx =>
    tx.journalLines.map(l => ({
      transactionId: l.transactionId,
      accountNumber: l.accountNumber,
      label: l.label,
      debitAmount: l.debitAmount,
      creditAmount: l.creditAmount,
      transactionDate: tx.date,
      transactionLabel: tx.label,
    }))
  );

  // ── 3. Load previous year for variance analysis ─────────────────────────
  const { start: prevStart, end: prevEnd } = buildYearRange(year - 1);
  const prevYearTx = await db.query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.firmId, req.user!.firmId),
      eq(transactionsTable.clientId, clientId),
      eq(transactionsTable.status, "valide"),
      gte(transactionsTable.date, prevStart),
      lt(transactionsTable.date, prevEnd),
    ),
    with: { journalLines: true },
    columns: { id: true, date: true, label: true, type: true, amount: true },
  });
  const prevLines = prevYearTx.flatMap(tx => tx.journalLines);

  // ── 4. Load fixed assets ────────────────────────────────────────────────
  const fixedAssets = await db.query.fixedAssetsTable.findMany({
    where: and(
      eq(fixedAssetsTable.firmId, req.user!.firmId),
      eq(fixedAssetsTable.clientId, clientId),
      eq(fixedAssetsTable.status, "ACTIF"),
    ),
    columns: {
      id: true, label: true, accountNumber: true,
      acquisitionCost: true, acquisitionDate: true,
      usefulLifeYears: true, depreciationType: true, salvageValue: true,
    },
  });

  // ── 5. Aggregate balances ───────────────────────────────────────────────
  const currentBalances = aggregateBalances(currentLines);
  const prevBalances    = aggregateBalances(prevLines);

  // Key aggregates
  const totalRevenue    = -sumClass(currentBalances, "7");  // Class 7 credit → positive revenue
  const totalExpenses   =  sumClass(currentBalances, "6");  // Class 6 debit
  const netIncome       = totalRevenue - totalExpenses;

  const prevRevenue     = -sumClass(prevBalances, "7");
  const prevExpenses    =  sumClass(prevBalances, "6");

  // Class 4 receivables: 411xxx accounts with positive net (debit balance)
  const receivables411 = currentBalances.filter(b => b.accountNumber.startsWith("411") && b.net > 0);

  // Transactions without receipt (missing justification)
  const missingReceiptCount = currentYearTx.filter(tx => tx.type === "depense" && !tx.paymentType).length;

  // ── 6. Prepare compact data payload for Claude ──────────────────────────
  // Limit to top 50 lines by amount to keep tokens manageable
  const topLines = [...currentLines]
    .sort((a, b) => (b.debitAmount + b.creditAmount) - (a.debitAmount + a.creditAmount))
    .slice(0, 80)
    .map(l => ({ acc: l.accountNumber, lbl: l.label.slice(0, 60), d: l.debitAmount, c: l.creditAmount }));

  const assetsSummary: FixedAssetSummary[] = fixedAssets.map(a => ({
    id: a.id,
    label: a.label,
    accountNumber: a.accountNumber,
    acquisitionCost: a.acquisitionCost,
    acquisitionDate: a.acquisitionDate instanceof Date
      ? a.acquisitionDate.toISOString().slice(0, 10)
      : String(a.acquisitionDate),
    usefulLifeYears: a.usefulLifeYears,
    depreciationType: a.depreciationType,
    salvageValue: a.salvageValue,
  }));

  // Per-category expense comparison (Class 6 sub-accounts)
  const class6Current: Record<string, number> = {};
  const class6Prev:    Record<string, number> = {};
  for (const b of currentBalances) if (b.accountNumber.startsWith("6")) class6Current[b.accountNumber] = b.net;
  for (const b of prevBalances)    if (b.accountNumber.startsWith("6")) class6Prev[b.accountNumber]    = b.net;

  // ── 7. Call Claude ──────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `Tu es un expert-comptable DSCG certifié spécialisé en SYSCOHADA Révisé.
Tu effectues l'Examen de Fin d'Exercice (EFE) d'une entreprise ivoirienne pour l'exercice ${year}.
Tu dois analyser les données comptables fournies et produire un rapport d'audit structuré.

Règles SYSCOHADA Révisé à appliquer :
- Les comptes de classe 6 (Charges) doivent avoir un solde débiteur. Un solde créditeur est une anomalie.
- Les comptes de classe 7 (Produits) doivent avoir un solde créditeur. Un solde débiteur est anormal.
- Les comptes de classe 2 (Immobilisations) doivent être positifs. Un solde négatif est anormal.
- Les comptes d'actif (classe 1-3 côté débit, 5) doivent avoir un solde débiteur.
- Provision pour créances douteuses : compte 411xxx en solde débiteur depuis >180 jours → Débit 685100 / Crédit 491100.
- Charges constatées d'avance (CCA) : Débit 476100 / Crédit compte 6xx concerné.
- Amortissements linéaires : Débit 681200 (Dotations aux amortissements) / Crédit 28xxxx.
  Calcul : (Coût d'acquisition - Valeur résiduelle) / Durée de vie utile = annuité.
  Pour l'année d'acquisition, appliquer le prorata temporis (jours courus / 365).
- Variation >30% sur un poste de charges par rapport à N-1 = risque à signaler.
- Journal OD (Opérations Diverses) pour toutes les écritures de régularisation.

RÉPONDS UNIQUEMENT avec du JSON brut valide, sans markdown, sans explication.`;

  const userPrompt = `DONNÉES COMPTABLES — Entreprise: ${client.name} — Exercice: ${year}

## BALANCES DES COMPTES (solde final):
${JSON.stringify(currentBalances.slice(0, 100), null, 0)}

## CHARGES PAR COMPTE (N vs N-1):
N  : ${JSON.stringify(class6Current)}
N-1: ${JSON.stringify(class6Prev)}

## CHIFFRES CLÉS:
- CA N: ${totalRevenue} FCFA | CA N-1: ${prevRevenue} FCFA
- Charges N: ${totalExpenses} FCFA | Charges N-1: ${prevExpenses} FCFA
- Résultat net N: ${netIncome} FCFA
- Nombre d'écritures sans pièce: ${missingReceiptCount}

## CRÉANCES CLIENTS 411xxx À SOLDE DÉBITEUR:
${JSON.stringify(receivables411, null, 0)}

## IMMOBILISATIONS ACTIVES (pour calcul amortissements):
${JSON.stringify(assetsSummary, null, 0)}

## ÉCRITURES SIGNIFICATIVES (top 80):
${JSON.stringify(topLines, null, 0)}

Analyse complète requise. Format de réponse JSON exact:
{
  "readiness_score": <0-100, score global de préparation à la clôture>,
  "summary_stats": {
    "total_revenue": <nombre>,
    "total_expenses": <nombre>,
    "net_income": <nombre>,
    "flagged_risks_count": <nombre>
  },
  "anomalies": [
    {
      "id": "<identifiant court unique ex: ANO-001>",
      "severity": "<high|medium|low>",
      "account_code": "<numéro de compte concerné>",
      "description": "<description claire de l'anomalie détectée>",
      "recommendation": "<action corrective recommandée>"
    }
  ],
  "proposed_adjusting_entries": [
    {
      "id": "<identifiant court unique ex: OD-001>",
      "journal_code": "OD",
      "label": "<libellé comptable de l'écriture>",
      "justification": "<explication de la nécessité de cette écriture>",
      "category": "<depreciation|provision|cutoff|other>",
      "lines": [
        { "account_code": "<6 chiffres>", "account_label": "<intitulé>", "debit": <nombre ou 0>, "credit": <nombre ou 0> }
      ]
    }
  ]
}`;

  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    raw = message.content.filter(b => b.type === "text").map(b => (b as Anthropic.TextBlock).text).join("");
  } catch (err) {
    console.error("[year-end-review] Claude error:", err);
    return res.status(502).json({ error: "Erreur lors de l'appel au service IA." });
  }

  // Strip potential markdown fences
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let result: unknown;
  try {
    result = JSON.parse(jsonStr);
  } catch {
    console.error("[year-end-review] JSON parse error. Raw:", raw.slice(0, 500));
    return res.status(502).json({ error: "La réponse IA n'est pas au format attendu. Réessayez." });
  }

  return res.json(result);
});

// ============================================================================
// POST /audit/year-end-review/post-entry
// Posts a proposed adjusting entry directly to the DB as an OD transaction.
// Body: { clientId, year, entry: { label, justification, lines[] } }
// ============================================================================

router.post("/audit/year-end-review/post-entry", requireAuth, async (req, res) => {
  type EntryLine = { account_code: string; account_label: string; debit: number; credit: number };
  type EntryBody = {
    clientId?: unknown;
    year?: unknown;
    entry?: {
      label?: unknown;
      justification?: unknown;
      lines?: EntryLine[];
    };
  };

  const body = req.body as EntryBody;
  const clientId = Number(body.clientId);
  const year     = Number(body.year);
  const entry    = body.entry;

  if (!Number.isInteger(clientId) || clientId <= 0)
    return res.status(400).json({ error: "clientId invalide." });
  if (!entry?.label || !Array.isArray(entry.lines) || entry.lines.length < 2)
    return res.status(400).json({ error: "Écriture incomplète (label + au moins 2 lignes requises)." });
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) return res.status(404).json({ error: "Client introuvable." });

  // Check fiscal year not locked
  const closing = await db.query.fiscalYearClosingsTable.findFirst({
    where: and(
      eq(fiscalYearClosingsTable.firmId, req.user!.firmId),
      eq(fiscalYearClosingsTable.clientId, clientId),
      eq(fiscalYearClosingsTable.year, year),
    ),
  });
  if (closing?.status === "LOCKED")
    return res.status(403).json({ error: `L'exercice ${year} est définitivement clôturé.` });

  // Validate debit = credit
  const totalDebit  = entry.lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 1)
    return res.status(400).json({ error: "L'écriture n'est pas équilibrée (débit ≠ crédit)." });

  // Post the transaction (OD, à valider → will appear in saisie for review)
  const entryDate = new Date(`${year}-12-31T00:00:00.000Z`);

  await db.transaction(async (tx) => {
    const [transaction] = await tx.insert(transactionsTable).values({
      firmId:      req.user!.firmId,
      clientId,
      date:        entryDate,
      label:       String(entry.label).slice(0, 255),
      type:        "depense", // OD entries are neutral; using depense for schema compat
      amount:      totalDebit,
      status:      "a_valider",
      paymentType: "credit", // no immediate cash movement for OD entries
    }).returning({ id: transactionsTable.id });

    await tx.insert(journalLinesTable).values(
      entry.lines.map(l => ({
        transactionId: transaction.id,
        accountNumber: String(l.account_code).slice(0, 20),
        label:         String(l.account_label || entry.label).slice(0, 255),
        debitAmount:   Math.round(Number(l.debit)  || 0),
        creditAmount:  Math.round(Number(l.credit) || 0),
      }))
    );
  });

  return res.status(201).json({ ok: true });
});

export default router;
