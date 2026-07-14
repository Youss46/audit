import {
  boolean,
  doublePrecision,
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

// SYSCOHADA business sectors used to determine the applicable accounting
// system from the client's annual turnover (chiffre d'affaires).
// STATION_SERVICE (service station) is a specialized commerce sub-sector:
// it drives the same SYSCOHADA thresholds as "commerce" (see THRESHOLDS in
// api-server/src/lib/visa-engine.ts) but also unlocks the sector-restricted
// "POMPISTE" staff role for that client (see SECTOR_RESTRICTED_ROLES in
// ./roles.ts) and the Pompiste-tailored quick actions on the Espace PME
// portal dashboard.
export const SECTORS = ["commerce", "artisanat", "services", "STATION_SERVICE"] as const;
export type Sector = (typeof SECTORS)[number];

export const ACCOUNTING_SYSTEMS = ["SMT", "ALLEGE", "NORMAL"] as const;
export type AccountingSystem = (typeof ACCOUNTING_SYSTEMS)[number];

// Ivorian tax regime (régime fiscal) governing which declarations a client
// is subject to. REEL_NORMAL/REEL_SIMPLIFIE/ENTREPRENANT are ordinary
// taxable regimes; EXONERE marks an entity exempted or not subject to VAT
// by law (e.g. certain non-profits, or a regime with no VAT obligation).
// Kept independent of `isVatRegistered` below -- a client can in principle
// change VAT registration status without changing tax regime, and vice
// versa -- but in practice EXONERE implies isVatRegistered = false.
export const TAX_REGIMES = [
  "REEL_NORMAL",
  "REEL_SIMPLIFIE",
  "ENTREPRENANT",
  "EXONERE",
] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const MISSION_STATUSES = [
  "en_attente",
  "en_cours",
  "anomalie",
  "valide",
  "visa_emis",
] as const;
export type MissionStatusValue = (typeof MISSION_STATUSES)[number];

// Client registry (module M1): centralized KYC info per client dossier.
export const clientsTable = pgTable(
  "clients",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalForm: text("legal_form").notNull(),
    sector: text("sector").notNull().$type<Sector>(),
    rccm: text("rccm"),
    taxId: text("tax_id"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    contactName: text("contact_name"),
    annualTurnover: doublePrecision("annual_turnover"),
    accountingSystem: text("accounting_system").$type<AccountingSystem>(),
    // Ivorian tax regime + VAT registration status (see TAX_REGIMES above).
    // Defaults keep every pre-existing client fully taxable/VAT-registered
    // (the historical behavior) unless the accountant explicitly marks the
    // dossier as exempt/non-assujetti.
    taxRegime: text("tax_regime").notNull().default("REEL_NORMAL").$type<TaxRegime>(),
    isVatRegistered: boolean("is_vat_registered").notNull().default(true),
    // Denormalized cache of the client's most recent mission status, kept in
    // sync by the missions routes. Null means no mission has ever been
    // opened for this client -- do NOT default this to "en_attente", or the
    // client list falsely implies a pending mission exists (module M1 bug:
    // clients showed "En attente" while "Missions de Visa" was empty).
    missionStatus: text("mission_status").$type<MissionStatusValue>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("clients_firm_id_idx").on(table.firmId)],
);

export const insertClientSchema = createInsertSchema(clientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
