import {
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

// RBAC roles for module M9 (Administration & Auth).
export const USER_ROLES = [
  "expert_comptable",
  "collaborateur",
  "stagiaire",
  "client_pme",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "invited", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: text("role").notNull().$type<UserRole>(),
    status: text("status").notNull().$type<UserStatus>().default("active"),
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
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
