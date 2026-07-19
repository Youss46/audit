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
import { stationsTable } from "./stations";

// RBAC roles for module M9 (Administration & Auth).
//
// "super_admin": platform-level administrator. Belongs to the special system
// firm. Has cross-tenant access to ALL firms and clients. Can only be created
// via the seed:super-admin script. Must never access normal cabinet routes
// and normal cabinet roles must never access /api/admin/* routes.
//
// "client_staff" (module M29): a PME employee account created by the
// company's own "client_pme" owner, restricted to a subset of the Espace
// PME by its `roleId` (see ./roles.ts).
export const USER_ROLES = [
  "super_admin",
  "expert_comptable",
  "collaborateur",
  "stagiaire",
  "client_pme",
  "client_staff",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

// Roles that represent "the PME itself": scoped to one client dossier.
// super_admin is explicitly excluded from this — it must never be treated
// as a portal role.
export const PORTAL_ROLES = ["client_pme", "client_staff"] as const;
export function isPortalRole(role: UserRole): boolean {
  return (PORTAL_ROLES as readonly UserRole[]).includes(role);
}

// Returns true for the platform super-administrator account.
export function isSuperAdmin(role: UserRole): boolean {
  return role === "super_admin";
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
    // Multi-station (P8): for POMPISTE and other site-level staff roles,
    // the station they are assigned to. Null for client_pme owners and
    // cabinet staff, who have cross-station access. Embedded in the JWT at
    // login so every request can be scoped without an extra DB lookup.
    stationId: integer("station_id").references(() => stationsTable.id, {
      onDelete: "set null",
    }),
    // Module P6 (Un Pompiste = Une Caisse): denormalized copy of the
    // personal SYSCOHADA cash sub-account (e.g. "571101") auto-assigned when
    // this account is created as a POMPISTE for a STATION_SERVICE client.
    // The authoritative link is cashRegistersTable.ownerUserId -- this
    // column only exists so the account number can be displayed (staff
    // list, payslip-style summaries) without an extra join. Null for every
    // other account.
    associatedCashAccountNumber: text("associated_cash_account_number"),
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
