/**
 * Module M8-Fraud — Détection de Doublons & Scoring IA de Conformité
 *
 * POST /purchases/duplicate-check
 *   Checks the purchase registry for potential duplicates before a new
 *   purchase is saved: matches on supplierNcc, invoiceRef, or same amount
 *   within a 60-day window. Returns a list of suspect matches so the
 *   accountant can decide whether to proceed or discard.
 *
 * POST /audit/risk-score
 *   Calls the Claude API to produce a 0-100 compliance score + structured
 *   recommendations for a specific client/month. Feeds it the journal lines
 *   aggregated by account class, the TVA gap, and anomaly transactions.
 */
import { Router, type IRouter } from "express";
import { and, eq, gte, lte, ne, or } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import {
  db,
  clientsTable,
  purchasesTable,
  transactionsTable,
  journalLinesTable,
} from "@workspace/db";
import { requireAuth, requireOwnClient } from "../middlewares/auth";
import {
  CheckPurchaseDuplicateBody,
  ComputeRiskScoreBody,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth);

// ── POST /purchases/duplicate-check ─────────────────────────────────────────
router.post("/purchases/duplicate-check", async (req, res) => {
  const body = CheckPurchaseDuplicateBody.parse(req.body);
  const { clientId, supplierNcc, invoiceRef, amountTtc, date, excludePurchaseId } = body;

  if (!requireOwnClient(req, res, clientId)) return;

  const dateObj  = new Date(date);
  const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
  const windowStart   = new Date(dateObj.getTime() - SIXTY_DAYS_MS);
  const windowEnd     = new Date(dateObj.getTime() + SIXTY_DAYS_MS);

  const baseConditions = [
    eq(purchasesTable.firmId, req.user!.firmId),
    eq(purchasesTable.clientId, clientId),
  ];
  if (excludePurchaseId != null) {
    baseConditions.push(ne(purchasesTable.id, excludePurchaseId));
  }

  // OR-match: NCC exact match, invoice ref match, or same amount ± 60 days
  const orConditions = [];
  if (supplierNcc) {
    orConditions.push(eq(purchasesTable.supplierNcc, supplierNcc));
  }
  if (invoiceRef) {
    orConditions.push(eq(purchasesTable.invoiceRef, invoiceRef));
  }
  orConditions.push(
    and(
      eq(purchasesTable.amountTtc, amountTtc),
      gte(purchasesTable.date, windowStart),
      lte(purchasesTable.date, windowEnd),
    )!,
  );

  const matches = await db.query.purchasesTable.findMany({
    where: and(...baseConditions, or(...orConditions)),
    limit: 5,
    orderBy: (t, { desc }) => [desc(t.date)],
  });

  const serialized = matches.map((m) => {
    const reasons: string[] = [];
    if (supplierNcc && m.supplierNcc === supplierNcc) {
      reasons.push("NCC fournisseur identique");
    }
    if (invoiceRef && m.invoiceRef === invoiceRef) {
      reasons.push("Référence facture identique");
    }
    if (m.amountTtc === amountTtc && m.date >= windowStart && m.date <= windowEnd) {
      reasons.push(
        `Montant identique (${amountTtc.toLocaleString("fr-FR")} FCFA) dans la fenêtre de 60 jours`,
      );
    }
    return {
      id: m.id,
      supplierName: m.supplierName,
      invoiceRef: m.invoiceRef ?? null,
      amountTtc: m.amountTtc,
      date: m.date.toISOString(),
      matchReason: reasons.join(" · ") || "Achat similaire détecté",
    };
  });

  res.json({ hasDuplicate: serialized.length > 0, matches: serialized });
});

// ── POST /audit/risk-score ───────────────────────────────────────────────────
const RISK_SCORE_SYSTEM_PROMPT = `Tu es un Expert-Comptable senior et auditeur SYSCOHADA certifié. \
Tu analyses les données comptables mensuelles d'une PME et tu génères un rapport de conformité \
et de risque fiscal.

MISSION : Analyser les données fournies et retourner un JSON structuré évaluant :
1. La cohérence TVA (écart entre TVA collectée et TVA théorique sur le CA déclaré)
2. Les anomalies comptables (doublons, incohérences de compte, montants anormaux)
3. Le ratio charges/revenus et sa cohérence sectorielle
4. Le risque global de redressement fiscal ou d'irrégularité comptable

RÉPONSE : Retourne UNIQUEMENT un JSON valide (sans markdown) respectant exactement ce schéma :
{
  "score": <entier entre 0 et 100, 100 = parfaitement conforme>,
  "level": "<BON|ATTENTION|CRITIQUE>",
  "vatAnalysis": {
    "consistencyOk": <true|false>,
    "summary": "<analyse TVA en 2-3 phrases professionnelles>"
  },
  "anomalies": [
    {
      "code": "<code court ex: TVA_ECART, RATIO_CHARGES, DOUBLON_SUSPECT, MONTANT_ANORMAL, COMPTE_INCOHERENT>",
      "label": "<titre court en français, max 8 mots>",
      "severity": "<INFO|AVERTISSEMENT|CRITIQUE>",
      "detail": "<2-4 phrases d'analyse avec montants précis, niveau Expert-Comptable>"
    }
  ],
  "recommendations": [
    {
      "priority": "<HAUTE|MOYENNE|BASSE>",
      "text": "<recommandation actionnable en 1-2 phrases, niveau Expert-Comptable>"
    }
  ]
}

Règles :
- score 80-100 → level "BON" ; score 50-79 → level "ATTENTION" ; score 0-49 → level "CRITIQUE"
- Maximum 5 anomalies, maximum 5 recommandations
- Tout le texte en français professionnel de niveau Expert-Comptable
- Si les données sont insuffisantes (pas de transactions sur la période), score = 50, level = "ATTENTION"`;

router.post("/audit/risk-score", async (req, res) => {
  const body = ComputeRiskScoreBody.parse(req.body);
  const { clientId, month, year } = body;

  if (!requireOwnClient(req, res, clientId)) return;

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

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd   = new Date(Date.UTC(year, month, 1));

  // ── 1. Aggregate journal lines for the period ──────────────────────────
  const rows = await db
    .select({
      accountNumber: journalLinesTable.accountNumber,
      debitAmount:   journalLinesTable.debitAmount,
      creditAmount:  journalLinesTable.creditAmount,
    })
    .from(journalLinesTable)
    .innerJoin(
      transactionsTable,
      eq(journalLinesTable.transactionId, transactionsTable.id),
    )
    .where(
      and(
        eq(transactionsTable.clientId, clientId),
        eq(transactionsTable.firmId, req.user!.firmId),
        gte(transactionsTable.date, monthStart),
        lte(transactionsTable.date, monthEnd),
      ),
    );

  // Group by account class
  const classMap: Record<string, { debit: number; credit: number }> = {};
  for (const row of rows) {
    const cls = row.accountNumber[0] ?? "?";
    if (!classMap[cls]) classMap[cls] = { debit: 0, credit: 0 };
    classMap[cls].debit  += row.debitAmount;
    classMap[cls].credit += row.creditAmount;
  }

  const class6 = classMap["6"] ?? { debit: 0, credit: 0 };
  const class7 = classMap["7"] ?? { debit: 0, credit: 0 };
  const declaredRevenue  = class7.credit - class7.debit;
  const totalExpenses    = class6.debit  - class6.credit;
  const expenseRatioPct  = declaredRevenue > 0
    ? ((totalExpenses / declaredRevenue) * 100).toFixed(1)
    : "N/A";

  // TVA: Classe 443 (TVA collectée)
  const vatCollected = rows
    .filter(r => r.accountNumber.startsWith("443"))
    .reduce((s, r) => s + r.creditAmount - r.debitAmount, 0);
  const theoreticalVat = declaredRevenue * 0.18;
  const vatGap = theoreticalVat > 0
    ? Math.abs(vatCollected - theoreticalVat) / theoreticalVat
    : 0;

  // ── 2. Anomaly transactions for the period ─────────────────────────────
  const anomalyTxs = await db.query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.clientId, clientId),
      eq(transactionsTable.firmId, req.user!.firmId),
      eq(transactionsTable.status, "anomalie"),
      gte(transactionsTable.date, monthStart),
      lte(transactionsTable.date, monthEnd),
    ),
    limit: 20,
  });

  // ── 3. Build AI payload ────────────────────────────────────────────────
  const MONTH_NAMES_FR = [
    "Janvier","Février","Mars","Avril","Mai","Juin",
    "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
  ];

  const accountSummary = Object.entries(classMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([cls, v]) =>
        `Classe ${cls} — Débit: ${v.debit.toLocaleString("fr-FR")} FCFA | Crédit: ${v.credit.toLocaleString("fr-FR")} FCFA`,
    )
    .join("\n");

  const anomalySummary =
    anomalyTxs.length > 0
      ? anomalyTxs
          .map(
            (t) =>
              `[ANOMALIE] ${t.date.toLocaleDateString("fr-FR")} | ${t.label} | ` +
              `${t.amount?.toLocaleString("fr-FR") ?? "?"} FCFA | codes: ${JSON.stringify(t.anomalies)}`,
          )
          .join("\n")
      : "Aucune transaction en anomalie sur la période.";

  const payload = [
    `=== ANALYSE DE RISQUE MENSUEL : ${client.name} — ${MONTH_NAMES_FR[month - 1]} ${year} ===`,
    `Client   : ${client.name}`,
    `Secteur  : ${client.sector ?? "Non renseigné"}`,
    `CA annuel (profil) : ${client.annualTurnover != null ? client.annualTurnover.toLocaleString("fr-FR") + " FCFA" : "Non renseigné"}`,
    ``,
    `=== RÉSUMÉ DE LA PÉRIODE ===`,
    `Produits (Classe 7)         : ${declaredRevenue.toLocaleString("fr-FR")} FCFA`,
    `Charges (Classe 6)          : ${totalExpenses.toLocaleString("fr-FR")} FCFA`,
    `Ratio charges/CA            : ${expenseRatioPct} %`,
    `TVA collectée nette (443xxx): ${vatCollected.toLocaleString("fr-FR")} FCFA`,
    `TVA théorique (18% du CA)   : ${theoreticalVat.toLocaleString("fr-FR")} FCFA`,
    `Écart TVA                   : ${(vatGap * 100).toFixed(1)} % ${vatGap > 0.15 ? "(⚠ ATTENTION — écart > 15%)" : "(OK)"}`,
    ``,
    `=== MOUVEMENTS PAR CLASSE ===`,
    accountSummary || "(aucune écriture sur la période)",
    ``,
    `=== ANOMALIES SYSTÈME DU MOIS ===`,
    anomalySummary,
  ].join("\n");

  // ── 4. Call Claude ─────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Service IA non configuré (ANTHROPIC_API_KEY manquant)." });
    return;
  }

  const anthropic = new Anthropic({ apiKey });
  let rawText: string;

  try {
    const message = await anthropic.messages.create({
      model:      "claude-sonnet-4-5",
      max_tokens: 2048,
      system:     RISK_SCORE_SYSTEM_PROMPT,
      messages:   [{ role: "user", content: payload }],
    });
    rawText =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : "{}";
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Claude risk-score API call failed");
    res.status(502).json({
      error: `Le service d'analyse IA est temporairement indisponible. (${detail})`,
    });
    return;
  }

  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: {
    score: number;
    level: "BON" | "ATTENTION" | "CRITIQUE";
    vatAnalysis: { consistencyOk: boolean; summary: string };
    anomalies: { code: string; label: string; severity: string; detail: string }[];
    recommendations: { priority: string; text: string }[];
  };

  try {
    parsed = JSON.parse(jsonText);
    if (typeof parsed.score !== "number" || !parsed.level) {
      throw new Error("Shape invalide");
    }
  } catch {
    req.log.error({ raw: rawText.slice(0, 500) }, "Claude risk-score response not parseable");
    res
      .status(502)
      .json({ error: "L'IA a retourné une réponse invalide. Veuillez réessayer." });
    return;
  }

  // ── 5. Return structured result ────────────────────────────────────────
  res.json({
    clientId,
    clientName: client.name,
    month,
    year,
    score: Math.round(Math.max(0, Math.min(100, parsed.score))),
    level: parsed.level,
    vatAnalysis: {
      declaredRevenue,
      vatCollected,
      theoreticalVat,
      vatGapPercent: Math.round(vatGap * 1000) / 10,
      consistencyOk: parsed.vatAnalysis?.consistencyOk ?? vatGap < 0.15,
    },
    anomalies:       parsed.anomalies       ?? [],
    recommendations: parsed.recommendations ?? [],
    generatedAt:     new Date().toISOString(),
  });
});

export default router;
