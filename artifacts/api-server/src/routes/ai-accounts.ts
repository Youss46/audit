/**
 * POST /api/ai/suggest-account
 *
 * AI-powered SYSCOHADA account suggestion for the Dépenses & Achats form.
 * Hybrid pipeline:
 *   1. Fast local fuzzy match against the PURCHASE_CATEGORIES catalog.
 *   2. If no strong match (< 0.75), call DeepSeek for semantic reasoning.
 *
 * Returns up to 5 ranked suggestions:
 *   { key, label, account, accountName, vatEligible, isImmobilisation,
 *     confidenceScore, reasoning, usedAI }
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { z } from "zod";
import { PURCHASE_CATEGORIES } from "../lib/accounting-engine";

const router: Router = Router();
router.use(requireAuth);

// ── Types ──────────────────────────────────────────────────────────────────

export interface AccountSuggestion {
  key:             string;
  label:           string;
  account:         string;
  accountName:     string;
  vatEligible:     boolean;
  isImmobilisation: boolean;
  confidenceScore: number;   // [0..1]
  reasoning:       string;
}

// ── Static catalog built from PURCHASE_CATEGORIES ─────────────────────────
// Immutably computed once at startup — small enough for in-process fuzzy search.

const CATALOG = Object.entries(PURCHASE_CATEGORIES).map(([key, cat]) => ({
  key,
  label:            cat.label,
  account:          cat.account,
  accountName:      cat.accountName,
  vatEligible:      cat.vatEligible,
  isImmobilisation: cat.isImmobilisation ?? false,
}));

// Alias keywords that users commonly type in French West Africa slang / abbrev.
const ALIASES: Array<{ pattern: RegExp; keys: string[] }> = [
  { pattern: /\bcie\b|\bciedl\b|\bélectric/i,    keys: ["electricite_eau"] },
  { pattern: /\bsodeci\b|\beau\b/i,               keys: ["electricite_eau"] },
  { pattern: /\bcarb\b|\bessence\b|\bgasoil\b|\bgaz\b|\bpétrole\b/i, keys: ["carburant"] },
  { pattern: /\bpapier\b|\bstyle\b|\bagendas?\b|\bclasseur\b|\bstyl/i, keys: ["fournitures_bureau"] },
  { pattern: /\bnettoy\b|\bbalay\b|\bdéterg\b|\bsavon\b/i, keys: ["fournitures_entretien"] },
  { pattern: /\btél\b|\bphone\b|\bsfr\b|\borange\b|\bmtn\b|\bmoov\b|\binternet\b|\bwifi\b/i, keys: ["telephone_internet"] },
  { pattern: /\bavion\b|\bticket\b|\bbillet\b|\bvoyage\b|\btaxi\b|\btrans/i, keys: ["transport_personnel"] },
  { pattern: /\bloyer\b|\bbail\b|\bappart\b|\bbureau à\b|\blocaux\b/i, keys: ["loyer"] },
  { pattern: /\brépar\b|\bmainten\b|\bpanne\b|\bservic\b/i, keys: ["entretien"] },
  { pattern: /\bassur\b|\bprime\b|\bcontrat\b/i, keys: ["assurance"] },
  { pattern: /\bpub\b|\bmark\b|\baffich\b|\bspot\b|\bflyer\b/i, keys: ["publicite"] },
  { pattern: /\bnotaire\b|\bavocat\b|\bconseil\b|\bhonor\b|\bcomptab/i, keys: ["honoraires"] },
  { pattern: /\bsalaire\b|\brémun\b|\bpaie\b|\bpay/i, keys: ["salaires"] },
  { pattern: /\bcnps\b|\bcotis\b|\bcfce\b|\bcharge soc/i, keys: ["charges_sociales"] },
  { pattern: /\bfret\b|\bport\b|\blivraison\b/i, keys: ["transport_achat"] },
  { pattern: /\bordinat\b|\bpc\b|\blaptop\b|\btablet\b|\bécran\b/i, keys: ["immo_materiel_info"] },
  { pattern: /\bvéhicule\b|\bvoit\b|\bcamion\b|\bmoto\b/i, keys: ["immo_materiel_transport"] },
  { pattern: /\bchaise\b|\bbureau\b.*(?:meuble|chaise|armoire)\b|\bmeuble\b/i, keys: ["immo_materiel_mobilier"] },
  { pattern: /\bmachin\b|\boutillage\b|\boutil\b|\bindustriel/i, keys: ["immo_materiel_industriel"] },
];

// ── Fuzzy scoring ──────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function scoreText(query: string, target: string): number {
  const q = normalise(query);
  const t = normalise(target);
  if (!q || !t) return 0;
  if (t === q) return 1.0;
  if (t.startsWith(q)) return 0.92;
  if (q.startsWith(t) && t.length > 3) return 0.88;
  if (t.includes(q) && q.length > 3) return 0.78;
  // Word-level overlap
  const qWords = q.split(" ").filter((w) => w.length > 2);
  const tWords = t.split(" ");
  const hits = qWords.filter((w) => tWords.some((tw) => tw.startsWith(w) || w.startsWith(tw)));
  if (hits.length > 0) return 0.55 + (hits.length / qWords.length) * 0.25;
  return 0;
}

function fuzzySearch(
  query: string,
  supplierName?: string,
): AccountSuggestion[] {
  const combined = [query, supplierName].filter(Boolean).join(" ");

  // Boost keys matched by alias patterns
  const aliasBoost = new Map<string, number>();
  for (const alias of ALIASES) {
    if (alias.pattern.test(combined)) {
      for (const key of alias.keys) aliasBoost.set(key, 0.15);
    }
  }

  // Account-number prefix match (user typed digits)
  const isAccountQuery = /^\d+/.test(query.trim());

  const results: AccountSuggestion[] = [];

  for (const cat of CATALOG) {
    let score = 0;
    let reasoning = "";

    if (isAccountQuery && cat.account.startsWith(query.trim())) {
      score = cat.account === query.trim() ? 1.0 : 0.92;
      reasoning = `Compte SYSCOHADA ${cat.account}`;
    } else {
      const labelScore = Math.max(
        scoreText(query, cat.label),
        scoreText(query, cat.accountName),
        supplierName ? scoreText(supplierName, cat.label) * 0.7 : 0,
        supplierName ? scoreText(supplierName, cat.accountName) * 0.7 : 0,
      );
      score = Math.min(1, labelScore + (aliasBoost.get(cat.key) ?? 0));
      if (score > 0) reasoning = `Correspondance avec « ${cat.label} » (${cat.account})`;
    }

    if (score >= 0.45) {
      results.push({ ...cat, confidenceScore: parseFloat(score.toFixed(3)), reasoning });
    }
  }

  return results.sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 5);
}

// ── Validation ─────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  query:        z.string().min(1).max(300).trim(),
  supplierName: z.string().max(300).trim().optional(),
});

// ── Route ──────────────────────────────────────────────────────────────────

router.post("/ai/suggest-account", async (req, res) => {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(req.body);
  } catch {
    res.status(400).json({ error: "Corps de requête invalide." });
    return;
  }

  const { query, supplierName } = body;

  // Step 1 — fast local fuzzy
  const fuzzyHits = fuzzySearch(query, supplierName);
  const bestFuzzy = fuzzyHits[0]?.confidenceScore ?? 0;

  // Good enough locally → skip AI
  if (bestFuzzy >= 0.75) {
    res.json({ suggestions: fuzzyHits, usedAI: false });
    return;
  }

  // Step 2 — DeepSeek semantic fallback
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.json({ suggestions: fuzzyHits, usedAI: false });
    return;
  }

  const catalogLines = CATALOG.map(
    (c) => `${c.key}|${c.label}|${c.account}${c.isImmobilisation ? " [IMMOBILISATION]" : ""}`,
  ).join("\n");

  try {
    const signal = AbortSignal.timeout(8_000);
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       "deepseek-chat",
        stream:      false,
        max_tokens:  400,
        temperature: 0.05,
        messages: [
          {
            role:    "system",
            content: `Tu es un expert-comptable SYSCOHADA (Côte d'Ivoire). Identifie les meilleures catégories comptables pour une dépense donnée.

CATALOGUE (format: clé|libellé|compte):
${catalogLines}

Réponds UNIQUEMENT avec du JSON brut (sans markdown). Retourne 1 à 3 suggestions triées par pertinence:
{"suggestions":[{"key":"<clé exacte>","confidenceScore":<0.0-1.0>,"reasoning":"<raison courte en français>"}]}`,
          },
          {
            role:    "user",
            content: `Dépense: "${query}"${supplierName ? `\nFournisseur: "${supplierName}"` : ""}`,
          },
        ],
      }),
    });

    if (!upstream.ok) {
      res.json({ suggestions: fuzzyHits, usedAI: false });
      return;
    }

    const aiResp = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = aiResp.choices?.[0]?.message?.content ?? "";
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(json) as {
      suggestions: Array<{ key: string; confidenceScore: number; reasoning: string }>;
    };

    const aiHits: AccountSuggestion[] = (parsed.suggestions ?? [])
      .map((s) => {
        const cat = CATALOG.find((c) => c.key === s.key);
        if (!cat) return null;
        return {
          ...cat,
          confidenceScore: Math.min(1, Math.max(0, s.confidenceScore ?? 0)),
          reasoning:       s.reasoning ?? "",
        };
      })
      .filter((x): x is AccountSuggestion => x !== null);

    // Merge: AI hits first (they answered the semantic gap), then fuzzy remainder
    const seen = new Set<string>(aiHits.map((h) => h.key));
    const merged = [
      ...aiHits,
      ...fuzzyHits.filter((h) => !seen.has(h.key)),
    ].slice(0, 5);

    res.json({ suggestions: merged, usedAI: true });
  } catch {
    // AI timeout / parse error → graceful degradation
    res.json({ suggestions: fuzzyHits, usedAI: false });
  }
});

export default router;
