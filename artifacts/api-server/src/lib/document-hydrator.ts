// Module M25 (Générateur de Synthèses & Documents Juridiques) — "Document
// Hydrator": pure functions that compute the financial placeholder values
// for a client/year and perform the {{PLACEHOLDER}} regex replacement on a
// template's HTML. Deliberately framework-free (no DB access) so it can be
// unit-tested independently -- routes/report-documents.ts is responsible
// for fetching the ledger lines and the client record.
//
// Reuses the same aggregation engine as the M3/M21 financial statements
// (reporting-engine.ts) rather than recomputing totals from scratch, so the
// figures quoted in a generated report always match what the accountant
// sees on the Compte de Résultat / Bilan pages for the same period.

import { computeCompteDeResultat, computeBilanSimplifie, type LedgerLine } from "./reporting-engine";

function fmtFcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(amount))} FCFA`;
}

// The exhaustive, authoritative list of placeholders a template may use.
// Keep this list and DOCUMENT_PLACEHOLDER_KEYS below in sync.
export interface DocumentPlaceholderValues {
  COMPANY_NAME: string;
  LEGAL_FORM: string;
  FISCAL_YEAR: string;
  PREVIOUS_FISCAL_YEAR: string;
  TURNOVER: string;
  NET_INCOME: string;
  EQUITY: string;
  CASH_BALANCE: string;
  CHARGES_TOTAL: string;
  GENERATION_DATE: string;
}

export const DOCUMENT_PLACEHOLDER_KEYS = [
  "COMPANY_NAME",
  "LEGAL_FORM",
  "FISCAL_YEAR",
  "PREVIOUS_FISCAL_YEAR",
  "TURNOVER",
  "NET_INCOME",
  "EQUITY",
  "CASH_BALANCE",
  "CHARGES_TOTAL",
  "GENERATION_DATE",
] as const satisfies readonly (keyof DocumentPlaceholderValues)[];

/**
 * Computes every supported placeholder value for a client/year from the
 * client's validated ledger lines.
 *  - TURNOVER: total Classe 7 (produits) for the fiscal year.
 *  - NET_INCOME: résultat net (produits - charges) for the fiscal year.
 *  - EQUITY: capitaux propres (Classe 10-13) *including* the current year's
 *    résultat net -- i.e. the full "capitaux propres" mass shown on the
 *    Bilan Passif, not just the opening capital/reserves.
 *  - CASH_BALANCE: net Classe 5 position at the end of the fiscal year
 *    (positive = disponibilités, would be negative for a net découvert).
 */
export function computeDocumentPlaceholderValues(
  client: { name: string; legalForm: string | null },
  year: number,
  lines: LedgerLine[],
): DocumentPlaceholderValues {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEndExclusive = new Date(Date.UTC(year + 1, 0, 1));

  const compteResultat = computeCompteDeResultat(lines, yearStart, yearEndExclusive);
  const bilan = computeBilanSimplifie(lines, yearStart, yearEndExclusive);

  const capitauxPropres = bilan.passif.find((l) => l.key === "capitaux_propres")?.amount ?? 0;
  const resultatNetLine = bilan.passif.find((l) => l.key === "resultat_net")?.amount ?? 0;
  const tresorerieActif = bilan.actif.find((l) => l.key === "tresorerie_actif")?.amount ?? 0;
  const tresoreriePassif = bilan.passif.find((l) => l.key === "tresorerie_passif")?.amount ?? 0;

  return {
    COMPANY_NAME: client.name,
    LEGAL_FORM: client.legalForm ?? "—",
    FISCAL_YEAR: String(year),
    PREVIOUS_FISCAL_YEAR: String(year - 1),
    TURNOVER: fmtFcfa(compteResultat.totalProduits),
    NET_INCOME: fmtFcfa(compteResultat.resultatNet),
    EQUITY: fmtFcfa(capitauxPropres + resultatNetLine),
    CASH_BALANCE: fmtFcfa(tresorerieActif - tresoreriePassif),
    CHARGES_TOTAL: fmtFcfa(compteResultat.totalCharges),
    GENERATION_DATE: new Date().toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}

const PLACEHOLDER_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

/**
 * Replaces every `{{KEY}}` occurrence found in `values`. A placeholder for
 * an unknown key is deliberately left untouched (not blanked out) so an
 * accountant reviewing the compiled document immediately notices a typo or
 * an unsupported tag in a custom template, rather than silently shipping a
 * document with a missing figure.
 */
export function hydrateTemplate(
  html: string,
  values: DocumentPlaceholderValues,
): { html: string; unresolvedKeys: string[] } {
  const unresolved = new Set<string>();
  const hydrated = html.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (key in values) return values[key as keyof DocumentPlaceholderValues];
    unresolved.add(key);
    return match;
  });
  return { html: hydrated, unresolvedKeys: Array.from(unresolved) };
}
