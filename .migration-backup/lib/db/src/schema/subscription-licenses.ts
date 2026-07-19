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
import { usersTable } from "./users";
import type { SubscriptionTier } from "./firms";

// SaaS subscription license — issued by the Super Admin Console to grant
// a cabinet its operational subscription for a defined billing period.
//
// A cabinet may have multiple licenses over time (renewal history).
// The "active" license is the one where status='active' AND now() is between
// startDate and endDate. When endDate passes the status must be flipped to
// 'expired' (done by a cron job or at login-time check).
//
// License key format: M15-XXXX-XXXX-XXXX (hex segments, uppercase)
// Example: M15-3F2A-9C1B-7E4D

export const LICENSE_STATUSES = ["active", "expired", "revoked"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  active:  "Active",
  expired: "Expirée",
  revoked: "Révoquée",
};

export const subscriptionLicensesTable = pgTable(
  "subscription_licenses",
  {
    id: serial("id").primaryKey(),

    // The cabinet this license is issued to.
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),

    // Unique activation key shown to the cabinet owner.
    licenseKey: text("license_key").notNull(),

    // Lifecycle: active → expired (automatic) or revoked (admin action).
    status: text("status").notNull().$type<LicenseStatus>().default("active"),

    // The feature tier this license unlocks for the cabinet.
    tier: text("tier").notNull().$type<SubscriptionTier>(),

    // Billing period
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate:   timestamp("end_date",   { withTimezone: true }).notNull(),

    // Amount invoiced for this license period (in FCFA, stored as integer cents
    // or whole FCFA — caller's convention). Zero for complimentary/demo grants.
    pricePaid: integer("price_paid").notNull().default(0),

    // Free-text for the admin (e.g. invoice reference, payment method).
    notes: text("notes"),

    // Super admin who generated this license.
    createdById: integer("created_by_id").references(() => usersTable.id, {
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
    unique("subscription_licenses_key_unique").on(table.licenseKey),
    index("subscription_licenses_firm_id_idx").on(table.firmId),
    index("subscription_licenses_status_idx").on(table.status),
    index("subscription_licenses_end_date_idx").on(table.endDate),
  ],
);

export const insertLicenseSchema = createInsertSchema(subscriptionLicensesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLicense = z.infer<typeof insertLicenseSchema>;
export type LicenseRow = typeof subscriptionLicensesTable.$inferSelect;
