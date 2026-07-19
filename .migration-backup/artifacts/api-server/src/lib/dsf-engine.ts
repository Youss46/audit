/**
 * Module M24 — SYSCOHADA Système Normal DSF Engine
 *
 * Full Déclaration Statistique et Fiscale (DSF) calculation from the
 * validated general ledger.  Follows OHADA Revised Plan Comptable (2017)
 * and Côte d'Ivoire DGI filing requirements.
 *
 * Design: pure functions, no DB, no side effects.  All state comes in as
 * LedgerLine[] or BalanceRow[] from the reporting pipeline; callers are
 * responsible for fetching data and passing it here.
 *
 * Account mapping strategy:
 *   - "patterns" = list of account prefixes (e.g. ["21","20"] matches any
 *     account whose number starts with "21" or "20").
 *   - "brut" accounts: asset accounts that carry debit-side balances.
 *   - "amort" accounts: contra-asset accounts (28*, 29*, 39*, 49*, 59*)
 *     that carry credit-side balances representing accumulated depreciation
 *     and provisions.
 *
 * The BalanceRow input is the cumulative ledger balance (initialBalance +
 * current-year movements), which is exactly what belongs on the balance
 * sheet.  For the income statement and TFT we use totalDebit/totalCredit
 * from the same BalanceRow to isolate the current-year flows.
 */

import type { BalanceRow } from "./reporting-engine";

// ---------------------------------------------------------------------------
// Mapping rules (Module M24 — Dsf_Mapping_Rules)
// ---------------------------------------------------------------------------

// Decoupled from @workspace/db's DsfMappingRule row shape on purpose: this
// file stays a pure, framework-free calculation module (see file header).
// Callers (routes/dsf.ts) fetch rows from the `dsf_mapping_rules` table and
// pass them in as this minimal shape.
export interface DsfMappingRuleInput {
  lineCode: string;
  accountPatterns: string;
}

/** lineCode -> account-prefix patterns, built once per computeDsf() call. */
type RulesIndex = Map<string, string[]>;

function buildRulesIndex(rules: DsfMappingRuleInput[]): RulesIndex {
  const index: RulesIndex = new Map();
  for (const rule of rules) {
    index.set(
      rule.lineCode,
      rule.accountPatterns
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    );
  }
  return index;
}

/**
 * Resolves the account-prefix patterns for a mapping-rule line code. Falls
 * back to the given literal patterns when the rule isn't present in the DB
 * (e.g. the seed hasn't been run in this environment yet) so the engine
 * keeps working correctly with or without a seeded `dsf_mapping_rules`
 * table -- seeding only makes the mapping inspectable/editable, it never
 * changes a computed figure.
 */
function pat(rules: RulesIndex, lineCode: string, fallback: string[]): string[] {
  return rules.get(lineCode) ?? fallback;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface DsfBilanActifLine {
  lineCode: string;
  label: string;
  isSubtotal: boolean;
  isSectionHeader: boolean;
  brut: number;
  amortissements: number;
  netN: number;
}

export interface DsfBilanPassifLine {
  lineCode: string;
  label: string;
  isSubtotal: boolean;
  isSectionHeader: boolean;
  montantN: number;
}

export interface DsfCompteResultatLine {
  lineCode: string;
  label: string;
  produits: number;
  charges: number;
  /** produits - charges; negative means a net charge */
  solde: number;
  isIntermediate: boolean;
  isSectionHeader: boolean;
}

export interface DsfTftLine {
  lineCode: string;
  label: string;
  montantN: number;
  isSubtotal: boolean;
  isSectionHeader: boolean;
}

export interface DsfResult {
  bilanActif: DsfBilanActifLine[];
  bilanPassif: DsfBilanPassifLine[];
  compteResultat: DsfCompteResultatLine[];
  tft: DsfTftLine[];
  totalBilanActif: number;
  totalBilanPassif: number;
  /** true when sum(totalDebit) === sum(totalCredit) across all accounts */
  balanceEquilibre: boolean;
  /** true when totalBilanActif === totalBilanPassif */
  bilanEquilibre: boolean;
  totalDebits: number;
  totalCredits: number;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Pre-processed balance map: accountNumber → { debit, credit, yearDebit, yearCredit } */
interface AccountBal {
  /** Final debit balance (positive when account ends debiteur) */
  debit: number;
  /** Final credit balance (positive when account ends créditeur) */
  credit: number;
  /** Current-year debit movements */
  yearDebit: number;
  /** Current-year credit movements */
  yearCredit: number;
}

function buildAccountMap(balances: BalanceRow[]): Map<string, AccountBal> {
  const map = new Map<string, AccountBal>();
  for (const row of balances) {
    map.set(row.accountNumber, {
      debit: row.finalBalanceSide === "debiteur" ? row.finalBalance : 0,
      credit: row.finalBalanceSide === "crediteur" ? row.finalBalance : 0,
      yearDebit: row.totalDebit,
      yearCredit: row.totalCredit,
    });
  }
  return map;
}

function matchesAny(accountNumber: string, patterns: string[]): boolean {
  return patterns.some((p) => accountNumber.startsWith(p));
}

/** Sum of final debit balances for accounts matching any of the given prefixes. */
function sumDebit(map: Map<string, AccountBal>, patterns: string[]): number {
  let total = 0;
  for (const [acct, bal] of map) {
    if (matchesAny(acct, patterns)) total += bal.debit;
  }
  return total;
}

/** Sum of final credit balances for accounts matching any of the given prefixes. */
function sumCredit(map: Map<string, AccountBal>, patterns: string[]): number {
  let total = 0;
  for (const [acct, bal] of map) {
    if (matchesAny(acct, patterns)) total += bal.credit;
  }
  return total;
}

/** Sum of current-year debit movements for matching accounts. */
function sumYearDebit(map: Map<string, AccountBal>, patterns: string[]): number {
  let total = 0;
  for (const [acct, bal] of map) {
    if (matchesAny(acct, patterns)) total += bal.yearDebit;
  }
  return total;
}

/** Sum of current-year credit movements for matching accounts. */
function sumYearCredit(map: Map<string, AccountBal>, patterns: string[]): number {
  let total = 0;
  for (const [acct, bal] of map) {
    if (matchesAny(acct, patterns)) total += bal.yearCredit;
  }
  return total;
}

// ---------------------------------------------------------------------------
// BILAN ACTIF
// ---------------------------------------------------------------------------

function computeBilanActif(
  map: Map<string, AccountBal>,
  rules: RulesIndex,
): { lines: DsfBilanActifLine[]; total: number } {
  const lines: DsfBilanActifLine[] = [];

  function actifLine(code: string, label: string, brutPat: string[], amortPat: string[]): DsfBilanActifLine {
    const brut = sumDebit(map, brutPat);
    const amort = sumCredit(map, amortPat);
    const netN = Math.max(0, brut - amort);
    return { lineCode: code, label, isSubtotal: false, isSectionHeader: false, brut, amortissements: amort, netN };
  }

  function header(code: string, label: string): DsfBilanActifLine {
    return { lineCode: code, label, isSubtotal: false, isSectionHeader: true, brut: 0, amortissements: 0, netN: 0 };
  }

  function subtotal(code: string, label: string, children: DsfBilanActifLine[]): DsfBilanActifLine {
    const brut = children.filter((l) => !l.isSectionHeader && !l.isSubtotal).reduce((s, l) => s + l.brut, 0);
    const amort = children.filter((l) => !l.isSectionHeader && !l.isSubtotal).reduce((s, l) => s + l.amortissements, 0);
    const netN = Math.max(0, brut - amort);
    return { lineCode: code, label, isSubtotal: true, isSectionHeader: false, brut, amortissements: amort, netN };
  }

  // ---- ACTIF IMMOBILISÉ ----
  lines.push(header("--AI--", "ACTIF IMMOBILISÉ"));

  const immoIncorp = actifLine("AB", "Immobilisations incorporelles",
    pat(rules, "AB_BRUT", ["20", "21"]),        // Frais immo, brevets, fonds commercial
    pat(rules, "AB_AMORT", ["280", "281"]));    // Amort correspondants
  lines.push(immoIncorp);

  const immoTerrain = actifLine("AC", "Terrains",
    pat(rules, "AC_BRUT", ["22"]),
    pat(rules, "AC_AMORT", ["292"]));
  lines.push(immoTerrain);

  const immoBatim = actifLine("AD", "Bâtiments",
    pat(rules, "AD_BRUT", ["231", "232", "233", "234"]),
    pat(rules, "AD_AMORT", ["2831", "2832", "2833", "2834"]));
  lines.push(immoBatim);

  const immoAmenag = actifLine("AE", "Aménagements, agencements et installations",
    pat(rules, "AE_BRUT", ["235", "236", "238"]),
    pat(rules, "AE_AMORT", ["2835", "2836", "2838"]));
  lines.push(immoAmenag);

  const immoMateriel = actifLine("AF", "Matériel, mobilier et actifs biologiques",
    pat(rules, "AF_BRUT", ["241", "242", "243", "244", "245", "246", "247", "248"]),
    pat(rules, "AF_AMORT", ["2841", "2842", "2843", "2844", "2845", "2846", "2847", "2848"]));
  lines.push(immoMateriel);

  const immoFin = actifLine("AH", "Avances et acomptes versés sur immobilisations",
    pat(rules, "AH_BRUT", ["251", "252", "253", "254"]),
    []);
  lines.push(immoFin);

  const immoFinanc = actifLine("AI", "Immobilisations financières",
    pat(rules, "AI_BRUT", ["26", "27"]),
    pat(rules, "AI_AMORT", ["296", "297"]));
  lines.push(immoFinanc);

  const immoSubtotal = subtotal("AJ", "TOTAL ACTIF IMMOBILISÉ",
    [immoIncorp, immoTerrain, immoBatim, immoAmenag, immoMateriel, immoFin, immoFinanc]);
  lines.push(immoSubtotal);

  // ---- ACTIF CIRCULANT ----
  lines.push(header("--AC--", "ACTIF CIRCULANT"));

  const stocks = actifLine("BA", "Stocks et encours",
    pat(rules, "BA_BRUT", ["31", "32", "33", "34", "35", "36", "37", "38"]),
    pat(rules, "BA_AMORT", ["391", "392", "393", "394", "395", "396", "397", "398"]));
  lines.push(stocks);

  const creancesClients = actifLine("BB", "Créances clients et comptes rattachés",
    pat(rules, "BB_BRUT", ["411", "412", "413", "414", "415", "416", "417"]),
    pat(rules, "BB_AMORT", ["491"]));
  lines.push(creancesClients);

  const autresCreances = actifLine("BC", "Autres créances",
    pat(rules, "BC_BRUT", ["42", "43", "44", "45", "46", "47", "481", "485", "486", "487", "488"]),
    pat(rules, "BC_AMORT", ["499"]));
  lines.push(autresCreances);

  const acSubtotal = subtotal("BD", "TOTAL ACTIF CIRCULANT", [stocks, creancesClients, autresCreances]);
  lines.push(acSubtotal);

  // ---- TRÉSORERIE-ACTIF ----
  lines.push(header("--TA--", "TRÉSORERIE-ACTIF"));

  const titresPlacement = actifLine("BG", "Titres de placement",
    pat(rules, "BG_BRUT", ["50"]),
    pat(rules, "BG_AMORT", ["590"]));
  lines.push(titresPlacement);

  const valeursEncaiss = actifLine("BH", "Valeurs à encaisser",
    pat(rules, "BH_BRUT", ["511", "512", "513", "514"]),
    []);
  lines.push(valeursEncaiss);

  const banquesCaisses = actifLine("BI", "Banques, chèques postaux, caisse et assimilés",
    pat(rules, "BI_BRUT", ["52", "53", "57"]),
    []);
  lines.push(banquesCaisses);

  const taSubtotal = subtotal("BJ", "TOTAL TRÉSORERIE-ACTIF", [titresPlacement, valeursEncaiss, banquesCaisses]);
  lines.push(taSubtotal);

  // ---- TOTAL GÉNÉRAL ACTIF ----
  const totalActif = immoSubtotal.netN + acSubtotal.netN + taSubtotal.netN;
  lines.push({
    lineCode: "BK",
    label: "TOTAL GÉNÉRAL ACTIF",
    isSubtotal: true,
    isSectionHeader: false,
    brut: immoSubtotal.brut + acSubtotal.brut + taSubtotal.brut,
    amortissements: immoSubtotal.amortissements + acSubtotal.amortissements + taSubtotal.amortissements,
    netN: totalActif,
  });

  return { lines, total: totalActif };
}

// ---------------------------------------------------------------------------
// BILAN PASSIF
// ---------------------------------------------------------------------------

function computeBilanPassif(
  map: Map<string, AccountBal>,
  resultatNet: number,
  rules: RulesIndex,
): { lines: DsfBilanPassifLine[]; total: number } {
  const lines: DsfBilanPassifLine[] = [];

  function passifLine(code: string, label: string, patterns: string[]): DsfBilanPassifLine {
    const montantN = sumCredit(map, patterns);
    return { lineCode: code, label, isSubtotal: false, isSectionHeader: false, montantN };
  }

  function header(code: string, label: string): DsfBilanPassifLine {
    return { lineCode: code, label, isSubtotal: false, isSectionHeader: true, montantN: 0 };
  }

  function subtotal(code: string, label: string, vals: number[]): DsfBilanPassifLine {
    return {
      lineCode: code,
      label,
      isSubtotal: true,
      isSectionHeader: false,
      montantN: vals.reduce((s, v) => s + v, 0),
    };
  }

  // ---- CAPITAUX PROPRES ----
  lines.push(header("--CP--", "CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES"));

  const capital = passifLine("CA", "Capital", pat(rules, "CA", ["101", "102", "103", "104"]));
  lines.push(capital);

  const primesReserves = passifLine("CB", "Primes, réserves et fonds assimilés",
    pat(rules, "CB", ["105", "106", "107", "108", "11"]));
  lines.push(primesReserves);

  const reportANouv = passifLine("CD", "Report à nouveau", pat(rules, "CD", ["12"]));
  lines.push(reportANouv);

  // Résultat net injected from compte de résultat
  const resultatLine: DsfBilanPassifLine = {
    lineCode: "CE",
    label: "Résultat net de l'exercice",
    isSubtotal: false,
    isSectionHeader: false,
    montantN: resultatNet,
  };
  lines.push(resultatLine);

  const subventions = passifLine("CF", "Subventions d'investissement", pat(rules, "CF", ["14"]));
  lines.push(subventions);

  const provisionsReg = passifLine("CG", "Provisions réglementées et fonds assimilés", pat(rules, "CG", ["15"]));
  lines.push(provisionsReg);

  const cpSubtotal = subtotal("CH", "TOTAL CAPITAUX PROPRES", [
    capital.montantN, primesReserves.montantN, reportANouv.montantN,
    resultatNet, subventions.montantN, provisionsReg.montantN,
  ]);
  lines.push(cpSubtotal);

  // ---- DETTES FINANCIÈRES ----
  lines.push(header("--DF--", "DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES"));

  const emprunts = passifLine("DA", "Emprunts et dettes financières", pat(rules, "DA", ["16", "17"]));
  lines.push(emprunts);

  const avancesRecues = passifLine("DB", "Dettes de location-financement et assimilés", pat(rules, "DB", ["18"]));
  lines.push(avancesRecues);

  const provisionsFin = passifLine("DC", "Provisions pour risques et charges", pat(rules, "DC", ["19"]));
  lines.push(provisionsFin);

  const dfSubtotal = subtotal("DD", "TOTAL DETTES FINANCIÈRES",
    [emprunts.montantN, avancesRecues.montantN, provisionsFin.montantN]);
  lines.push(dfSubtotal);

  // ---- PASSIF CIRCULANT ----
  lines.push(header("--PC--", "PASSIF CIRCULANT"));

  const dettesFourn = passifLine("DG", "Fournisseurs et comptes rattachés",
    pat(rules, "DG", ["401", "402", "403", "404", "405", "406", "407", "408"]));
  lines.push(dettesFourn);

  const dettesFiscalesSociales = passifLine("DH", "Dettes fiscales et sociales",
    pat(rules, "DH", ["421", "422", "423", "424", "425", "426", "427", "428",
     "431", "432", "441", "442", "443", "444", "445"]));
  lines.push(dettesFiscalesSociales);

  const autresDettes = passifLine("DI", "Autres dettes et produits constatés d'avance",
    pat(rules, "DI", ["46", "47", "482", "483", "484", "485", "486", "487", "488"]));
  lines.push(autresDettes);

  const pcSubtotal = subtotal("DJ", "TOTAL PASSIF CIRCULANT",
    [dettesFourn.montantN, dettesFiscalesSociales.montantN, autresDettes.montantN]);
  lines.push(pcSubtotal);

  // ---- TRÉSORERIE-PASSIF ----
  lines.push(header("--TP--", "TRÉSORERIE-PASSIF"));

  const banquesCredit = passifLine("DT", "Banques, crédits de trésorerie",
    pat(rules, "DT", ["561", "562", "563", "564", "565"]));
  lines.push(banquesCredit);

  const decouvertsBanc = passifLine("DU", "Banques, découverts et autres engagements",
    pat(rules, "DU", ["519"]));
  lines.push(decouvertsBanc);

  const tpSubtotal = subtotal("DV", "TOTAL TRÉSORERIE-PASSIF",
    [banquesCredit.montantN, decouvertsBanc.montantN]);
  lines.push(tpSubtotal);

  // ---- TOTAL GÉNÉRAL PASSIF ----
  const totalPassif = cpSubtotal.montantN + dfSubtotal.montantN + pcSubtotal.montantN + tpSubtotal.montantN;
  lines.push({
    lineCode: "DZ",
    label: "TOTAL GÉNÉRAL PASSIF",
    isSubtotal: true,
    isSectionHeader: false,
    montantN: totalPassif,
  });

  return { lines, total: totalPassif };
}

// ---------------------------------------------------------------------------
// COMPTE DE RÉSULTAT (Système Normal — Soldes Intermédiaires de Gestion)
// ---------------------------------------------------------------------------

function computeCompteDeResultat(
  map: Map<string, AccountBal>,
  rules: RulesIndex,
): { lines: DsfCompteResultatLine[]; resultatNet: number } {
  const lines: DsfCompteResultatLine[] = [];

  // Use current-year movements for income statement (yearDebit / yearCredit)
  function charges(patterns: string[]): number {
    return sumYearDebit(map, patterns);
  }
  function produits(patterns: string[]): number {
    return sumYearCredit(map, patterns);
  }

  function line(
    code: string,
    label: string,
    p: number,
    c: number,
    intermediate = false,
    header = false,
  ): DsfCompteResultatLine {
    return { lineCode: code, label, produits: p, charges: c, solde: p - c, isIntermediate: intermediate, isSectionHeader: header };
  }

  // ---- EXPLOITATION ----
  lines.push(line("--EX--", "ACTIVITÉS D'EXPLOITATION", 0, 0, false, true));

  // Ventes et produits d'exploitation
  const ventesMarchandises = produits(pat(rules, "CR_VENTES_MARCHANDISES", ["701"]));
  const achatsMarchandises = charges(pat(rules, "CR_ACHATS_MARCHANDISES", ["601"]));
  const variationStocksMarchand =
    charges(pat(rules, "CR_VAR_STOCK_MARCHAND_CHARGE", ["6031"])) -
    produits(pat(rules, "CR_VAR_STOCK_MARCHAND_PRODUIT", ["7031"]));
  const margeBruteMarchand = ventesMarchandises - achatsMarchandises - variationStocksMarchand;

  lines.push(line("TA", "Ventes de marchandises", ventesMarchandises, 0));
  lines.push(line("RA", "Achats de marchandises", 0, achatsMarchandises));
  lines.push(line("RB", "Variation de stocks de marchandises",
    variationStocksMarchand < 0 ? -variationStocksMarchand : 0,
    variationStocksMarchand > 0 ? variationStocksMarchand : 0));
  lines.push(line("XA", "MARGE BRUTE SUR MARCHANDISES", Math.max(0, margeBruteMarchand), Math.max(0, -margeBruteMarchand), true));

  // Production
  const productionVendue = produits(pat(rules, "CR_PRODUCTION_VENDUE", ["702", "703", "704", "705", "706"]));
  const produitsAccessoires = produits(pat(rules, "CR_PRODUITS_ACCESSOIRES", ["707", "708", "709"]));
  const productionStockeePatterns = pat(rules, "CR_PRODUCTION_STOCKEE", ["71"]);
  const productionStockee = produits(productionStockeePatterns) - charges(productionStockeePatterns);
  const productionImmobilisee = produits(pat(rules, "CR_PRODUCTION_IMMOBILISEE", ["72"]));
  const totalProduction = productionVendue + produitsAccessoires + productionStockee + productionImmobilisee;

  lines.push(line("TB", "Ventes de produits fabriqués", productionVendue, 0));
  lines.push(line("TC", "Travaux et services vendus", 0, 0)); // included in TB
  lines.push(line("TD", "Production stockée (déstockage)", Math.max(0, productionStockee), Math.max(0, -productionStockee)));
  lines.push(line("TE", "Production immobilisée", productionImmobilisee, 0));

  // Achats matières
  const achatsMatieresConsommees =
    charges(pat(rules, "CR_ACHATS_MATIERES_BASE", ["602", "603", "604", "605", "606", "608"])) -
    charges(pat(rules, "CR_VAR_STOCK_MARCHAND_CHARGE", ["6031"]));
  lines.push(line("RC", "Achats de matières premières et fournitures", 0, achatsMatieresConsommees));

  // Services extérieurs
  const servicesExterieurs = charges(pat(rules, "CR_SERVICES_EXTERIEURS", ["61", "62", "63"]));
  lines.push(line("RD", "Services extérieurs", 0, servicesExterieurs));

  // Valeur Ajoutée
  const valeurAjoutee = margeBruteMarchand + totalProduction - achatsMatieresConsommees - servicesExterieurs;
  lines.push(line("XB", "VALEUR AJOUTÉE", Math.max(0, valeurAjoutee), Math.max(0, -valeurAjoutee), true));

  // Autres produits d'exploitation
  const subventionsExploit = produits(pat(rules, "CR_SUBVENTIONS_EXPLOITATION", ["74"]));
  lines.push(line("TF", "Subventions d'exploitation", subventionsExploit, 0));

  // Impôts et taxes
  const impotsTaxes = charges(pat(rules, "CR_IMPOTS_TAXES", ["64"]));
  lines.push(line("RE", "Impôts, taxes et versements assimilés", 0, impotsTaxes));

  // Charges de personnel
  const chargesPersonnel = charges(pat(rules, "CR_CHARGES_PERSONNEL", ["66"]));
  lines.push(line("RG", "Charges de personnel", 0, chargesPersonnel));

  // EBE
  const ebe = valeurAjoutee + subventionsExploit - impotsTaxes - chargesPersonnel;
  lines.push(line("XC", "EXCÉDENT BRUT D'EXPLOITATION (EBE)", Math.max(0, ebe), Math.max(0, -ebe), true));

  // Dotations aux amortissements
  const dotationsAmort = charges(pat(rules, "CR_DOTATIONS_AMORT_EXPLOIT", ["681", "691"]));
  lines.push(line("RI", "Dotations aux amortissements et provisions d'exploitation", 0, dotationsAmort));

  // Reprises
  const reprises = produits(pat(rules, "CR_REPRISES", ["781", "791"]));
  lines.push(line("TI", "Reprises de provisions et transferts de charges", reprises, 0));

  // Autres produits / charges d'exploitation
  const autresProduits = produits(pat(rules, "CR_AUTRES_PRODUITS_EXPLOIT", ["75"]));
  const autresCharges = charges(pat(rules, "CR_AUTRES_CHARGES_EXPLOIT", ["65"]));
  lines.push(line("TH", "Autres produits d'exploitation", autresProduits, 0));
  lines.push(line("RH", "Autres charges d'exploitation", 0, autresCharges));

  // Résultat d'exploitation
  const resultatExploit = ebe - dotationsAmort + reprises + autresProduits - autresCharges;
  lines.push(line("XD", "RÉSULTAT D'EXPLOITATION", Math.max(0, resultatExploit), Math.max(0, -resultatExploit), true));

  // ---- ACTIVITÉS FINANCIÈRES ----
  lines.push(line("--FI--", "ACTIVITÉS FINANCIÈRES", 0, 0, false, true));

  const produitsFinanciers = produits(pat(rules, "CR_PRODUITS_FINANCIERS", ["77", "787", "797"]));
  const chargesFinancieres = charges(pat(rules, "CR_CHARGES_FINANCIERES", ["67", "687", "697"]));
  lines.push(line("TJ", "Revenus financiers et produits assimilés", produitsFinanciers, 0));
  lines.push(line("RJ", "Frais financiers et charges assimilées", 0, chargesFinancieres));

  const resultatFinancier = produitsFinanciers - chargesFinancieres;
  lines.push(line("XE", "RÉSULTAT FINANCIER", Math.max(0, resultatFinancier), Math.max(0, -resultatFinancier), true));

  // ---- RAO ----
  const rao = resultatExploit + resultatFinancier;
  lines.push(line("XF", "RÉSULTAT DES ACTIVITÉS ORDINAIRES (RAO)", Math.max(0, rao), Math.max(0, -rao), true));

  // ---- HAO ----
  lines.push(line("--HAO--", "HORS ACTIVITÉS ORDINAIRES (HAO)", 0, 0, false, true));

  const produitsHao = produits(pat(rules, "CR_PRODUITS_HAO", ["82"]));
  const chargesHao = charges(pat(rules, "CR_CHARGES_HAO", ["83"]));
  lines.push(line("TN", "Produits des cessions d'actifs HAO", produitsHao, 0));
  lines.push(line("RN", "Valeur comptable des cessions d'actifs HAO", 0, chargesHao));

  const resultatHao = produitsHao - chargesHao;
  lines.push(line("XG", "RÉSULTAT HAO", Math.max(0, resultatHao), Math.max(0, -resultatHao), true));

  // ---- RÉSULTAT NET ----
  const participation = charges(pat(rules, "CR_PARTICIPATION", ["87"]));
  const impotBenefices = charges(pat(rules, "CR_IMPOT_BENEFICES", ["89"]));
  lines.push(line("RP", "Participation des travailleurs", 0, participation));
  lines.push(line("RS", "Impôts sur le résultat", 0, impotBenefices));

  const resultatNet = rao + resultatHao - participation - impotBenefices;
  lines.push(line("XI", "RÉSULTAT NET", Math.max(0, resultatNet), Math.max(0, -resultatNet), true));

  return { lines, resultatNet };
}

// ---------------------------------------------------------------------------
// TABLEAU DES FLUX DE TRÉSORERIE (Méthode indirecte — OHADA)
// ---------------------------------------------------------------------------

function computeTft(
  map: Map<string, AccountBal>,
  resultatNet: number,
  rules: RulesIndex,
): DsfTftLine[] {
  const lines: DsfTftLine[] = [];

  function h(code: string, label: string): DsfTftLine {
    return { lineCode: code, label, montantN: 0, isSubtotal: false, isSectionHeader: true };
  }
  function item(code: string, label: string, montantN: number): DsfTftLine {
    return { lineCode: code, label, montantN, isSubtotal: false, isSectionHeader: false };
  }
  function sub(code: string, label: string, montantN: number): DsfTftLine {
    return { lineCode: code, label, montantN, isSubtotal: true, isSectionHeader: false };
  }

  // ---- I. FLUX DE TRÉSORERIE LIÉS AUX ACTIVITÉS OPÉRATIONNELLES ----
  lines.push(h("--OP--", "I. FLUX DE TRÉSORERIE LIÉS AUX ACTIVITÉS OPÉRATIONNELLES"));

  lines.push(item("FA", "Résultat net de l'exercice", resultatNet));

  // Add back non-cash charges
  const dotationsAmortPat = pat(rules, "TFT_DOTATIONS_AMORT", ["681", "691"]);
  const dotationsAmort = sumYearDebit(map, dotationsAmortPat);
  lines.push(item("FB", "+ Dotations aux amortissements et provisions", dotationsAmort));

  const reprisesProvisions = sumYearCredit(map, pat(rules, "TFT_REPRISES_PROV", ["781", "791"]));
  lines.push(item("FC", "- Reprises de provisions", -reprisesProvisions));

  const plusValuesCessions =
    sumYearCredit(map, pat(rules, "TFT_CESSIONS_HAO_CREDIT", ["82"])) -
    sumYearDebit(map, pat(rules, "TFT_CESSIONS_HAO_DEBIT", ["83"]));
  lines.push(item("FD", "+/- Résultat des cessions d'actifs (HAO)", -plusValuesCessions));

  // Working capital variations
  // Stocks: increase in stocks = cash used (negative), decrease = cash generated (positive)
  const stocksPat = pat(rules, "TFT_STOCKS", ["31", "32", "33", "34", "35", "36", "37", "38"]);
  const variationStocks = sumYearCredit(map, stocksPat) - sumYearDebit(map, stocksPat);
  // positive yearCredit > yearDebit means stocks decreased = cash inflow
  lines.push(item("FE", "+/- Variation des stocks", variationStocks));

  // Créances: increase = cash used (negative)
  const creancesPat = pat(rules, "TFT_CREANCES", ["41", "42", "43", "44", "45", "46", "47"]);
  const variationCreances = sumYearCredit(map, creancesPat) - sumYearDebit(map, creancesPat);
  // positive means créances decreased = cash inflow
  lines.push(item("FF", "+/- Variation des créances d'exploitation", variationCreances));

  // Dettes: increase = cash inflow
  const dettesPat = pat(rules, "TFT_DETTES", ["40", "42", "43", "44", "45", "46", "47"]);
  const variationDettes = sumYearCredit(map, dettesPat) - sumYearDebit(map, dettesPat);
  lines.push(item("FG", "+/- Variation des dettes d'exploitation", variationDettes));

  const totalOperationnel = resultatNet + dotationsAmort - reprisesProvisions - plusValuesCessions + variationStocks + variationCreances + variationDettes;
  lines.push(sub("ZA", "FLUX DE TRÉSORERIE DES ACTIVITÉS OPÉRATIONNELLES", totalOperationnel));

  // ---- II. FLUX DE TRÉSORERIE LIÉS AUX ACTIVITÉS D'INVESTISSEMENT ----
  lines.push(h("--INV--", "II. FLUX DE TRÉSORERIE LIÉS AUX ACTIVITÉS D'INVESTISSEMENT"));

  const acquisitionsImmo = sumYearDebit(map, pat(rules, "TFT_ACQUISITIONS_IMMO", ["20", "21", "22", "23", "24", "25", "26", "27"]));
  lines.push(item("FH", "- Acquisitions d'immobilisations", -acquisitionsImmo));

  const prodCessionsImmo = sumYearCredit(map, pat(rules, "TFT_CESSIONS_IMMO", ["20", "21", "22", "23", "24", "25", "26", "27"]));
  lines.push(item("FI", "+ Produits de cessions d'immobilisations", prodCessionsImmo));

  const immoFinPat = pat(rules, "TFT_IMMO_FIN_VAR", ["26", "27"]);
  const variationImmoFin = sumYearDebit(map, immoFinPat) - sumYearCredit(map, immoFinPat);
  lines.push(item("FJ", "+/- Variation des immobilisations financières", -variationImmoFin));

  const totalInvestissement = -acquisitionsImmo + prodCessionsImmo - variationImmoFin;
  lines.push(sub("ZB", "FLUX DE TRÉSORERIE DES ACTIVITÉS D'INVESTISSEMENT", totalInvestissement));

  // ---- III. FLUX DE TRÉSORERIE LIÉS AUX ACTIVITÉS DE FINANCEMENT ----
  lines.push(h("--FIN--", "III. FLUX DE TRÉSORERIE LIÉS AUX ACTIVITÉS DE FINANCEMENT"));

  const augmentationCapital = sumYearCredit(map, pat(rules, "TFT_AUGMENTATION_CAPITAL", ["101", "102", "103", "104", "105"]));
  lines.push(item("FK", "+ Augmentation de capital et apports", augmentationCapital));

  const empruntsNouveaux = sumYearCredit(map, pat(rules, "TFT_EMPRUNTS_NOUVEAUX", ["16", "17", "18"]));
  lines.push(item("FL", "+ Nouveaux emprunts et dettes financières", empruntsNouveaux));

  const remboursementsEmprunts = sumYearDebit(map, pat(rules, "TFT_REMBOURSEMENTS_EMPRUNTS", ["16", "17", "18"]));
  lines.push(item("FM", "- Remboursements d'emprunts et dettes financières", -remboursementsEmprunts));

  const dividendes = sumYearDebit(map, pat(rules, "TFT_DIVIDENDES", ["457", "458"]));
  lines.push(item("FN", "- Dividendes versés", -dividendes));

  const totalFinancement = augmentationCapital + empruntsNouveaux - remboursementsEmprunts - dividendes;
  lines.push(sub("ZC", "FLUX DE TRÉSORERIE DES ACTIVITÉS DE FINANCEMENT", totalFinancement));

  // ---- VARIATION NETTE DE TRÉSORERIE ----
  const variationNette = totalOperationnel + totalInvestissement + totalFinancement;
  lines.push(sub("ZD", "VARIATION NETTE DE LA TRÉSORERIE DE L'EXERCICE", variationNette));

  // Opening cash (beginning-of-year balance)
  const tresorerieOuverture =
    sumDebit(map, pat(rules, "TFT_TRESORERIE_DEBIT", ["50", "511", "512", "513", "514", "52", "53", "57"])) -
    sumCredit(map, pat(rules, "TFT_TRESORERIE_CREDIT", ["519", "561", "562", "563", "564", "565"]));
  lines.push(item("ZE", "Trésorerie à l'ouverture de l'exercice",
    tresorerieOuverture - variationNette)); // approximate
  lines.push(sub("ZF", "TRÉSORERIE À LA CLÔTURE DE L'EXERCICE",
    tresorerieOuverture));

  return lines;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeDsf(
  balances: BalanceRow[],
  mappingRules: DsfMappingRuleInput[] = [],
): DsfResult {
  const map = buildAccountMap(balances);
  const rules = buildRulesIndex(mappingRules);

  // Grand totals for balance-check
  const totalDebits = balances.reduce((s, r) => s + r.totalDebit + (r.initialBalance > 0 ? r.initialBalance : 0), 0);
  const totalCredits = balances.reduce((s, r) => s + r.totalCredit + (r.initialBalance < 0 ? -r.initialBalance : 0), 0);
  const balanceEquilibre = Math.abs(totalDebits - totalCredits) < 1;

  // Income statement (needed for bilan passif résultat line)
  const { lines: crLines, resultatNet } = computeCompteDeResultat(map, rules);

  // Balance sheet
  const { lines: actifLines, total: totalActif } = computeBilanActif(map, rules);
  const { lines: passifLines, total: totalPassif } = computeBilanPassif(map, resultatNet, rules);

  // Cash flow
  const tftLines = computeTft(map, resultatNet, rules);

  const bilanEquilibre = Math.abs(totalActif - totalPassif) < 1;

  return {
    bilanActif: actifLines,
    bilanPassif: passifLines,
    compteResultat: crLines,
    tft: tftLines,
    totalBilanActif: totalActif,
    totalBilanPassif: totalPassif,
    balanceEquilibre,
    bilanEquilibre,
    totalDebits,
    totalCredits,
  };
}
