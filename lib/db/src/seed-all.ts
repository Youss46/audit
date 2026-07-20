/**
 * seed-all.ts — Script maître de bootstrap de la base de données.
 *
 * Exécuté automatiquement par Railway après chaque déploiement (releaseCommand).
 * Tous les seeds sont idempotents : ils utilisent onConflictDoUpdate et peuvent
 * être relancés sans risque de doublons ou d'erreurs.
 *
 * Ordre d'exécution :
 *   1. Rôles PME (référentiel RBAC)
 *   2. Plan comptable SYSCOHADA (comptes de base)
 *   3. Mappings DSF (déclaration fiscale)
 *   4. Paramètres de paie (ITS, CN, CNPS)
 *   5. Modèles de documents de rapport
 */

import { db, rolesTable, accountsTable } from "./index";
import { sql } from "drizzle-orm";

// ─── 1. Rôles PME ────────────────────────────────────────────────────────────

const ROLES: { code: string; label: string; description: string; permissions: string[] }[] = [
  {
    code: "ADMIN",
    label: "Administrateur",
    description:
      "Accès complet à l'Espace PME (opérations, caisse, pilotage, facturation), à l'exception de la gestion du personnel qui reste réservée au titulaire du compte.",
    permissions: [
      "dashboard.view", "operations.view", "operations.create",
      "caisse.view", "caisse.create", "pilotage.view",
      "facturation.view", "facturation.create",
    ],
  },
  {
    code: "COMMERCIAL",
    label: "Commercial",
    description: "Suivi des opérations commerciales et facturation client.",
    permissions: [
      "dashboard.view", "operations.view", "operations.create",
      "facturation.view", "facturation.create",
    ],
  },
  {
    code: "AGENT_TERRAIN",
    label: "Agent de terrain",
    description:
      "Saisie des mouvements de caisse et facturation terrain — aucun accès aux rapports financiers ni aux paramètres du compte.",
    permissions: ["caisse.view", "caisse.create", "facturation.view", "facturation.create"],
  },
  {
    code: "POMPISTE",
    label: "Pompiste",
    description:
      "Saisie des relevés d'index de pompe et des ventes de carburant. Rôle réservé aux entreprises du secteur Station-service.",
    permissions: ["caisse.view", "caisse.create", "facturation.view", "facturation.create"],
  },
  {
    code: "COMPTABLE_INTERNE",
    label: "Comptable Interne",
    description:
      "Accès étendu aux opérations, à la caisse et au pilotage financier pour la tenue comptable quotidienne.",
    permissions: [
      "dashboard.view", "operations.view", "operations.create",
      "caisse.view", "caisse.create", "pilotage.view",
      "facturation.view", "facturation.create",
    ],
  },
];

async function seedRoles() {
  for (const role of ROLES) {
    await db
      .insert(rolesTable)
      .values({ ...role, isSystem: true })
      .onConflictDoUpdate({
        target: [rolesTable.code],
        set: { label: role.label, description: role.description, permissions: role.permissions, updatedAt: sql`now()` },
      });
  }
  console.log(`✓ Rôles : ${ROLES.length} upsertés.`);
}

// ─── 2. Plan comptable SYSCOHADA ──────────────────────────────────────────────

const SYSCOHADA_ACCOUNTS: { accountNumber: string; name: string; accountClass: number }[] = [
  { accountNumber: "101", name: "Capital social", accountClass: 1 },
  { accountNumber: "1013", name: "Capital souscrit, appelé, versé, non amorti", accountClass: 1 },
  { accountNumber: "106", name: "Réserves", accountClass: 1 },
  { accountNumber: "120", name: "Résultat net de l'exercice", accountClass: 1 },
  { accountNumber: "1301", name: "Résultat net de l'exercice (bénéfice)", accountClass: 1 },
  { accountNumber: "1309", name: "Résultat net de l'exercice (perte)", accountClass: 1 },
  { accountNumber: "162", name: "Emprunts auprès des établissements de crédit", accountClass: 1 },
  { accountNumber: "161", name: "Emprunts auprès des établissements de crédit", accountClass: 1 },
  { accountNumber: "211", name: "Frais de développement", accountClass: 2 },
  { accountNumber: "231", name: "Bâtiments", accountClass: 2 },
  { accountNumber: "244", name: "Matériel et mobilier", accountClass: 2 },
  { accountNumber: "245", name: "Matériel de transport", accountClass: 2 },
  { accountNumber: "274", name: "Prêts au personnel", accountClass: 2 },
  { accountNumber: "275", name: "Dépôts et cautionnements versés", accountClass: 2 },
  { accountNumber: "311", name: "Marchandises", accountClass: 3 },
  { accountNumber: "321", name: "Matières premières", accountClass: 3 },
  { accountNumber: "355", name: "Produits finis", accountClass: 3 },
  { accountNumber: "401", name: "Fournisseurs", accountClass: 4 },
  { accountNumber: "4011", name: "Fournisseurs", accountClass: 4 },
  { accountNumber: "411", name: "Clients", accountClass: 4 },
  { accountNumber: "4111", name: "Clients", accountClass: 4 },
  { accountNumber: "421", name: "Personnel, avances et acomptes", accountClass: 4 },
  { accountNumber: "444", name: "État, impôts sur les bénéfices", accountClass: 4 },
  { accountNumber: "445", name: "État, TVA", accountClass: 4 },
  { accountNumber: "4451", name: "TVA récupérable sur achats", accountClass: 4 },
  { accountNumber: "4613", name: "Associés, capital souscrit — appelé, non versé", accountClass: 4 },
  { accountNumber: "52", name: "Banques", accountClass: 5 },
  { accountNumber: "521", name: "Banques locales", accountClass: 5 },
  { accountNumber: "5211", name: "Banques locales", accountClass: 5 },
  { accountNumber: "571", name: "Caisse", accountClass: 5 },
  { accountNumber: "571100", name: "Caisse Pompistes (compte collectif)", accountClass: 5 },
  { accountNumber: "58", name: "Virements de fonds", accountClass: 5 },
  { accountNumber: "585", name: "Virements de fonds — Mobile Money vers Banque", accountClass: 5 },
  { accountNumber: "552", name: "Instruments de monnaie électronique", accountClass: 5 },
  { accountNumber: "552100", name: "Orange Money", accountClass: 5 },
  { accountNumber: "552200", name: "Wave", accountClass: 5 },
  { accountNumber: "552300", name: "MTN MoMo", accountClass: 5 },
  { accountNumber: "552400", name: "Moov Money", accountClass: 5 },
  { accountNumber: "601", name: "Achats de marchandises", accountClass: 6 },
  { accountNumber: "6011", name: "Matières premières et consommables", accountClass: 6 },
  { accountNumber: "6051", name: "Fournitures non stockables - Carburant", accountClass: 6 },
  { accountNumber: "6052", name: "Fournitures non stockables - Eau, électricité", accountClass: 6 },
  { accountNumber: "6054", name: "Fournitures de bureau", accountClass: 6 },
  { accountNumber: "6055", name: "Fournitures d'entretien", accountClass: 6 },
  { accountNumber: "614", name: "Transports du personnel", accountClass: 6 },
  { accountNumber: "616", name: "Transports sur achats et approvisionnements", accountClass: 6 },
  { accountNumber: "618", name: "Voyages et déplacements", accountClass: 6 },
  { accountNumber: "622", name: "Locations et charges locatives", accountClass: 6 },
  { accountNumber: "624", name: "Entretien, réparations et maintenance", accountClass: 6 },
  { accountNumber: "6251", name: "Assurances", accountClass: 6 },
  { accountNumber: "6261", name: "Frais de télécommunications", accountClass: 6 },
  { accountNumber: "6311", name: "Publicité, publications et relations publiques", accountClass: 6 },
  { accountNumber: "6321", name: "Honoraires", accountClass: 6 },
  { accountNumber: "628", name: "Autres charges externes", accountClass: 6 },
  { accountNumber: "631700", name: "Frais sur instruments monétaires électroniques", accountClass: 6 },
  { accountNumber: "658", name: "Charges diverses", accountClass: 6 },
  { accountNumber: "661", name: "Appointements, salaires et commissions", accountClass: 6 },
  { accountNumber: "664", name: "Charges sociales", accountClass: 6 },
  { accountNumber: "671", name: "Intérêts des emprunts", accountClass: 6 },
  { accountNumber: "6711", name: "Intérêts des emprunts", accountClass: 6 },
  { accountNumber: "681", name: "Dotations aux amortissements", accountClass: 6 },
  { accountNumber: "6811", name: "Dotations aux amortissements des charges immobilisées", accountClass: 6 },
  { accountNumber: "6812", name: "Dotations aux amortissements des immobilisations incorporelles", accountClass: 6 },
  { accountNumber: "6813", name: "Dotations aux amortissements des immobilisations corporelles", accountClass: 6 },
  { accountNumber: "701", name: "Ventes de marchandises", accountClass: 7 },
  { accountNumber: "706", name: "Services vendus", accountClass: 7 },
  { accountNumber: "758", name: "Produits divers", accountClass: 7 },
  { accountNumber: "771", name: "Intérêts des prêts", accountClass: 7 },
  { accountNumber: "7711", name: "Intérêts des prêts", accountClass: 7 },
  { accountNumber: "781", name: "Reprises d'amortissements", accountClass: 7 },
  { accountNumber: "831", name: "Charges HAO", accountClass: 8 },
  { accountNumber: "841", name: "Produits HAO", accountClass: 8 },
  { accountNumber: "901", name: "Engagements donnés", accountClass: 9 },
  { accountNumber: "902", name: "Engagements reçus", accountClass: 9 },
];

async function seedAccounts() {
  for (const account of SYSCOHADA_ACCOUNTS) {
    await db
      .insert(accountsTable)
      .values(account)
      .onConflictDoUpdate({
        target: accountsTable.accountNumber,
        set: { name: account.name, accountClass: account.accountClass },
      });
  }
  console.log(`✓ Plan comptable : ${SYSCOHADA_ACCOUNTS.length} comptes upsertés.`);
}

// ─── 3–6. Seeds délégués aux fichiers existants ───────────────────────────────
import { seed as seedDsf } from "./seed-dsf-mapping-rules";
import { seed as seedPayroll } from "./seed-payroll-settings";
import { seed as seedTemplates } from "./seed-report-document-templates";
import { seedPlanComptable, seedTransactionCategories } from "./seed-syscohada";

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚀 Bootstrap de la base de données M15-AUDIT\n");

  await seedRoles();

  // Plan comptable SYSCOHADA complet (classes 1–8 + accountType) + catégories
  await seedPlanComptable();
  await seedTransactionCategories();

  // Seed de base (ancienne version — conservé pour rétrocompatibilité)
  await seedAccounts();

  await seedDsf();
  console.log("✓ Mappings DSF : terminé.");

  await seedPayroll();
  console.log("✓ Paramètres paie : terminé.");

  await seedTemplates();
  console.log("✓ Modèles de documents : terminé.");

  console.log("\n✅ Bootstrap terminé.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Bootstrap échoué :", err);
    process.exit(1);
  });
