/**
 * POST /api/ai/suggest-account
 *
 * AI-powered SYSCOHADA account suggestion for the Dépenses & Achats form.
 * Hybrid pipeline:
 *   1. Fast local fuzzy match against the live transaction_categories (DB)
 *      + immobilisation categories from PURCHASE_CATEGORIES (not in DB).
 *   2. If no strong match (< 0.75) AND DEEPSEEK_API_KEY is set, call DeepSeek
 *      for semantic reasoning.
 *
 * Returns up to 5 ranked suggestions:
 *   { key, label, account, accountName, vatEligible, isImmobilisation,
 *     confidenceScore, reasoning }
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { z } from "zod";
import { db, transactionCategoriesTable } from "@workspace/db";
import { PURCHASE_CATEGORIES } from "../lib/accounting-engine";

const router: Router = Router();
router.use(requireAuth);

// ── Types ──────────────────────────────────────────────────────────────────

export interface AccountSuggestion {
  key:              string;
  label:            string;
  account:          string;
  accountName:      string;
  vatEligible:      boolean;
  isImmobilisation: boolean;
  confidenceScore:  number;   // [0..1]
  reasoning:        string;
}

interface CatalogEntry {
  key:              string;
  label:            string;
  account:          string;
  accountName:      string;
  vatEligible:      boolean;
  isImmobilisation: boolean;
}

// ── Catalog (DB + static immo categories) ─────────────────────────────────
// Loaded fresh per request so it always reflects the seeded plan comptable.

async function buildCatalog(): Promise<CatalogEntry[]> {
  // 1. Fetch all categories from DB (including hidden system ones — useful for
  //    suggestion context even if they are not shown in the regular picker).
  let rows: Array<{ key: string; displayName: string; defaultAccountNumber: string; vatEligible: boolean }> = [];
  try {
    rows = await db.select({
      key:                 transactionCategoriesTable.key,
      displayName:         transactionCategoriesTable.displayName,
      defaultAccountNumber: transactionCategoriesTable.defaultAccountNumber,
      vatEligible:         transactionCategoriesTable.vatEligible,
    }).from(transactionCategoriesTable);
  } catch {
    rows = [];
  }

  const catalog: CatalogEntry[] = rows.map((r) => ({
    key:              r.key,
    label:            r.displayName,
    account:          r.defaultAccountNumber,
    accountName:      r.displayName,
    vatEligible:      r.vatEligible,
    isImmobilisation: false,
  }));

  // 2. Append immobilisation categories (only in PURCHASE_CATEGORIES, never in DB)
  const immoKeys = Object.keys(PURCHASE_CATEGORIES).filter((k) =>
    PURCHASE_CATEGORIES[k].isImmobilisation,
  );
  for (const key of immoKeys) {
    if (catalog.some((c) => c.key === key)) continue; // already present
    const cat = PURCHASE_CATEGORIES[key];
    catalog.push({
      key,
      label:            cat.label,
      account:          cat.account,
      accountName:      cat.accountName,
      vatEligible:      cat.vatEligible,
      isImmobilisation: true,
    });
  }

  return catalog;
}

// ── Alias keywords (West Africa French slang / abbreviations) ─────────────
// Use prefix-anchored word boundaries (\bword) so partial typing works:
//   "voitu" matches \bvoit  →  "voiture"
//   "electr" matches \bélectr  →  "électricité"

const ALIASES: Array<{ pattern: RegExp; keys: string[] }> = [
  { pattern: /\bcie\b|\bciedl\b|\bélectr|\belectr/i,          keys: ["electricite_eau"] },
  { pattern: /\bsodeci\b|\beau\b|\bliquid/i,                   keys: ["electricite_eau"] },
  { pattern: /\bcarb|\bessence\b|\bgasoil\b|\bgaz\b|\bpétrole\b|\bpetrol/i, keys: ["carburant"] },
  { pattern: /\bpapier\b|\bstyle|\bagenda|\bclasseur\b|\bcrayon/i, keys: ["fournitures_bureau"] },
  { pattern: /\bnettoy|\bbalay|\bdéterg|\bsavon\b|\bproduit.*entret/i, keys: ["fournitures_entretien"] },
  { pattern: /\btél\b|\bphone|\bsfr\b|\borange\b|\bmtn\b|\bmoov\b|\binternet|\bwifi\b/i, keys: ["telephone_internet"] },
  { pattern: /\bavion\b|\bticket\b|\bbillet\b|\bvoyage|\btaxi\b|\btrans/i, keys: ["transport_personnel"] },
  { pattern: /\bloyer\b|\bbail\b|\bappart|\bbureau à\b|\blocaux\b/i, keys: ["loyer"] },
  { pattern: /\brépar|\bmainten|\bpanne\b|\bservic/i,          keys: ["entretien"] },
  { pattern: /\bassur|\bprime\b|\bcontrat\b/i,                 keys: ["assurance"] },
  { pattern: /\bpub\b|\bmark|\baffich|\bspot\b|\bflyer\b/i,   keys: ["publicite"] },
  { pattern: /\bnotaire\b|\bavocat\b|\bconseil\b|\bhonor|\bcomptab/i, keys: ["honoraires"] },
  { pattern: /\bsalaire|\brémun|\bpaie\b|\bpay/i,             keys: ["salaires"] },
  { pattern: /\bcnps\b|\bcotis|\bcfce\b|\bcharge soc/i,       keys: ["charges_sociales"] },
  { pattern: /\bimpôt|\btaxe\b|\bfiscal|\bits\b|\baib\b/i,    keys: ["impots_taxes"] },
  { pattern: /\bbanqu|\bfrais bank|\bfrais fin|\bvirement/i,   keys: ["frais_bancaires"] },
  { pattern: /\bfret\b|\bport\b|\blivraison/i,                 keys: ["transport_achat"] },
  { pattern: /\bordinat|\bpc\b|\blaptop|\btablet|\bécran\b|\bécran/i, keys: ["immo_materiel_info"] },
  { pattern: /\bvéhicul|\bvoit|\bcamion|\bmoto\b|\btruck\b|\bauto\b/i, keys: ["immo_materiel_transport"] },
  { pattern: /\bchaise\b|\bmeuble|\barmoir|\bbureau.*(?:chaise|armoir|meuble)/i, keys: ["immo_materiel_mobilier"] },
  { pattern: /\bmachin|\boutillage|\boutil\b|\bindustriel/i,   keys: ["immo_materiel_industriel"] },
  { pattern: /\bsous.trai|\bprestat|\bservices?\b/i,           keys: ["sous_traitance", "prestation_services"] },
  { pattern: /\bachat|\bcommand|\bfourniss|\bstock/i,          keys: ["achat_marchandises"] },
];

// ── Fuzzy scoring ──────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreText(query: string, target: string): number {
  const q = normalise(query);
  const t = normalise(target);
  if (!q || !t) return 0;
  if (t === q) return 1.0;
  if (t.startsWith(q)) return 0.92;
  if (q.startsWith(t) && t.length > 3) return 0.88;
  if (t.includes(q) && q.length > 3) return 0.78;
  // Word-level overlap (supports partial word prefix)
  const qWords = q.split(" ").filter((w) => w.length > 2);
  const tWords = t.split(" ");
  const hits = qWords.filter((w) =>
    tWords.some((tw) => tw.startsWith(w) || w.startsWith(tw)),
  );
  if (hits.length > 0) return 0.55 + (hits.length / qWords.length) * 0.25;
  return 0;
}

function fuzzySearch(
  query: string,
  supplierName: string | undefined,
  catalog: CatalogEntry[],
): AccountSuggestion[] {
  const combined = [query, supplierName].filter(Boolean).join(" ");

  // Boost keys matched by alias patterns
  const aliasBoost = new Map<string, number>();
  for (const alias of ALIASES) {
    if (alias.pattern.test(combined)) {
      for (const key of alias.keys) aliasBoost.set(key, 0.18);
    }
  }

  // Account-number prefix match (user typed digits)
  const isAccountQuery = /^\d+/.test(query.trim());

  const results: AccountSuggestion[] = [];

  for (const cat of catalog) {
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

    // Pure alias hit (label score was 0 but alias matched)
    if (score === 0 && aliasBoost.has(cat.key)) {
      score = aliasBoost.get(cat.key)!;
      reasoning = `Alias correspondant pour « ${cat.label} »`;
    }

    if (score >= 0.12) {
      results.push({
        ...cat,
        confidenceScore: parseFloat(score.toFixed(3)),
        reasoning,
      });
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

  // Build the live catalog (DB + immo statics)
  const catalog = await buildCatalog();

  // Step 1 — fast local fuzzy
  const fuzzyHits = fuzzySearch(query, supplierName, catalog);
  const bestFuzzy = fuzzyHits[0]?.confidenceScore ?? 0;

  // Good enough locally → skip AI
  if (bestFuzzy >= 0.75) {
    res.json({ suggestions: fuzzyHits, usedAI: false });
    return;
  }

  // Step 2 — DeepSeek semantic fallback (optional — gracefully skipped if no key)
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.json({ suggestions: fuzzyHits, usedAI: false });
    return;
  }

  const catalogLines = catalog
    .map((c) => `${c.key}|${c.label}|${c.account}${c.isImmobilisation ? " [IMMOBILISATION]" : ""}`)
    .join("\n");

  try {
    const signal = AbortSignal.timeout(8_000);
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method:  "POST",
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

    const aiResp = await upstream.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw  = aiResp.choices?.[0]?.message?.content ?? "";
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(json) as {
      suggestions: Array<{ key: string; confidenceScore: number; reasoning: string }>;
    };

    const aiHits: AccountSuggestion[] = (parsed.suggestions ?? [])
      .map((s) => {
        const cat = catalog.find((c) => c.key === s.key);
        if (!cat) return null;
        return {
          ...cat,
          confidenceScore: Math.min(1, Math.max(0, s.confidenceScore ?? 0)),
          reasoning:       s.reasoning ?? "",
        };
      })
      .filter((x): x is AccountSuggestion => x !== null);

    // Merge: AI hits first, then fuzzy remainder
    const seen   = new Set<string>(aiHits.map((h) => h.key));
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
