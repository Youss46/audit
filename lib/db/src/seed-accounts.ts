import { db, accountsTable } from "./index";

// Seeds a basic SYSCOHADA "plan comptable" (chart of accounts) covering
// classes 1 to 9, plus the specific accounts referenced by the module
// P3/M3 automated matching engine (artifacts/api-server/src/lib/accounting-engine.ts).
// Safe to re-run: uses upsert on the unique account number.
const SYSCOHADA_ACCOUNTS: { accountNumber: string; name: string; accountClass: number }[] = [
  // Classe 1 - Comptes de ressources durables
  { accountNumber: "101", name: "Capital social", accountClass: 1 },
  { accountNumber: "106", name: "Réserves", accountClass: 1 },
  { accountNumber: "120", name: "Résultat net de l'exercice", accountClass: 1 },
  { accountNumber: "162", name: "Emprunts auprès des établissements de crédit", accountClass: 1 },
  // Module M18 (Immobilisations Financières & Emprunts).
  { accountNumber: "161", name: "Emprunts auprès des établissements de crédit", accountClass: 1 },

  // Classe 2 - Comptes d'actif immobilisé
  { accountNumber: "211", name: "Frais de développement", accountClass: 2 },
  { accountNumber: "231", name: "Bâtiments", accountClass: 2 },
  { accountNumber: "244", name: "Matériel et mobilier", accountClass: 2 },
  { accountNumber: "245", name: "Matériel de transport", accountClass: 2 },
  // Module M18 (Immobilisations Financières & Emprunts).
  { accountNumber: "274", name: "Prêts au personnel", accountClass: 2 },
  { accountNumber: "275", name: "Dépôts et cautionnements versés", accountClass: 2 },

  // Classe 3 - Comptes de stocks
  { accountNumber: "311", name: "Marchandises", accountClass: 3 },
  { accountNumber: "321", name: "Matières premières", accountClass: 3 },
  { accountNumber: "355", name: "Produits finis", accountClass: 3 },

  // Classe 4 - Comptes de tiers
  { accountNumber: "401", name: "Fournisseurs", accountClass: 4 },
  { accountNumber: "4011", name: "Fournisseurs", accountClass: 4 },
  { accountNumber: "411", name: "Clients", accountClass: 4 },
  { accountNumber: "4111", name: "Clients", accountClass: 4 },
  { accountNumber: "421", name: "Personnel, avances et acomptes", accountClass: 4 },
  { accountNumber: "444", name: "État, impôts sur les bénéfices", accountClass: 4 },
  { accountNumber: "445", name: "État, TVA", accountClass: 4 },

  // Classe 5 - Comptes de trésorerie
  { accountNumber: "52", name: "Banques", accountClass: 5 },
  { accountNumber: "571", name: "Caisse", accountClass: 5 },
  // Module P6 (Un Pompiste = Une Caisse): master/collective account for a
  // STATION_SERVICE client's per-pompiste sub-accounts (571101, 571102...).
  // Purely a chart-of-accounts placeholder -- actual cash movements are
  // always posted to a pompiste's own sub-account, never to this one.
  { accountNumber: "571100", name: "Caisse Pompistes (compte collectif)", accountClass: 5 },
  { accountNumber: "58", name: "Virements de fonds", accountClass: 5 },
  // Classe 55 - Instruments de monnaie électronique (Mobile Money).
  // Added automatically for clients with a STATION_SERVICE profile.
  // 552100 Orange Money, 552200 Wave, 552300 MTN MoMo, 552400 Moov Money.
  { accountNumber: "552", name: "Instruments de monnaie électronique", accountClass: 5 },
  { accountNumber: "552100", name: "Orange Money", accountClass: 5 },
  { accountNumber: "552200", name: "Wave", accountClass: 5 },
  { accountNumber: "552300", name: "MTN MoMo", accountClass: 5 },
  { accountNumber: "552400", name: "Moov Money", accountClass: 5 },

  // Classe 6 - Comptes de charges
  { accountNumber: "601", name: "Achats de marchandises", accountClass: 6 },
  // Module P7 Mobile Money: frais de retrait / virement vers banque.
  { accountNumber: "631700", name: "Frais sur instruments monétaires électroniques", accountClass: 6 },
  { accountNumber: "6051", name: "Fournitures non stockables - Carburant", accountClass: 6 },
  { accountNumber: "6052", name: "Fournitures non stockables - Eau, électricité", accountClass: 6 },
  { accountNumber: "6054", name: "Fournitures de bureau", accountClass: 6 },
  { accountNumber: "614", name: "Transports du personnel", accountClass: 6 },
  { accountNumber: "618", name: "Voyages et déplacements", accountClass: 6 },
  { accountNumber: "622", name: "Locations et charges locatives", accountClass: 6 },
  { accountNumber: "624", name: "Entretien, réparations et maintenance", accountClass: 6 },
  { accountNumber: "628", name: "Autres charges externes", accountClass: 6 },
  { accountNumber: "658", name: "Charges diverses", accountClass: 6 },
  { accountNumber: "661", name: "Appointements, salaires et commissions", accountClass: 6 },
  { accountNumber: "681", name: "Dotations aux amortissements", accountClass: 6 },
  // Module M17 (Immobilisations & Amortissements) — dotation sub-accounts,
  // SYSCOHADA révisé nomenclature.
  { accountNumber: "6811", name: "Dotations aux amortissements des charges immobilisées", accountClass: 6 },
  { accountNumber: "6812", name: "Dotations aux amortissements des immobilisations incorporelles", accountClass: 6 },
  { accountNumber: "6813", name: "Dotations aux amortissements des immobilisations corporelles", accountClass: 6 },
  // Module M18 (Immobilisations Financières & Emprunts).
  { accountNumber: "671", name: "Intérêts des emprunts", accountClass: 6 },

  // Classe 7 - Comptes de produits
  { accountNumber: "701", name: "Ventes de marchandises", accountClass: 7 },
  { accountNumber: "706", name: "Services vendus", accountClass: 7 },
  { accountNumber: "758", name: "Produits divers", accountClass: 7 },
  { accountNumber: "781", name: "Reprises d'amortissements", accountClass: 7 },
  // Module M18 (Immobilisations Financières & Emprunts).
  { accountNumber: "771", name: "Intérêts des prêts", accountClass: 7 },

  // Classe 8 - Comptes des autres charges et produits
  { accountNumber: "831", name: "Charges HAO", accountClass: 8 },
  { accountNumber: "841", name: "Produits HAO", accountClass: 8 },

  // Classe 9 - Comptes analytiques et engagements hors bilan
  { accountNumber: "901", name: "Engagements donnés", accountClass: 9 },
  { accountNumber: "902", name: "Engagements reçus", accountClass: 9 },
];

async function main() {
  for (const account of SYSCOHADA_ACCOUNTS) {
    await db
      .insert(accountsTable)
      .values(account)
      .onConflictDoUpdate({
        target: accountsTable.accountNumber,
        set: { name: account.name, accountClass: account.accountClass },
      });
  }
  console.log(`Seeded ${SYSCOHADA_ACCOUNTS.length} SYSCOHADA accounts.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
