/**
 * seed-syscohada.ts — Plan Comptable Général SYSCOHADA Révisé (2018)
 *
 * Seed idempotent (upsert) couvrant :
 *   • ~220 comptes Classes 1 à 8 — niveaux 3, 4 et 6 chiffres
 *   • Tous les comptes de niveau 6 chiffres réellement postés par le moteur
 *     comptable sont inclus (règle : aucune écriture ne doit atterrir sur un
 *     compte parent à 3 chiffres)
 *   • ~30 catégories de transactions (transaction_categories)
 *
 * Convention sous-comptes 6 chiffres :
 *   - ABC (3c) → ABC100  (compte principal de la rubrique)
 *   - ABCD (4c) → ABCD00 (compte principal de la sous-rubrique)
 *   - 471 → 471000, 472 → 472000 (comptes d'attente — zéro final explicite)
 *
 * Fournisseurs Mobile Money (par ordre alphabétique de code) :
 *   552100 = Wave  |  552200 = Orange Money  |  552300 = MTN MoMo  |  552400 = Moov Money
 *
 * Exécuté via : pnpm --filter @workspace/db seed:syscohada
 * Intégré au bootstrap global : seed-all.ts
 */

import { db, accountsTable, transactionCategoriesTable } from "./index";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// 1. Plan Comptable SYSCOHADA Révisé — Classes 1 à 8
// ---------------------------------------------------------------------------

type AccountType =
  | "CAPITAL"
  | "IMMOBILISATION"
  | "STOCK"
  | "TIERS"
  | "TRESORERIE"
  | "CHARGE"
  | "PRODUIT"
  | "HAO"
  | "ATTENTE";

const COMPTES: {
  accountNumber: string;
  name: string;
  accountClass: number;
  accountType: AccountType;
}[] = [
  // ── Classe 1 — Ressources durables ───────────────────────────────────────
  { accountNumber: "101",    name: "Capital social",                                          accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1011",   name: "Capital souscrit, non appelé",                            accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1012",   name: "Capital souscrit, appelé, non versé",                     accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1013",   name: "Capital souscrit, appelé, versé, non amorti",             accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "101300", name: "Capital souscrit, appelé, versé, non amorti — principal", accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "104",    name: "Primes liées au capital social",                          accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "105",    name: "Écarts de réévaluation",                                  accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "106",    name: "Réserves",                                                accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1061",   name: "Réserve légale",                                          accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1062",   name: "Réserves statutaires ou contractuelles",                  accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1068",   name: "Autres réserves",                                         accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "110",    name: "Report à nouveau (solde créditeur)",                      accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "119",    name: "Report à nouveau (solde débiteur)",                       accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "120",    name: "Résultat net de l'exercice (bénéfice)",                   accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "129",    name: "Résultat net de l'exercice (perte)",                      accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "131",    name: "Résultat net de l'exercice — bénéfice (clôture)",         accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1301",   name: "Résultat net de l'exercice (bénéfice)",                   accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "130100", name: "Résultat net de l'exercice — Bénéfice (principal)",       accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "1309",   name: "Résultat net de l'exercice (perte)",                      accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "130900", name: "Résultat net de l'exercice — Perte (principal)",          accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "139",    name: "Résultat net de l'exercice — perte (clôture)",            accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "141",    name: "Subventions d'équipement",                                accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "142",    name: "Subventions d'équilibre",                                 accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "161",    name: "Emprunts obligataires",                                   accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "162",    name: "Emprunts auprès des établissements de crédit",            accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "163",    name: "Avances reçues et comptes courants",                      accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "164",    name: "Dettes de location-acquisition",                          accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "165",    name: "Dépôts et cautionnements reçus",                          accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "166",    name: "Intérêts courus sur emprunts",                            accountClass: 1, accountType: "CAPITAL" },
  { accountNumber: "168",    name: "Autres emprunts et dettes financières diverses",          accountClass: 1, accountType: "CAPITAL" },

  // ── Classe 2 — Actif immobilisé ──────────────────────────────────────────
  { accountNumber: "201",    name: "Frais d'établissement",                                   accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "202",    name: "Frais de recherche et de développement",                  accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "211",    name: "Frais de développement immobilisés",                      accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "212",    name: "Brevets, licences, logiciels et droits similaires",       accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "213",    name: "Fonds commercial",                                        accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "214",    name: "Autres immobilisations incorporelles",                    accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "221",    name: "Terrains agricoles et forestiers",                        accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "222",    name: "Terrains nus",                                            accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "223",    name: "Terrains bâtis",                                          accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "231",    name: "Bâtiments",                                               accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "232",    name: "Aménagements, agencements et installations",              accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "233",    name: "Installations techniques",                                accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "241",    name: "Matériel industriel",                                     accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "244",    name: "Matériel et mobilier",                                    accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "245",    name: "Matériel de transport",                                   accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "248",    name: "Autres matériels et mobiliers",                           accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "251",    name: "Titres de participation",                                 accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "252",    name: "Titres immobilisés de l'activité de portefeuille",        accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "261",    name: "Prêts à long et moyen terme",                             accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "274",    name: "Prêts au personnel",                                      accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "275",    name: "Dépôts et cautionnements versés",                         accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "281",    name: "Amortissements des frais d'établissement",                accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "284",    name: "Amortissements des matériels et mobiliers",               accountClass: 2, accountType: "IMMOBILISATION" },
  { accountNumber: "285",    name: "Amortissements des matériels de transport",               accountClass: 2, accountType: "IMMOBILISATION" },

  // ── Classe 3 — Stocks ────────────────────────────────────────────────────
  { accountNumber: "301",    name: "Marchandises",                                            accountClass: 3, accountType: "STOCK" },
  { accountNumber: "311",    name: "Marchandises (stockées)",                                 accountClass: 3, accountType: "STOCK" },
  { accountNumber: "321",    name: "Matières premières",                                      accountClass: 3, accountType: "STOCK" },
  { accountNumber: "322",    name: "Autres approvisionnements stockés",                       accountClass: 3, accountType: "STOCK" },
  { accountNumber: "332",    name: "Produits en cours de fabrication de biens",               accountClass: 3, accountType: "STOCK" },
  { accountNumber: "351",    name: "Produits semi-finis",                                     accountClass: 3, accountType: "STOCK" },
  { accountNumber: "355",    name: "Produits finis",                                          accountClass: 3, accountType: "STOCK" },
  { accountNumber: "371",    name: "Produits résiduels ou matières de récupération",          accountClass: 3, accountType: "STOCK" },
  { accountNumber: "381",    name: "Marchandises en cours de route",                          accountClass: 3, accountType: "STOCK" },
  { accountNumber: "391",    name: "Dépréciations des marchandises",                          accountClass: 3, accountType: "STOCK" },

  // ── Classe 4 — Comptes de tiers ──────────────────────────────────────────
  { accountNumber: "401",    name: "Fournisseurs, dettes en compte",                          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4011",   name: "Fournisseurs d'exploitation",                             accountClass: 4, accountType: "TIERS" },
  { accountNumber: "401100", name: "Fournisseurs d'exploitation — compte principal",          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "402",    name: "Fournisseurs, effets à payer",                            accountClass: 4, accountType: "TIERS" },
  { accountNumber: "408",    name: "Fournisseurs, factures non parvenues",                    accountClass: 4, accountType: "TIERS" },
  { accountNumber: "409",    name: "Fournisseurs débiteurs",                                  accountClass: 4, accountType: "TIERS" },
  { accountNumber: "411",    name: "Clients",                                                 accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4111",   name: "Clients",                                                 accountClass: 4, accountType: "TIERS" },
  { accountNumber: "411100", name: "Clients — compte principal",                              accountClass: 4, accountType: "TIERS" },
  { accountNumber: "412",    name: "Clients, effets à recevoir en portefeuille",              accountClass: 4, accountType: "TIERS" },
  { accountNumber: "413",    name: "Clients, avances reçues sur commandes en cours",         accountClass: 4, accountType: "TIERS" },
  { accountNumber: "416",    name: "Clients douteux ou litigieux",                            accountClass: 4, accountType: "TIERS" },
  { accountNumber: "418",    name: "Clients, produits non encore facturés",                   accountClass: 4, accountType: "TIERS" },
  { accountNumber: "419",    name: "Clients créditeurs",                                      accountClass: 4, accountType: "TIERS" },
  { accountNumber: "421",    name: "Personnel, avances et acomptes",                          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "422",    name: "Personnel, rémunérations dues",                           accountClass: 4, accountType: "TIERS" },
  { accountNumber: "422100", name: "Personnel, rémunérations dues — net à payer",             accountClass: 4, accountType: "TIERS" },
  { accountNumber: "424",    name: "Personnel, participations aux bénéfices",                 accountClass: 4, accountType: "TIERS" },
  { accountNumber: "425",    name: "Personnel, charges à payer et produits à recevoir",       accountClass: 4, accountType: "TIERS" },
  { accountNumber: "426",    name: "Personnel, autres créances et dettes",                    accountClass: 4, accountType: "TIERS" },
  { accountNumber: "431",    name: "Organismes sociaux",                                      accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4311",   name: "CNPS — cotisations à reverser",                           accountClass: 4, accountType: "TIERS" },
  { accountNumber: "431100", name: "CNPS — cotisations patronales et salariales",             accountClass: 4, accountType: "TIERS" },
  { accountNumber: "432",    name: "État et collectivités publiques, impôts et taxes",        accountClass: 4, accountType: "TIERS" },
  { accountNumber: "441",    name: "État, impôts sur les bénéfices",                          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4441",   name: "État, impôts sur les bénéfices à payer",                  accountClass: 4, accountType: "TIERS" },
  { accountNumber: "444",    name: "État, impôts sur les bénéfices",                          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "445",    name: "État, TVA",                                               accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4431",   name: "TVA facturée sur ventes de marchandises",                 accountClass: 4, accountType: "TIERS" },
  { accountNumber: "443100", name: "TVA collectée sur ventes de marchandises — 18%",          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4432",   name: "TVA facturée sur prestations de services",                accountClass: 4, accountType: "TIERS" },
  { accountNumber: "443200", name: "TVA collectée sur prestations de services — 18%",         accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4451",   name: "TVA récupérable sur achats",                              accountClass: 4, accountType: "TIERS" },
  { accountNumber: "445100", name: "TVA récupérable sur achats — compte principal",           accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4452",   name: "TVA récupérable sur immobilisations",                     accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4453",   name: "TVA collectée",                                           accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4454",   name: "TVA due (à décaisser)",                                   accountClass: 4, accountType: "TIERS" },
  { accountNumber: "447",    name: "État, autres impôts et taxes",                            accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4471",   name: "ITS, Taxe d'apprentissage et FDFP à reverser",            accountClass: 4, accountType: "TIERS" },
  { accountNumber: "447100", name: "ITS, Taxe d'apprentissage et FDFP — compte principal",    accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4472",   name: "Impôts retenus à la source",                              accountClass: 4, accountType: "TIERS" },
  { accountNumber: "447200", name: "AIB — Acompte sur Impôts et Bénéfices",                   accountClass: 4, accountType: "TIERS" },
  { accountNumber: "448",    name: "État, charges à payer et produits à recevoir",            accountClass: 4, accountType: "TIERS" },
  { accountNumber: "451",    name: "Groupe",                                                  accountClass: 4, accountType: "TIERS" },
  { accountNumber: "461",    name: "Débiteurs divers",                                        accountClass: 4, accountType: "TIERS" },
  { accountNumber: "4613",   name: "Associés, capital souscrit — appelé, non versé",          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "461300", name: "Associés, capital souscrit — appelé, non versé (6c)",     accountClass: 4, accountType: "TIERS" },
  { accountNumber: "462",    name: "Créditeurs divers",                                       accountClass: 4, accountType: "TIERS" },
  { accountNumber: "471",    name: "Compte d'attente (débiteurs)",                            accountClass: 4, accountType: "ATTENTE" },
  { accountNumber: "471000", name: "Compte d'attente débiteurs — principal",                  accountClass: 4, accountType: "ATTENTE" },
  { accountNumber: "472",    name: "Compte d'attente (créditeurs)",                           accountClass: 4, accountType: "ATTENTE" },
  { accountNumber: "472000", name: "Compte d'attente créditeurs — principal",                 accountClass: 4, accountType: "ATTENTE" },
  { accountNumber: "476",    name: "Charges constatées d'avance",                             accountClass: 4, accountType: "TIERS" },
  { accountNumber: "477",    name: "Produits constatés d'avance",                             accountClass: 4, accountType: "TIERS" },
  { accountNumber: "481",    name: "Fournisseurs d'immobilisations",                          accountClass: 4, accountType: "TIERS" },
  { accountNumber: "486",    name: "Débiteurs sur immobilisations",                           accountClass: 4, accountType: "TIERS" },
  { accountNumber: "491",    name: "Dépréciations des comptes clients",                       accountClass: 4, accountType: "TIERS" },

  // ── Classe 5 — Comptes de trésorerie ─────────────────────────────────────
  { accountNumber: "511",    name: "Valeurs à l'encaissement",                                accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "512",    name: "Effets à l'encaissement",                                 accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "513",    name: "Chèques à encaisser",                                     accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "513100", name: "Chèques à encaisser — compte principal",                  accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "514",    name: "Chèques à l'encaissement hors place",                     accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "515",    name: "Cartes de crédit à l'encaissement",                       accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "52",     name: "Banques",                                                 accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "521",    name: "Banques locales",                                         accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "5211",   name: "Banques locales",                                         accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "521100", name: "Banques locales — compte principal",                      accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "522",    name: "Banques étrangères",                                      accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "531",    name: "Comptes courants postaux (CCP)",                          accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "541",    name: "Trésor",                                                  accountClass: 5, accountType: "TRESORERIE" },
  // ── Classe 552 — Mobile Money (ordre alpha de code = ordre d'importance marché CI) ──
  { accountNumber: "552",    name: "Instruments de monnaie électronique",                     accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "552100", name: "Wave",                                                    accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "552200", name: "Orange Money",                                            accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "552300", name: "MTN MoMo",                                                accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "552400", name: "Moov Money",                                              accountClass: 5, accountType: "TRESORERIE" },
  // ── Caisse ───────────────────────────────────────────────────────────────
  { accountNumber: "571",    name: "Caisse",                                                  accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "571100", name: "Caisse principale",                                       accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "58",     name: "Virements de fonds",                                      accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "585",    name: "Virements de fonds — Mobile Money vers Banque",           accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "585100", name: "Virements de fonds — Mobile Money vers Banque (principal)",accountClass: 5, accountType: "TRESORERIE" },
  { accountNumber: "591",    name: "Dépréciations des valeurs mobilières de placement",       accountClass: 5, accountType: "TRESORERIE" },

  // ── Classe 6 — Comptes de charges ────────────────────────────────────────
  { accountNumber: "601",    name: "Achats de marchandises",                                  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "601100", name: "Achats de marchandises — compte principal",               accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6011",   name: "Matières premières et consommables",                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "601100", name: "Achats de marchandises — compte principal",               accountClass: 6, accountType: "CHARGE" }, // 601 & 6011 → same 6c node
  { accountNumber: "602",    name: "Achats stockés de matières et fournitures consommables",  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "603",    name: "Variations de stocks de marchandises et biens",           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "604",    name: "Achats non stockés de matières et fournitures",           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "605",    name: "Autres achats",                                           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6051",   name: "Fournitures non stockables — Carburant",                  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "605100", name: "Carburant — compte principal",                            accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6052",   name: "Fournitures non stockables — Eau, énergie",               accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "605200", name: "Eau, électricité et énergie — compte principal",          accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6053",   name: "Fournitures non stockables — Petit matériel",             accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "605300", name: "Petit matériel et outillage — compte principal",          accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6054",   name: "Fournitures de bureau",                                   accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "605400", name: "Fournitures de bureau — compte principal",                accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6055",   name: "Fournitures d'entretien",                                 accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "605500", name: "Fournitures d'entretien — compte principal",              accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6056",   name: "Emballages perdus et emballages à usage mixte",           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "608",    name: "Frais accessoires incorporés aux achats",                  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "611",    name: "Transports sur ventes",                                   accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "612",    name: "Transports pour le compte de tiers",                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "613",    name: "Transports entre établissements ou usines",               accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "614",    name: "Transports du personnel",                                 accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "614100", name: "Transports du personnel — compte principal",              accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "616",    name: "Transports sur achats et approvisionnements",             accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "616100", name: "Transports sur achats — compte principal",                accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "618",    name: "Voyages et déplacements",                                 accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "618100", name: "Voyages et déplacements — compte principal",              accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "619",    name: "Autres frais de transport",                               accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "621",    name: "Sous-traitance générale",                                 accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "621100", name: "Sous-traitance générale — compte principal",              accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "622",    name: "Locations et charges locatives",                          accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "622100", name: "Locations et charges locatives — compte principal",       accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "623",    name: "Redevances pour concessions, brevets, licences",          accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "624",    name: "Entretien, réparations et maintenance",                   accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "624100", name: "Entretien, réparations et maintenance — compte principal",accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "625",    name: "Primes d'assurance",                                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6251",   name: "Assurances",                                              accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "625100", name: "Assurances — compte principal",                           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "626",    name: "Études, recherches et documentation",                     accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6261",   name: "Études et recherches — sous-compte",                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "626100", name: "Études, recherches et documentation — compte principal",  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6271",   name: "Publicité et relations publiques",                        accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "627100", name: "Publicité et relations publiques — compte principal",     accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "628",    name: "Frais de télécommunications",                             accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6281",   name: "Frais de téléphone",                                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6282",   name: "Frais postaux et d'affranchissement",                     accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6283",   name: "Frais Internet et réseaux numériques",                   accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "628100", name: "Frais de télécommunications — compte principal",          accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "631",    name: "Frais bancaires",                                         accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "631100", name: "Frais bancaires — compte principal",                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6311",   name: "Publicité, publications et relations publiques",          accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6312",   name: "Agios et intérêts bancaires",                             accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6317",   name: "Frais sur Mobile Money / monnaie électronique",           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "631700", name: "Frais sur instruments monétaires électroniques",          accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "632",    name: "Rémunérations d'intermédiaires et honoraires",            accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6321",   name: "Honoraires",                                              accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "632100", name: "Honoraires — compte principal",                           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6322",   name: "Commissions et courtages",                                accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "633",    name: "Frais de formation du personnel",                         accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "635",    name: "Cotisations",                                             accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "637",    name: "Études et recherches",                                    accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "641",    name: "Impôts et taxes directs",                                 accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "641100", name: "Impôts et taxes directs — compte principal",              accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "642",    name: "Impôts et taxes indirects",                               accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "645",    name: "Taxes sur les salaires",                                  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "647",    name: "Pénalités et amendes fiscales et pénales",                accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "651",    name: "Pertes sur créances irrécouvrables",                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "658",    name: "Charges diverses",                                        accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "658100", name: "Charges diverses — compte principal",                     accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "661",    name: "Appointements, salaires et commissions",                  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6611",   name: "Appointements et salaires du personnel permanent",        accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "661100", name: "Appointements et salaires — compte principal",            accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "662",    name: "Indemnités forfaitaires imposables",                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "663",    name: "Indemnités forfaitaires non imposables",                  accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "664",    name: "Charges sociales",                                        accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6641",   name: "Cotisations CNPS",                                        accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "664100", name: "Charges sociales — compte principal",                     accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "665",    name: "Indemnités de préavis et de licenciement",                accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "668",    name: "Autres charges de personnel",                             accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "671",    name: "Intérêts des emprunts et dettes",                         accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6711",   name: "Intérêts des emprunts",                                   accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "673",    name: "Escomptes accordés",                                      accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "675",    name: "Pertes de change",                                        accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "676",    name: "Charges nettes sur cessions d'immobilisations",           accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "681",    name: "Dotations aux amortissements",                            accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6811",   name: "Dotations aux amortissements des charges immobilisées",   accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6812",   name: "Dotations aux amortissements — immobilisations incorporelles", accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "6813",   name: "Dotations aux amortissements — immobilisations corporelles",   accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "691",    name: "Dotations aux provisions pour risques à court terme",    accountClass: 6, accountType: "CHARGE" },
  { accountNumber: "695",    name: "Dotations aux provisions pour dépréciation des créances", accountClass: 6, accountType: "CHARGE" },

  // ── Classe 7 — Comptes de produits ───────────────────────────────────────
  { accountNumber: "701",    name: "Ventes de marchandises",                                  accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "701100", name: "Ventes de marchandises — compte principal",               accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "702",    name: "Ventes de produits finis",                                accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "702100", name: "Ventes de produits finis — compte principal",             accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "703",    name: "Ventes de produits intermédiaires et résiduels",          accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "704",    name: "Ventes de travaux",                                       accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "704100", name: "Ventes de travaux — compte principal",                    accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "705",    name: "Ventes d'études",                                         accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "706",    name: "Prestations de services",                                 accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "706100", name: "Prestations de services — compte principal",              accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "707",    name: "Produits des activités annexes",                          accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "708",    name: "Revenus des immeubles",                                   accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "708100", name: "Revenus des immeubles — compte principal",                accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "709",    name: "Rabais, remises et ristournes accordés (à déduire)",       accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "711",    name: "Subventions d'exploitation reçues",                       accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "711100", name: "Subventions d'exploitation reçues — compte principal",    accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "714",    name: "Variation des stocks de produits",                        accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "721",    name: "Production immobilisée",                                  accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "744",    name: "Revenus de valeurs mobilières",                           accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "745",    name: "Intérêts et dividendes reçus",                            accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "751",    name: "Produits de cession d'immobilisations",                   accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "752",    name: "Produits sur opérations de trésorerie",                   accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "758",    name: "Produits divers",                                         accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "758100", name: "Produits divers — compte principal",                      accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "759",    name: "Reprises de provisions",                                  accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "761",    name: "Intérêts des prêts",                                      accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "771",    name: "Intérêts des prêts",                                      accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "7711",   name: "Intérêts des prêts",                                      accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "773",    name: "Escomptes obtenus",                                       accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "775",    name: "Gains de change",                                         accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "781",    name: "Reprises d'amortissements",                               accountClass: 7, accountType: "PRODUIT" },
  { accountNumber: "791",    name: "Reprises de provisions pour risques à court terme",       accountClass: 7, accountType: "PRODUIT" },

  // ── Classe 8 — Comptes des autres charges et produits (HAO) ──────────────
  { accountNumber: "831",    name: "Charges hors activités ordinaires (HAO)",                 accountClass: 8, accountType: "HAO" },
  { accountNumber: "841",    name: "Produits hors activités ordinaires (HAO)",                accountClass: 8, accountType: "HAO" },
  { accountNumber: "851",    name: "Dotations HAO aux amortissements et provisions",          accountClass: 8, accountType: "HAO" },
  { accountNumber: "861",    name: "Reprises HAO sur amortissements et provisions",           accountClass: 8, accountType: "HAO" },
  { accountNumber: "871",    name: "Participation des travailleurs",                          accountClass: 8, accountType: "HAO" },
  { accountNumber: "891",    name: "Impôts sur le résultat",                                  accountClass: 8, accountType: "HAO" },
];

// ---------------------------------------------------------------------------
// 2. Catégories de transactions (transaction_categories)
// ---------------------------------------------------------------------------
// Tous les defaultAccountNumber sont maintenant en 6 chiffres.
// Convention : pad6(x) = x + "100" si 3c, x + "00" si 4c.

const CATEGORIES: {
  key: string;
  displayName: string;
  defaultAccountNumber: string;
  defaultTvaRate: number;
  vatEligible: boolean;
  transactionType: "depense" | "recette";
  isHidden: boolean;
}[] = [
  // ── Dépenses / Achats fournisseurs ───────────────────────────────────────
  { key: "achat_marchandises",    displayName: "Achats de marchandises",                    defaultAccountNumber: "601100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "achat_matieres",        displayName: "Matières premières / consommables",          defaultAccountNumber: "601100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "carburant",             displayName: "Carburant",                                  defaultAccountNumber: "605100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "electricite_eau",       displayName: "Eau / Électricité / Énergie",                defaultAccountNumber: "605200", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "fournitures_bureau",    displayName: "Fournitures de bureau",                      defaultAccountNumber: "605400", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "fournitures_entretien", displayName: "Produits d'entretien",                       defaultAccountNumber: "605500", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "transport_achat",       displayName: "Transport sur achats",                       defaultAccountNumber: "616100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "transport_personnel",   displayName: "Transport du personnel",                     defaultAccountNumber: "614100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "transport_deplacement", displayName: "Voyages et déplacements",                    defaultAccountNumber: "618100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "loyer",                 displayName: "Loyer / Bail",                               defaultAccountNumber: "622100", defaultTvaRate: 0,  vatEligible: false, transactionType: "depense", isHidden: false },
  { key: "entretien",             displayName: "Entretien / Réparation / Maintenance",       defaultAccountNumber: "624100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "assurance",             displayName: "Assurances",                                 defaultAccountNumber: "625100", defaultTvaRate: 0,  vatEligible: false, transactionType: "depense", isHidden: false },
  { key: "telephone_internet",    displayName: "Téléphone / Internet",                       defaultAccountNumber: "628100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "publicite",             displayName: "Publicité / Marketing",                      defaultAccountNumber: "627100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "honoraires",            displayName: "Honoraires (comptable, avocat, conseil…)",  defaultAccountNumber: "632100", defaultTvaRate: 0,  vatEligible: false, transactionType: "depense", isHidden: false },
  { key: "sous_traitance",        displayName: "Sous-traitance",                             defaultAccountNumber: "621100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "salaires",              displayName: "Salaires / Rémunérations",                   defaultAccountNumber: "661100", defaultTvaRate: 0,  vatEligible: false, transactionType: "depense", isHidden: false },
  { key: "charges_sociales",      displayName: "Charges sociales (CNPS, CFCE…)",             defaultAccountNumber: "664100", defaultTvaRate: 0,  vatEligible: false, transactionType: "depense", isHidden: false },
  { key: "impots_taxes",          displayName: "Impôts et taxes",                            defaultAccountNumber: "641100", defaultTvaRate: 0,  vatEligible: false, transactionType: "depense", isHidden: false },
  { key: "frais_bancaires",       displayName: "Frais bancaires et financiers",              defaultAccountNumber: "631100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },
  { key: "autres_achats",         displayName: "Autres achats / charges diverses",           defaultAccountNumber: "658100", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: false },

  // ── Recettes / Produits ──────────────────────────────────────────────────
  { key: "vente_marchandises",    displayName: "Vente de marchandises",                      defaultAccountNumber: "701100", defaultTvaRate: 18, vatEligible: true,  transactionType: "recette", isHidden: false },
  { key: "vente_produits_finis",  displayName: "Vente de produits finis",                    defaultAccountNumber: "702100", defaultTvaRate: 18, vatEligible: true,  transactionType: "recette", isHidden: false },
  { key: "prestation_services",   displayName: "Prestation de services",                     defaultAccountNumber: "706100", defaultTvaRate: 18, vatEligible: true,  transactionType: "recette", isHidden: false },
  { key: "vente_travaux",         displayName: "Vente de travaux / chantiers",               defaultAccountNumber: "704100", defaultTvaRate: 18, vatEligible: true,  transactionType: "recette", isHidden: false },
  { key: "loyer_recette",         displayName: "Revenus locatifs",                           defaultAccountNumber: "708100", defaultTvaRate: 0,  vatEligible: false, transactionType: "recette", isHidden: false },
  { key: "subvention",            displayName: "Subvention d'exploitation",                  defaultAccountNumber: "711100", defaultTvaRate: 0,  vatEligible: false, transactionType: "recette", isHidden: false },
  { key: "autres_recettes",       displayName: "Autres recettes / produits divers",          defaultAccountNumber: "758100", defaultTvaRate: 0,  vatEligible: false, transactionType: "recette", isHidden: false },

  // ── Catégories système (hidden — générées automatiquement) ────────────────
  { key: "vente_carburant",       displayName: "Vente de carburant",                         defaultAccountNumber: "701100", defaultTvaRate: 18, vatEligible: true,  transactionType: "recette", isHidden: true },
  { key: "frais_mobile_money",    displayName: "Frais sur instruments monétaires électroniques", defaultAccountNumber: "631700", defaultTvaRate: 18, vatEligible: true,  transactionType: "depense", isHidden: true },
  { key: "ecart_caisse_gain",     displayName: "Écart de caisse (excédent)",                 defaultAccountNumber: "758100", defaultTvaRate: 0,  vatEligible: false, transactionType: "recette", isHidden: true },
  { key: "ecart_caisse_perte",    displayName: "Écart de caisse (manquant)",                 defaultAccountNumber: "658100", defaultTvaRate: 0,  vatEligible: false, transactionType: "depense", isHidden: true },
];

// ---------------------------------------------------------------------------
// Fonctions de seed exportées
// ---------------------------------------------------------------------------

export async function seedPlanComptable() {
  let upserted = 0;
  // Deduplicate on accountNumber in case the array has intentional dups
  const seen = new Set<string>();
  for (const compte of COMPTES) {
    if (seen.has(compte.accountNumber)) continue;
    seen.add(compte.accountNumber);
    await db
      .insert(accountsTable)
      .values(compte)
      .onConflictDoUpdate({
        target: accountsTable.accountNumber,
        set: {
          name:         compte.name,
          accountClass: compte.accountClass,
          accountType:  compte.accountType,
        },
      });
    upserted++;
  }
  console.log(`✓ Plan comptable SYSCOHADA : ${upserted} comptes upsertés.`);
}

export async function seedTransactionCategories() {
  let upserted = 0;
  for (const cat of CATEGORIES) {
    await db
      .insert(transactionCategoriesTable)
      .values(cat)
      .onConflictDoUpdate({
        target: transactionCategoriesTable.key,
        set: {
          displayName:          cat.displayName,
          defaultAccountNumber: cat.defaultAccountNumber,
          defaultTvaRate:       cat.defaultTvaRate,
          vatEligible:          cat.vatEligible,
          transactionType:      cat.transactionType,
          isHidden:             cat.isHidden,
          updatedAt:            sql`now()`,
        },
      });
    upserted++;
  }
  console.log(`✓ Catégories de transactions : ${upserted} entrées upsertées.`);
}

// Exécution autonome : tsx lib/db/src/seed-syscohada.ts
async function main() {
  await seedPlanComptable();
  await seedTransactionCategories();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed SYSCOHADA échoué :", err);
  process.exit(1);
});
