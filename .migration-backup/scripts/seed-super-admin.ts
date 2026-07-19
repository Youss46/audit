#!/usr/bin/env tsx
/**
 * seed-super-admin.ts
 *
 * Creates the platform "SYSTÈME" firm and the first super_admin account.
 * Run once after a fresh database setup:
 *
 *   pnpm -w tsx scripts/seed-super-admin.ts
 *
 * The script is idempotent — it exits early if a super_admin account already
 * exists.  Change the credentials in the admin console after first login.
 */

import { db, firmsTable, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const SYSTEM_FIRM_NAME = "SYSTÈME M15-AUDIT";
const SUPER_ADMIN_EMAIL = "admin@m15-audit.ci";
const SUPER_ADMIN_FULLNAME = "Super Administrateur";
// Must match PASSWORD_POLICY_REGEX: 8+ chars, one digit, one special char
const DEFAULT_PASSWORD = "Admin@M15!2026";

async function main() {
  console.log("🔧 Vérification de l'existence d'un super_admin...");

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.role, "super_admin"),
  });

  if (existing) {
    console.log(`✅ Super admin déjà présent: ${existing.email}`);
    console.log("   Aucune action nécessaire.");
    process.exit(0);
  }

  console.log("🏢 Création du cabinet système...");
  let systemFirm = await db.query.firmsTable.findFirst({
    where: eq(firmsTable.name, SYSTEM_FIRM_NAME),
  });

  if (!systemFirm) {
    [systemFirm] = await db
      .insert(firmsTable)
      .values({
        name: SYSTEM_FIRM_NAME,
        status: "active",
        subscriptionTier: "enterprise",
        maxPmeAllowed: 999,
        contactEmail: SUPER_ADMIN_EMAIL,
        contactName: SUPER_ADMIN_FULLNAME,
      })
      .returning();
    console.log(`   Cabinet créé (id=${systemFirm.id})`);
  } else {
    console.log(`   Cabinet existant (id=${systemFirm.id})`);
  }

  console.log("👤 Création du compte super_admin...");
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const [adminUser] = await db
    .insert(usersTable)
    .values({
      firmId: systemFirm.id,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      fullName: SUPER_ADMIN_FULLNAME,
      role: "super_admin",
      status: "active",
      requiresPasswordChange: false,
    })
    .returning();

  console.log("\n✅ Super admin créé avec succès !");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   URL Console  : /m15-admin/`);
  console.log(`   Email        : ${adminUser.email}`);
  console.log(`   Mot de passe : ${DEFAULT_PASSWORD}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⚠️  Changez ce mot de passe dès la première connexion !");

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erreur lors de la création du super admin :", err);
  process.exit(1);
});
