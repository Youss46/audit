import { db, rolesTable } from "./index";
import { sql } from "drizzle-orm";

// Seeds the Module M29 (RBAC & Gestion du Personnel PME) system role
// catalog consumed by the "Ajouter un collaborateur" dropdown and by
// requirePermission() (artifacts/api-server/src/middlewares/auth.ts).
// Safe to re-run: upserts on `code`.
const ROLES: {
  code: string;
  label: string;
  description: string;
  permissions: string[];
}[] = [
  {
    code: "ADMIN",
    label: "Administrateur",
    description:
      "Accès complet à l'Espace PME (opérations, caisse, pilotage, facturation), à l'exception de la gestion du personnel qui reste réservée au titulaire du compte.",
    permissions: [
      "dashboard.view",
      "operations.view",
      "operations.create",
      "caisse.view",
      "caisse.create",
      "pilotage.view",
      "facturation.view",
      "facturation.create",
    ],
  },
  {
    code: "COMMERCIAL",
    label: "Commercial",
    description: "Suivi des opérations commerciales et facturation client.",
    permissions: [
      "dashboard.view",
      "operations.view",
      "operations.create",
      "facturation.view",
      "facturation.create",
    ],
  },
  {
    code: "POMPISTE",
    label: "Agent Terrain / Pompiste",
    description:
      "Saisie des ventes uniquement -- aucun accès aux rapports financiers, à la caisse globale ou aux paramètres du compte.",
    permissions: ["dashboard.view", "facturation.view", "facturation.create"],
  },
  {
    code: "COMPTABLE_INTERNE",
    label: "Comptable Interne",
    description:
      "Accès étendu aux opérations, à la caisse et au pilotage financier pour la tenue comptable quotidienne de l'entreprise.",
    permissions: [
      "dashboard.view",
      "operations.view",
      "operations.create",
      "caisse.view",
      "caisse.create",
      "pilotage.view",
      "facturation.view",
      "facturation.create",
    ],
  },
];

async function main() {
  for (const role of ROLES) {
    await db
      .insert(rolesTable)
      .values({ ...role, isSystem: true })
      .onConflictDoUpdate({
        target: [rolesTable.code],
        set: {
          label: role.label,
          description: role.description,
          permissions: role.permissions,
          updatedAt: sql`now()`,
        },
      });
  }
  console.log(`Seeded ${ROLES.length} PME staff roles.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
