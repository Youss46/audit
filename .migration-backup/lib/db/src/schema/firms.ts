import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A "firm" is an accounting cabinet (cabinet d'expertise-comptable).
// It is the primary tenant boundary: every domain table carries a firmId and
// every query must be scoped by it.
//
// SaaS subscription fields (managed by Super Admin console):
//   status          — lifecycle of the cabinet's subscription
//   subscriptionTier— feature tier: basic / pro / enterprise
//   maxPmeAllowed   — how many PME clients this cabinet may register
//   contactEmail/Name/phone — cabinet owner contact info for billing

export const FIRM_STATUSES = ["trial", "active", "suspended"] as const;
export type FirmStatus = (typeof FIRM_STATUSES)[number];

export const SUBSCRIPTION_TIERS = ["basic", "pro", "enterprise"] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const FIRM_STATUS_LABELS: Record<FirmStatus, string> = {
  trial:     "Essai",
  active:    "Actif",
  suspended: "Suspendu",
};

export const SUBSCRIPTION_TIER_LABELS: Record<SubscriptionTier, string> = {
  basic:      "Basique",
  pro:        "Pro",
  enterprise: "Entreprise",
};

export const SUBSCRIPTION_TIER_MAX_PME: Record<SubscriptionTier, number> = {
  basic:      5,
  pro:        25,
  enterprise: 999,
};

export const firmsTable = pgTable("firms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),

  // SaaS subscription management (written only by super_admin)
  status: text("status").notNull().$type<FirmStatus>().default("trial"),
  subscriptionTier: text("subscription_tier")
    .notNull()
    .$type<SubscriptionTier>()
    .default("basic"),
  // Maximum number of PME dossiers this cabinet may create. Enforced on
  // POST /clients. Defaults to 5 (Basic trial limit).
  maxPmeAllowed: integer("max_pme_allowed").notNull().default(5),

  // Billing / contact info
  contactEmail: text("contact_email"),
  contactName:  text("contact_name"),
  phone:        text("phone"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertFirmSchema = createInsertSchema(firmsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFirm = z.infer<typeof insertFirmSchema>;
export type Firm = typeof firmsTable.$inferSelect;
