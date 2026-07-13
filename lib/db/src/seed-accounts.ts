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

  // Classe 2 - Comptes d'actif immobilisé
  { accountNumber: "211", name: "Frais de développement", accountClass: 2 },
  { accountNumber: "231", name: "Bâtiments", accountClass: 2 },
  { accountNumber: "244", name: "Matériel et mobilier", accountClass: 2 },
  { accountNumber: "245", name: "Matériel de transport", accountClass: 2 },

  // Classe 3 - Comptes de stocks
  { accountNumber: "311", name: "Marchandises", accountClass: 3 },
  { accountNumber: "321", name: "Matières premières", accountClass: 3 },
  { accountNumber: "355", name: "Produits finis", accountClass: 3 },

  // Classe 4 - Comptes de tiers
  { accountNumber: "401", name: "Fournisseurs", accountClass: 4 },
  { accountNumber: "411", name: "Clients", accountClass: 4 },
  { accountNumber: "421", name: "Personnel, avances et acomptes", accountClass: 4 },
  { accountNumber: "444", name: "État, impôts sur les bénéfices", accountClass: 4 },
  { accountNumber: "445", name: "État, TVA", accountClass: 4 },

  // Classe 5 - Comptes de trésorerie
  { accountNumber: "52", name: "Banques", accountClass: 5 },
  { accountNumber: "57", name: "Caisse", accountClass: 5 },
  { accountNumber: "58", name: "Virements de fonds", accountClass: 5 },

  // Classe 6 - Comptes de charges
  { accountNumber: "601", name: "Achats de marchandises", accountClass: 6 },
  { accountNumber: "6051", name: "Fournitures non stockables - Carburant", accountClass: 6 },
  { accountNumber: "6052", name: "Fournitures non stockables - Eau, électricité", accountClass: 6 },
  { accountNumber: "6054", name: "Fournitures de bureau", accountClass: 6 },
  { accountNumber: "614", name: "Transports du personnel", accountClass: 6 },
  { accountNumber: "622", name: "Locations et charges locatives", accountClass: 6 },
  { accountNumber: "624", name: "Entretien, réparations et maintenance", accountClass: 6 },
  { accountNumber: "628", name: "Autres charges externes", accountClass: 6 },
  { accountNumber: "661", name: "Appointements, salaires et commissions", accountClass: 6 },
  { accountNumber: "681", name: "Dotations aux amortissements", accountClass: 6 },

  // Classe 7 - Comptes de produits
  { accountNumber: "701", name: "Ventes de marchandises", accountClass: 7 },
  { accountNumber: "706", name: "Services vendus", accountClass: 7 },
  { accountNumber: "758", name: "Produits divers", accountClass: 7 },
  { accountNumber: "781", name: "Reprises d'amortissements", accountClass: 7 },

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
