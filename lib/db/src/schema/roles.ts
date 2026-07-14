import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Module M29 (RBAC & Gestion du Personnel PME).
//
// A PME (corporate client) can create staff accounts ("collaborateurs")
// scoped to its own dossier, each bound to one of these roles. Permissions
// are a flat list of feature keys (e.g. "facturation.create") checked by
// requirePermission() (see artifacts/api-server/src/middlewares/auth.ts).
//
// Roles are a system-wide seeded catalog (see ../seed-roles.ts), not
// per-firm-customizable in this MVP -- every PME across every firm picks
// from the same 4 roles. Kept as a real DB table (not a hardcoded enum) so
// permissions are inspectable/adjustable by re-running the seed, without a
// schema migration, per the module's "static or dynamic table" requirement.
export const PERMISSION_KEYS = [
  // Espace PME dashboard (module P2).
  "dashboard.view",
  // Mes Opérations -- simplified accounting entry (module P3).
  "operations.view",
  "operations.create",
  // Caisse Terrain -- physical cash register (module P5).
  "caisse.view",
  "caisse.create",
  // Pilotage -- BI dashboard / financial reports (module P4).
  "pilotage.view",
  // Mon Facturier -- client invoicing (module M28).
  "facturation.view",
  "facturation.create",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// Fixed set of system role codes seeded by ../seed-roles.ts. New staff
// accounts always reference one of these by roleId.
export const SYSTEM_ROLE_CODES = [
  "ADMIN",
  "COMMERCIAL",
  "POMPISTE",
  "COMPTABLE_INTERNE",
] as const;
export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export const rolesTable = pgTable(
  "roles",
  {
    id: serial("id").primaryKey(),
    // Stable machine key (e.g. "POMPISTE"), used in code and by the seed
    // script's upsert. Distinct from `label`, which is the French display
    // name shown in the "Ajouter un collaborateur" dropdown.
    code: text("code").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    // Flat list of PERMISSION_KEYS this role grants. Checked with an
    // "any of the required keys" match by requirePermission().
    permissions: jsonb("permissions").notNull().$type<string[]>().default([]),
    // Seeded system roles cannot be deleted from the UI (there is no
    // per-firm role editor in this MVP -- see module comment above).
    isSystem: boolean("is_system").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("roles_code_unique").on(table.code),
    index("roles_code_idx").on(table.code),
  ],
);

export const insertRoleSchema = createInsertSchema(rolesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;
