/**
 * POST /cabinet/accounts/smart-search
 *
 * Recherche sémantique intelligente dans le Plan Comptable SYSCOHADA.
 * Pipeline dual :
 *   1. Correspondance SQL directe (code préfixe ou sous-chaîne libellé)
 *   2. Sémantique IA via DeepSeek JSON mode si pas de match direct fort
 *
 * Cabinet only — requireAuth.
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { z } from "zod";
import { db, accountsTable } from "@workspace/db";
import { ilike, or, and, asc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// ── Validation ─────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  q: z.string().min(1).max(300).trim(),
  classFilter: z.number().int().min(1).max(9).optional(),
});

// ── Types ──────────────────────────────────────────────────────────────────

export interface SmartSearchResult {
  code: string;
  label: string;
  accountClass: number;
  confidence: number;
  reasoning: string;
  isDirectMatch: boolean;
}

// ── Route ──────────────────────────────────────────────────────────────────

router.post("/cabinet/accounts/smart-search", async (req, res) => {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(req.body);
  } catch {
    res.status(400).json({ error: "Corps de requête invalide." });
    return;
  }

  const { q, classFilter } = body;
  const trimmed = q.trim();
  const isNumeric = /^\d/.test(trimmed);

  // ── Step 1 : Correspondance SQL directe ──────────────────────────────────

  const codeMatch = ilike(accountsTable.accountNumber, `${trimmed}%`);
  const labelMatch = ilike(accountsTable.name, `%${trimmed}%`);
  const textWhere = or(codeMatch, labelMatch);

  const where = classFilter
    ? and(eq(accountsTable.accountClass, classFilter), textWhere)
    : textWhere;

  let directRows: { id: number; accountNumber: string; name: string; accountClass: number }[];
  try {
    directRows = await db
      .select({
        id: accountsTable.id,
        accountNumber: accountsTable.accountNumber,
        name: accountsTable.name,
        accountClass: accountsTable.accountClass,
      })
      .from(accountsTable)
      .where(where)
      .orderBy(asc(accountsTable.accountNumber))
      .limit(20);
  } catch (err) {
    req.log.error({ err }, "[smart-search] DB query failed");
    res.status(500).json({ error: `Erreur base de données : ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  const directResults: SmartSearchResult[] = directRows.map((r) => {
    const isCodeHit = r.accountNumber
      .toLowerCase()
      .startsWith(trimmed.toLowerCase());
    return {
      code: r.accountNumber,
      label: r.name,
      accountClass: r.accountClass,
      confidence: isCodeHit ? 0.99 : 0.85,
      reasoning: isCodeHit
        ? `Code SYSCOHADA ${r.accountNumber}`
        : `Correspondance du libellé « ${r.name} »`,
      isDirectMatch: true,
    };
  });

  // Pour les requêtes numériques ou si on a déjà beaucoup de résultats, skip AI
  if (isNumeric || directResults.length >= 8) {
    res.json({ results: directResults.slice(0, 12), usedAI: false });
    return;
  }

  // ── Step 2 : Sémantique IA (DeepSeek JSON mode) ──────────────────────────

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.json({ results: directResults, usedAI: false });
    return;
  }

  // Référentiel compact transmis au modèle
  let planRows: { accountNumber: string; name: string; accountClass: number }[];
  try {
    planRows = await db
      .select({
        accountNumber: accountsTable.accountNumber,
        name: accountsTable.name,
        accountClass: accountsTable.accountClass,
      })
      .from(accountsTable)
      .where(classFilter ? eq(accountsTable.accountClass, classFilter) : undefined)
      .orderBy(asc(accountsTable.accountNumber));
  } catch (err) {
    req.log.warn({ err }, "[smart-search] DB plan query failed — fallback to SQL results only");
    res.json({ results: directResults, usedAI: false });
    return;
  }

  const planLines = planRows
    .slice(0, 1200)
    .map((r) => `${r.accountNumber}|${r.name}`)
    .join("\n");

  try {
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(9_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        stream: false,
        max_tokens: 700,
        temperature: 0.05,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Tu es un expert-comptable SYSCOHADA (Côte d'Ivoire). Pour la requête donnée, identifie les comptes du plan comptable les plus pertinents.

PLAN COMPTABLE SYSCOHADA (numéro|libellé) :
${planLines}

Réponds UNIQUEMENT avec du JSON valide, format exact :
{"results":[{"code":"<numéro exact du plan>","label":"<libellé exact>","confidence":<0.00-1.00>,"reasoning":"<explication concise en français>"}]}

Règles :
- Retourne 1 à 8 comptes triés par pertinence décroissante
- Utilise UNIQUEMENT des codes présents dans le plan ci-dessus
- Préfère les comptes à 6 chiffres (sous-comptes spécifiques)
- confidence = 1.0 pour correspondance parfaite, 0.6 pour approximative`,
          },
          {
            role: "user",
            content: `Requête : "${q}"`,
          },
        ],
      }),
    });

    if (!upstream.ok) {
      res.json({ results: directResults, usedAI: false });
      return;
    }

    const aiResp = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = aiResp.choices?.[0]?.message?.content ?? "";
    const clean = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(clean) as {
      results: Array<{
        code: string;
        label: string;
        confidence: number;
        reasoning: string;
      }>;
    };

    const aiResults: SmartSearchResult[] = (parsed.results ?? [])
      .filter((r) => r.code && r.label)
      .map((r) => ({
        code: r.code,
        label: r.label,
        accountClass: parseInt(r.code[0] ?? "0", 10) || 0,
        confidence: Math.min(1, Math.max(0, r.confidence ?? 0.7)),
        reasoning: r.reasoning ?? "",
        isDirectMatch: false,
      }));

    // Fusion : correspondances directes d'abord, puis IA (sans doublons)
    const seen = new Set(directResults.map((r) => r.code));
    const merged = [
      ...directResults,
      ...aiResults.filter((r) => !seen.has(r.code)),
    ].slice(0, 12);

    res.json({ results: merged, usedAI: true });
  } catch (err) {
    logger.warn({ err }, "[smart-search] DeepSeek timeout/parse error — fallback to SQL results");
    res.json({ results: directResults, usedAI: false });
  }
});

export default router;
