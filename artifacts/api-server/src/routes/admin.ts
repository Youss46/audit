/**
 * Super Admin Management Routes — /api/admin/*
 *
 * All endpoints require: requireAuth + requireSuperAdmin (role === "super_admin").
 * Cabinet / PME roles receive 403 on every route here.
 *
 * Endpoints:
 *   GET  /admin/metrics          — SaaS KPIs (revenue, active firms, expiring, PMEs)
 *   GET  /admin/firms            — all cabinets with PME count + active licence
 *   GET  /admin/firms/:id        — single cabinet detail + licence history
 *   PATCH /admin/firms/:id       — update status / tier / limits / contact info
 *   GET  /admin/licenses         — all licences across all firms (most recent first)
 *   POST /admin/licenses         — generate & activate a new licence for a cabinet
 *   POST /admin/licenses/:id/revoke — instantly revoke a licence
 */

import { Router, type IRouter } from "express";
import {
  db,
  firmsTable,
  usersTable,
  clientsTable,
  subscriptionLicensesTable,
  SUBSCRIPTION_TIER_MAX_PME,
  type FirmStatus,
  type SubscriptionTier,
} from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { count, desc, eq, and, lt, sql, asc } from "drizzle-orm";
import { randomBytes } from "crypto";

const router: IRouter = Router();

// Every route in this file is gated behind both middlewares.
router.use(requireAuth, requireSuperAdmin);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a unique licence key in the format M15-XXXX-XXXX-XXXX (hex). */
function generateLicenseKey(): string {
  const hex = randomBytes(6).toString("hex").toUpperCase();
  return `M15-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ─── GET /admin/metrics ───────────────────────────────────────────────────────

router.get("/admin/metrics", async (_req, res) => {
  const thirtyDaysLater = addMonths(new Date(), 0);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  const [
    [revenueRow],
    [activeFirmsRow],
    [trialFirmsRow],
    [suspendedFirmsRow],
    [expiringRow],
    [totalPmeRow],
    [totalFirmsRow],
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`coalesce(sum(${subscriptionLicensesTable.pricePaid}), 0)`,
      })
      .from(subscriptionLicensesTable),
    db
      .select({ count: count() })
      .from(firmsTable)
      .where(eq(firmsTable.status, "active")),
    db
      .select({ count: count() })
      .from(firmsTable)
      .where(eq(firmsTable.status, "trial")),
    db
      .select({ count: count() })
      .from(firmsTable)
      .where(eq(firmsTable.status, "suspended")),
    db
      .select({ count: count() })
      .from(subscriptionLicensesTable)
      .where(
        and(
          eq(subscriptionLicensesTable.status, "active"),
          lt(subscriptionLicensesTable.endDate, thirtyDaysLater),
        ),
      ),
    db.select({ count: count() }).from(clientsTable),
    db.select({ count: count() }).from(firmsTable),
  ]);

  res.json({
    totalRevenueFcfa: Number(revenueRow?.total ?? 0),
    activeFirms: activeFirmsRow?.count ?? 0,
    trialFirms: trialFirmsRow?.count ?? 0,
    suspendedFirms: suspendedFirmsRow?.count ?? 0,
    totalFirms: totalFirmsRow?.count ?? 0,
    expiringLicenses: expiringRow?.count ?? 0,
    totalPme: totalPmeRow?.count ?? 0,
  });
});

// ─── GET /admin/firms ─────────────────────────────────────────────────────────

router.get("/admin/firms", async (_req, res) => {
  const [firms, clientCounts, activeLicenses] = await Promise.all([
    db.query.firmsTable.findMany({ orderBy: [desc(firmsTable.createdAt)] }),
    db
      .select({ firmId: clientsTable.firmId, count: count() })
      .from(clientsTable)
      .groupBy(clientsTable.firmId),
    db.query.subscriptionLicensesTable.findMany({
      where: eq(subscriptionLicensesTable.status, "active"),
      orderBy: [desc(subscriptionLicensesTable.endDate)],
    }),
  ]);

  const countMap = new Map<number, number>(
    clientCounts.map((r) => [r.firmId!, r.count]),
  );
  const licenseMap = new Map<number, typeof activeLicenses[number]>();
  for (const lic of activeLicenses) {
    // Keep the latest active licence per firm
    if (!licenseMap.has(lic.firmId)) licenseMap.set(lic.firmId, lic);
  }

  const result = firms.map((f) => ({
    ...f,
    pmeCount: countMap.get(f.id) ?? 0,
    activeLicense: licenseMap.get(f.id) ?? null,
  }));

  res.json(result);
});

// ─── GET /admin/firms/:id ─────────────────────────────────────────────────────

router.get("/admin/firms/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "ID invalide." }); return; }

  const [firm, pmeCountRows, licenses] = await Promise.all([
    db.query.firmsTable.findFirst({ where: eq(firmsTable.id, id) }),
    db
      .select({ count: count() })
      .from(clientsTable)
      .where(eq(clientsTable.firmId, id)),
    db.query.subscriptionLicensesTable.findMany({
      where: eq(subscriptionLicensesTable.firmId, id),
      orderBy: [desc(subscriptionLicensesTable.createdAt)],
    }),
  ]);

  if (!firm) { res.status(404).json({ error: "Cabinet introuvable." }); return; }

  res.json({ ...firm, pmeCount: pmeCountRows[0]?.count ?? 0, licenses });
});

// ─── PATCH /admin/firms/:id ───────────────────────────────────────────────────

router.patch("/admin/firms/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "ID invalide." }); return; }

  const allowed = ["status", "subscriptionTier", "maxPmeAllowed", "contactEmail", "contactName", "phone"] as const;
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucun champ modifiable fourni." });
    return;
  }

  const VALID_STATUSES = ["trial", "active", "suspended"];
  const VALID_TIERS = ["basic", "pro", "enterprise"];
  if (updates.status && !VALID_STATUSES.includes(updates.status as string)) {
    res.status(400).json({ error: "Statut invalide." });
    return;
  }
  if (updates.subscriptionTier && !VALID_TIERS.includes(updates.subscriptionTier as string)) {
    res.status(400).json({ error: "Tier invalide." });
    return;
  }

  const [updated] = await db
    .update(firmsTable)
    .set(updates as Parameters<typeof db.update>[0] extends never ? never : Partial<typeof firmsTable.$inferInsert>)
    .where(eq(firmsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Cabinet introuvable." }); return; }

  res.json(updated);
});

// ─── GET /admin/licenses ──────────────────────────────────────────────────────

router.get("/admin/licenses", async (_req, res) => {
  const licenses = await db.query.subscriptionLicensesTable.findMany({
    orderBy: [desc(subscriptionLicensesTable.createdAt)],
    with: { firm: true },
  });
  res.json(licenses);
});

// ─── POST /admin/licenses ─────────────────────────────────────────────────────

router.post("/admin/licenses", async (req, res) => {
  const { firmId, tier, durationMonths, pricePaid, notes } = req.body as {
    firmId?: number;
    tier?: SubscriptionTier;
    durationMonths?: number;
    pricePaid?: number;
    notes?: string;
  };

  if (!firmId || !tier || !durationMonths) {
    res.status(400).json({ error: "firmId, tier et durationMonths sont obligatoires." });
    return;
  }
  const VALID_TIERS = ["basic", "pro", "enterprise"];
  if (!VALID_TIERS.includes(tier)) {
    res.status(400).json({ error: "Tier invalide." });
    return;
  }
  if (durationMonths < 1 || durationMonths > 36) {
    res.status(400).json({ error: "Durée invalide (1–36 mois)." });
    return;
  }

  const firm = await db.query.firmsTable.findFirst({
    where: eq(firmsTable.id, firmId),
  });
  if (!firm) { res.status(404).json({ error: "Cabinet introuvable." }); return; }

  const startDate = new Date();
  const endDate = addMonths(startDate, durationMonths);
  const licenseKey = generateLicenseKey();
  const maxPme = SUBSCRIPTION_TIER_MAX_PME[tier];

  // Use a transaction: insert licence + update firm atomically.
  const [license, updatedFirm] = await db.transaction(async (tx) => {
    const [lic] = await tx
      .insert(subscriptionLicensesTable)
      .values({
        firmId,
        licenseKey,
        status: "active",
        tier,
        startDate,
        endDate,
        pricePaid: pricePaid ?? 0,
        notes: notes ?? null,
        createdById: req.user!.id,
      })
      .returning();

    const [updFirm] = await tx
      .update(firmsTable)
      .set({ status: "active", subscriptionTier: tier, maxPmeAllowed: maxPme })
      .where(eq(firmsTable.id, firmId))
      .returning();

    return [lic, updFirm];
  });

  res.status(201).json({ license, firm: updatedFirm });
});

// ─── POST /admin/licenses/:id/revoke ─────────────────────────────────────────

router.post("/admin/licenses/:id/revoke", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "ID invalide." }); return; }

  const [revoked] = await db
    .update(subscriptionLicensesTable)
    .set({ status: "revoked" })
    .where(eq(subscriptionLicensesTable.id, id))
    .returning();

  if (!revoked) { res.status(404).json({ error: "Licence introuvable." }); return; }

  res.json(revoked);
});

export default router;
