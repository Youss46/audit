import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";
import { rolesTable } from "./roles";

// RBAC roles for module M9 (Administration & Auth).
//
// "client_staff" (module M29): a PME employee account created by the
// company's own "client_pme" owner, restricted to a subset of the Espace
// PME by its `roleId` (see ./roles.ts). Unlike "client_pme" -- which always
// has unrestricted access to its one client dossier -- a "client_staff"
// account's effective permissions come entirely from the referenced role.
export const USER_ROLES = [
  "expert_comptable",
  "collaborateur",
  "stagiaire",
  "client_pme",
  "client_staff",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

// Roles/accounts that represent "the PME itself" (as opposed to cabinet
// staff): scoped to exactly one client dossier via `clientId`, and the
// portal-facing UI. Exported so route handlers and the auth middleware
// treat the owner and its staff identically for ownership scoping.
export const PORTAL_ROLES = ["client_pme", "client_staff"] as const;
export function isPortalRole(role: UserRole): boolean {
  return (PORTAL_ROLES as readonly UserRole[]).includes(role);
}

export const USER_STATUSES = ["active", "invited", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    // Set for "client_pme" and "client_staff": scopes an Espace PME portal
    // account to a single client dossier so it can never see another
    // client's missions/documents within the same firm. For "client_staff"
    // this also doubles as the "company_id" the module M29 spec describes
    // -- the staff member's employer is simply the client dossier they
    // share with the owning "client_pme" account, not a separate concept.
    clientId: integer("client_id").references(() => clientsTable.id, {
      onDelete: "cascade",
    }),
    // Module M29: only set (and required) for "client_staff" accounts.
    // Determines the account's permissions -- see ./roles.ts.
    roleId: integer("role_id").references(() => rolesTable.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: text("role").notNull().$type<UserRole>(),
    status: text("status").notNull().$type<UserStatus>().default("active"),
    // Module M33 (Réinitialisation Forcée du Mot de Passe Temporaire): true
    // for every account created by an admin (cabinet "/users" or PME
    // "/staff") with a system-generated temporary password. Login then
    // returns a restricted token instead of a normal session until the
    // account calls POST /auth/reset-first-password. False for
    // self-registered "expert_comptable" owners, who chose their own
    // password at /auth/register.
    requiresPasswordChange: boolean("requires_password_change")
      .notNull()
      .default(true),
    // Module M33: the plaintext of the auto-generated temporary password,
    // kept only so the creating admin can re-display it if needed before
    // the account's first login. Cleared (set to null) the moment
    // requiresPasswordChange flips to false -- never retained after that.
    temporaryPasswordPlain: text("temporary_password_plain"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("users_email_unique").on(table.email),
    index("users_firm_id_idx").on(table.firmId),
    index("users_role_id_idx").on(table.roleId),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
