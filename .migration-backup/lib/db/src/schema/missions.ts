import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";
import { usersTable } from "./users";
import type { AccountingSystem, MissionStatusValue } from "./clients";

// A mission is one fiscal-year visa engagement for a client (module M4/P2).
export const missionsTable = pgTable(
  "missions",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    accountingSystem: text("accounting_system")
      .notNull()
      .$type<AccountingSystem>(),
    status: text("status")
      .notNull()
      .$type<MissionStatusValue>()
      .default("en_attente"),
    // Mock digital visa stamp (module M4/P2): populated when the mission
    // reaches "visa_emis" so the client's dossier can display proof of issuance.
    visaStampCode: text("visa_stamp_code"),
    visaIssuedAt: timestamp("visa_issued_at", { withTimezone: true }),
    createdById: integer("created_by_id"),
    // Staff member (collaborateur/stagiaire/expert_comptable) in charge of
    // reviewing this mission -- shown on the M1 cabinet dashboard so the
    // firm can see who owns each dossier.
    assignedToId: integer("assigned_to_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("missions_firm_id_idx").on(table.firmId),
    index("missions_client_id_idx").on(table.clientId),
  ],
);

export const insertMissionSchema = createInsertSchema(missionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMission = z.infer<typeof insertMissionSchema>;
export type Mission = typeof missionsTable.$inferSelect;
