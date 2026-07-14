import { db, dsfMappingRulesTable } from "./index";
import { sql } from "drizzle-orm";

// Seeds the Module M24 (DSF / Liasse Fiscale) account-to-line mapping rules
// consumed by artifacts/api-server/src/lib/dsf-engine.ts. Every pattern here
// mirrors the engine's previous hardcoded constants exactly, so seeding (or
// not seeding) this table never changes a single computed figure -- it only
// makes the mapping inspectable and, eventually, editable from the DB
// instead of buried in code. Safe to re-run: upserts on
// (statement_type, line_code).
const RULES: {
  statementType: "BILAN_ACTIF" | "BILAN_PASSIF" | "COMPTE_DE_RESULTAT" | "TFT";
  lineCode: string;
  lineLabel: string;
  accountPatterns: string;
  operation: "SUM_DEBIT" | "SUM_CREDIT" | "NET_BALANCE";
  sortOrder: number;
}[] = [
  // ---- BILAN ACTIF (brut/amort pairs; *_BRUT is SUM_DEBIT, *_AMORT is SUM_CREDIT) ----
  { statementType: "BILAN_ACTIF", lineCode: "AB_BRUT", lineLabel: "Immobilisations incorporelles (brut)", accountPatterns: "20,21", operation: "SUM_DEBIT", sortOrder: 10 },
  { statementType: "BILAN_ACTIF", lineCode: "AB_AMORT", lineLabel: "Immobilisations incorporelles (amortissements)", accountPatterns: "280,281", operation: "SUM_CREDIT", sortOrder: 11 },
  { statementType: "BILAN_ACTIF", lineCode: "AC_BRUT", lineLabel: "Terrains (brut)", accountPatterns: "22", operation: "SUM_DEBIT", sortOrder: 20 },
  { statementType: "BILAN_ACTIF", lineCode: "AC_AMORT", lineLabel: "Terrains (amortissements)", accountPatterns: "292", operation: "SUM_CREDIT", sortOrder: 21 },
  { statementType: "BILAN_ACTIF", lineCode: "AD_BRUT", lineLabel: "Bâtiments (brut)", accountPatterns: "231,232,233,234", operation: "SUM_DEBIT", sortOrder: 30 },
  { statementType: "BILAN_ACTIF", lineCode: "AD_AMORT", lineLabel: "Bâtiments (amortissements)", accountPatterns: "2831,2832,2833,2834", operation: "SUM_CREDIT", sortOrder: 31 },
  { statementType: "BILAN_ACTIF", lineCode: "AE_BRUT", lineLabel: "Aménagements, agencements et installations (brut)", accountPatterns: "235,236,238", operation: "SUM_DEBIT", sortOrder: 40 },
  { statementType: "BILAN_ACTIF", lineCode: "AE_AMORT", lineLabel: "Aménagements, agencements et installations (amortissements)", accountPatterns: "2835,2836,2838", operation: "SUM_CREDIT", sortOrder: 41 },
  { statementType: "BILAN_ACTIF", lineCode: "AF_BRUT", lineLabel: "Matériel, mobilier et actifs biologiques (brut)", accountPatterns: "241,242,243,244,245,246,247,248", operation: "SUM_DEBIT", sortOrder: 50 },
  { statementType: "BILAN_ACTIF", lineCode: "AF_AMORT", lineLabel: "Matériel, mobilier et actifs biologiques (amortissements)", accountPatterns: "2841,2842,2843,2844,2845,2846,2847,2848", operation: "SUM_CREDIT", sortOrder: 51 },
  { statementType: "BILAN_ACTIF", lineCode: "AH_BRUT", lineLabel: "Avances et acomptes versés sur immobilisations", accountPatterns: "251,252,253,254", operation: "SUM_DEBIT", sortOrder: 60 },
  { statementType: "BILAN_ACTIF", lineCode: "AI_BRUT", lineLabel: "Immobilisations financières (brut)", accountPatterns: "26,27", operation: "SUM_DEBIT", sortOrder: 70 },
  { statementType: "BILAN_ACTIF", lineCode: "AI_AMORT", lineLabel: "Immobilisations financières (amortissements/dépréciations)", accountPatterns: "296,297", operation: "SUM_CREDIT", sortOrder: 71 },
  { statementType: "BILAN_ACTIF", lineCode: "BA_BRUT", lineLabel: "Stocks et encours (brut)", accountPatterns: "31,32,33,34,35,36,37,38", operation: "SUM_DEBIT", sortOrder: 80 },
  { statementType: "BILAN_ACTIF", lineCode: "BA_AMORT", lineLabel: "Stocks et encours (dépréciations)", accountPatterns: "391,392,393,394,395,396,397,398", operation: "SUM_CREDIT", sortOrder: 81 },
  { statementType: "BILAN_ACTIF", lineCode: "BB_BRUT", lineLabel: "Créances clients et comptes rattachés (brut)", accountPatterns: "411,412,413,414,415,416,417", operation: "SUM_DEBIT", sortOrder: 90 },
  { statementType: "BILAN_ACTIF", lineCode: "BB_AMORT", lineLabel: "Créances clients et comptes rattachés (dépréciations)", accountPatterns: "491", operation: "SUM_CREDIT", sortOrder: 91 },
  { statementType: "BILAN_ACTIF", lineCode: "BC_BRUT", lineLabel: "Autres créances (brut)", accountPatterns: "42,43,44,45,46,47,481,485,486,487,488", operation: "SUM_DEBIT", sortOrder: 100 },
  { statementType: "BILAN_ACTIF", lineCode: "BC_AMORT", lineLabel: "Autres créances (dépréciations)", accountPatterns: "499", operation: "SUM_CREDIT", sortOrder: 101 },
  { statementType: "BILAN_ACTIF", lineCode: "BG_BRUT", lineLabel: "Titres de placement (brut)", accountPatterns: "50", operation: "SUM_DEBIT", sortOrder: 110 },
  { statementType: "BILAN_ACTIF", lineCode: "BG_AMORT", lineLabel: "Titres de placement (dépréciations)", accountPatterns: "590", operation: "SUM_CREDIT", sortOrder: 111 },
  { statementType: "BILAN_ACTIF", lineCode: "BH_BRUT", lineLabel: "Valeurs à encaisser", accountPatterns: "511,512,513,514", operation: "SUM_DEBIT", sortOrder: 120 },
  { statementType: "BILAN_ACTIF", lineCode: "BI_BRUT", lineLabel: "Banques, chèques postaux, caisse et assimilés", accountPatterns: "52,53,57", operation: "SUM_DEBIT", sortOrder: 130 },

  // ---- BILAN PASSIF (all SUM_CREDIT) ----
  { statementType: "BILAN_PASSIF", lineCode: "CA", lineLabel: "Capital", accountPatterns: "101,102,103,104", operation: "SUM_CREDIT", sortOrder: 10 },
  { statementType: "BILAN_PASSIF", lineCode: "CB", lineLabel: "Primes, réserves et fonds assimilés", accountPatterns: "105,106,107,108,11", operation: "SUM_CREDIT", sortOrder: 20 },
  { statementType: "BILAN_PASSIF", lineCode: "CD", lineLabel: "Report à nouveau", accountPatterns: "12", operation: "SUM_CREDIT", sortOrder: 30 },
  { statementType: "BILAN_PASSIF", lineCode: "CF", lineLabel: "Subventions d'investissement", accountPatterns: "14", operation: "SUM_CREDIT", sortOrder: 40 },
  { statementType: "BILAN_PASSIF", lineCode: "CG", lineLabel: "Provisions réglementées et fonds assimilés", accountPatterns: "15", operation: "SUM_CREDIT", sortOrder: 50 },
  { statementType: "BILAN_PASSIF", lineCode: "DA", lineLabel: "Emprunts et dettes financières", accountPatterns: "16,17", operation: "SUM_CREDIT", sortOrder: 60 },
  { statementType: "BILAN_PASSIF", lineCode: "DB", lineLabel: "Dettes de location-financement et assimilés", accountPatterns: "18", operation: "SUM_CREDIT", sortOrder: 70 },
  { statementType: "BILAN_PASSIF", lineCode: "DC", lineLabel: "Provisions pour risques et charges", accountPatterns: "19", operation: "SUM_CREDIT", sortOrder: 80 },
  { statementType: "BILAN_PASSIF", lineCode: "DG", lineLabel: "Fournisseurs et comptes rattachés", accountPatterns: "401,402,403,404,405,406,407,408", operation: "SUM_CREDIT", sortOrder: 90 },
  { statementType: "BILAN_PASSIF", lineCode: "DH", lineLabel: "Dettes fiscales et sociales", accountPatterns: "421,422,423,424,425,426,427,428,431,432,441,442,443,444,445", operation: "SUM_CREDIT", sortOrder: 100 },
  { statementType: "BILAN_PASSIF", lineCode: "DI", lineLabel: "Autres dettes et produits constatés d'avance", accountPatterns: "46,47,482,483,484,485,486,487,488", operation: "SUM_CREDIT", sortOrder: 110 },
  { statementType: "BILAN_PASSIF", lineCode: "DT", lineLabel: "Banques, crédits de trésorerie", accountPatterns: "561,562,563,564,565", operation: "SUM_CREDIT", sortOrder: 120 },
  { statementType: "BILAN_PASSIF", lineCode: "DU", lineLabel: "Banques, découverts et autres engagements", accountPatterns: "519", operation: "SUM_CREDIT", sortOrder: 130 },

  // ---- COMPTE DE RÉSULTAT (internal calculation keys) ----
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_VENTES_MARCHANDISES", lineLabel: "Ventes de marchandises", accountPatterns: "701", operation: "SUM_CREDIT", sortOrder: 10 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_ACHATS_MARCHANDISES", lineLabel: "Achats de marchandises", accountPatterns: "601", operation: "SUM_DEBIT", sortOrder: 20 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_VAR_STOCK_MARCHAND_CHARGE", lineLabel: "Variation de stocks de marchandises (charge)", accountPatterns: "6031", operation: "SUM_DEBIT", sortOrder: 30 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_VAR_STOCK_MARCHAND_PRODUIT", lineLabel: "Variation de stocks de marchandises (produit)", accountPatterns: "7031", operation: "SUM_CREDIT", sortOrder: 31 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_PRODUCTION_VENDUE", lineLabel: "Ventes de produits fabriqués / travaux et services vendus", accountPatterns: "702,703,704,705,706", operation: "SUM_CREDIT", sortOrder: 40 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_PRODUITS_ACCESSOIRES", lineLabel: "Produits accessoires", accountPatterns: "707,708,709", operation: "SUM_CREDIT", sortOrder: 41 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_PRODUCTION_STOCKEE", lineLabel: "Production stockée / déstockage", accountPatterns: "71", operation: "NET_BALANCE", sortOrder: 50 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_PRODUCTION_IMMOBILISEE", lineLabel: "Production immobilisée", accountPatterns: "72", operation: "SUM_CREDIT", sortOrder: 60 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_ACHATS_MATIERES_BASE", lineLabel: "Achats de matières premières et fournitures liées", accountPatterns: "602,603,604,605,606,608", operation: "SUM_DEBIT", sortOrder: 70 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_SERVICES_EXTERIEURS", lineLabel: "Services extérieurs", accountPatterns: "61,62,63", operation: "SUM_DEBIT", sortOrder: 80 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_SUBVENTIONS_EXPLOITATION", lineLabel: "Subventions d'exploitation", accountPatterns: "74", operation: "SUM_CREDIT", sortOrder: 90 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_IMPOTS_TAXES", lineLabel: "Impôts, taxes et versements assimilés", accountPatterns: "64", operation: "SUM_DEBIT", sortOrder: 100 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_CHARGES_PERSONNEL", lineLabel: "Charges de personnel", accountPatterns: "66", operation: "SUM_DEBIT", sortOrder: 110 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_DOTATIONS_AMORT_EXPLOIT", lineLabel: "Dotations aux amortissements et provisions d'exploitation", accountPatterns: "681,691", operation: "SUM_DEBIT", sortOrder: 120 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_REPRISES", lineLabel: "Reprises de provisions et transferts de charges", accountPatterns: "781,791", operation: "SUM_CREDIT", sortOrder: 130 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_AUTRES_PRODUITS_EXPLOIT", lineLabel: "Autres produits d'exploitation", accountPatterns: "75", operation: "SUM_CREDIT", sortOrder: 140 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_AUTRES_CHARGES_EXPLOIT", lineLabel: "Autres charges d'exploitation", accountPatterns: "65", operation: "SUM_DEBIT", sortOrder: 150 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_PRODUITS_FINANCIERS", lineLabel: "Revenus financiers et produits assimilés", accountPatterns: "77,787,797", operation: "SUM_CREDIT", sortOrder: 160 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_CHARGES_FINANCIERES", lineLabel: "Frais financiers et charges assimilées", accountPatterns: "67,687,697", operation: "SUM_DEBIT", sortOrder: 170 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_PRODUITS_HAO", lineLabel: "Produits des cessions d'actifs HAO", accountPatterns: "82", operation: "SUM_CREDIT", sortOrder: 180 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_CHARGES_HAO", lineLabel: "Valeur comptable des cessions d'actifs HAO", accountPatterns: "83", operation: "SUM_DEBIT", sortOrder: 190 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_PARTICIPATION", lineLabel: "Participation des travailleurs", accountPatterns: "87", operation: "SUM_DEBIT", sortOrder: 200 },
  { statementType: "COMPTE_DE_RESULTAT", lineCode: "CR_IMPOT_BENEFICES", lineLabel: "Impôts sur le résultat", accountPatterns: "89", operation: "SUM_DEBIT", sortOrder: 210 },

  // ---- TFT (internal calculation keys) ----
  { statementType: "TFT", lineCode: "TFT_DOTATIONS_AMORT", lineLabel: "Dotations aux amortissements et provisions", accountPatterns: "681,691", operation: "SUM_DEBIT", sortOrder: 10 },
  { statementType: "TFT", lineCode: "TFT_REPRISES_PROV", lineLabel: "Reprises de provisions", accountPatterns: "781,791", operation: "SUM_CREDIT", sortOrder: 20 },
  { statementType: "TFT", lineCode: "TFT_CESSIONS_HAO_CREDIT", lineLabel: "Produits des cessions d'actifs (HAO)", accountPatterns: "82", operation: "SUM_CREDIT", sortOrder: 30 },
  { statementType: "TFT", lineCode: "TFT_CESSIONS_HAO_DEBIT", lineLabel: "Valeur comptable des cessions d'actifs (HAO)", accountPatterns: "83", operation: "SUM_DEBIT", sortOrder: 31 },
  { statementType: "TFT", lineCode: "TFT_STOCKS", lineLabel: "Variation des stocks", accountPatterns: "31,32,33,34,35,36,37,38", operation: "NET_BALANCE", sortOrder: 40 },
  { statementType: "TFT", lineCode: "TFT_CREANCES", lineLabel: "Variation des créances d'exploitation", accountPatterns: "41,42,43,44,45,46,47", operation: "NET_BALANCE", sortOrder: 50 },
  { statementType: "TFT", lineCode: "TFT_DETTES", lineLabel: "Variation des dettes d'exploitation", accountPatterns: "40,42,43,44,45,46,47", operation: "NET_BALANCE", sortOrder: 60 },
  { statementType: "TFT", lineCode: "TFT_ACQUISITIONS_IMMO", lineLabel: "Acquisitions d'immobilisations", accountPatterns: "20,21,22,23,24,25,26,27", operation: "SUM_DEBIT", sortOrder: 70 },
  { statementType: "TFT", lineCode: "TFT_CESSIONS_IMMO", lineLabel: "Produits de cessions d'immobilisations", accountPatterns: "20,21,22,23,24,25,26,27", operation: "SUM_CREDIT", sortOrder: 71 },
  { statementType: "TFT", lineCode: "TFT_IMMO_FIN_VAR", lineLabel: "Variation des immobilisations financières", accountPatterns: "26,27", operation: "NET_BALANCE", sortOrder: 80 },
  { statementType: "TFT", lineCode: "TFT_AUGMENTATION_CAPITAL", lineLabel: "Augmentation de capital et apports", accountPatterns: "101,102,103,104,105", operation: "SUM_CREDIT", sortOrder: 90 },
  { statementType: "TFT", lineCode: "TFT_EMPRUNTS_NOUVEAUX", lineLabel: "Nouveaux emprunts et dettes financières", accountPatterns: "16,17,18", operation: "SUM_CREDIT", sortOrder: 100 },
  { statementType: "TFT", lineCode: "TFT_REMBOURSEMENTS_EMPRUNTS", lineLabel: "Remboursements d'emprunts et dettes financières", accountPatterns: "16,17,18", operation: "SUM_DEBIT", sortOrder: 101 },
  { statementType: "TFT", lineCode: "TFT_DIVIDENDES", lineLabel: "Dividendes versés", accountPatterns: "457,458", operation: "SUM_DEBIT", sortOrder: 110 },
  { statementType: "TFT", lineCode: "TFT_TRESORERIE_DEBIT", lineLabel: "Trésorerie (comptes débiteurs)", accountPatterns: "50,511,512,513,514,52,53,57", operation: "SUM_DEBIT", sortOrder: 120 },
  { statementType: "TFT", lineCode: "TFT_TRESORERIE_CREDIT", lineLabel: "Trésorerie (comptes créditeurs / découverts)", accountPatterns: "519,561,562,563,564,565", operation: "SUM_CREDIT", sortOrder: 121 },
];

async function main() {
  for (const rule of RULES) {
    await db
      .insert(dsfMappingRulesTable)
      .values(rule)
      .onConflictDoUpdate({
        target: [dsfMappingRulesTable.statementType, dsfMappingRulesTable.lineCode],
        set: {
          lineLabel: rule.lineLabel,
          accountPatterns: rule.accountPatterns,
          operation: rule.operation,
          sortOrder: rule.sortOrder,
          updatedAt: sql`now()`,
        },
      });
  }
  console.log(`Seeded ${RULES.length} DSF mapping rules.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
