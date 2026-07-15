import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, fuelPricesTable } from "@workspace/db";
import { ListFuelPricesQueryParams, UpsertFuelPriceBody } from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";

// Module P7 (Sécurisation du prix carburant): the active FCFA selling price
// per litre for each fuel type, one row per client + fuelType. Writable
// exclusively by the PME owner ("client_pme"). The "Ventes de carburant"
// validation endpoint (pump-shifts.ts) resolves this value server-side --
// it is never accepted from the client, so the price field on that screen
// can safely be disabled/read-only without any way to bypass it by
// tampering with the request body.

const router: IRouter = Router();
router.use(requireAuth);

function requirePmeOwner(req: any, res: any): boolean {
  if (req.user?.role !== "client_pme") {
    res.status(403).json({ error: "Réservé au propriétaire du dossier PME." });
    return false;
  }
  return true;
}

function serializeFuelPrice(
  row: typeof fuelPricesTable.$inferSelect,
  updatedByName: string | null = null,
) {
  return {
    id: row.id,
    clientId: row.clientId,
    fuelType: row.fuelType,
    unitPrice: row.unitPrice,
    updatedByName,
    updatedAt: row.updatedAt,
  };
}

// GET /fuel-prices?clientId= -- any authenticated member of the client may
// read the current prices (needed to display the locked price on the
// pompiste's sale form); only the PME owner may change them (see PUT below).
router.get("/fuel-prices", async (req, res) => {
  const { clientId } = ListFuelPricesQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const rows = await db.query.fuelPricesTable.findMany({
    where: eq(fuelPricesTable.clientId, clientId),
    with: { updatedBy: true },
    orderBy: (t, { asc }) => [asc(t.fuelType)],
  });

  res.json(rows.map((r) => serializeFuelPrice(r, (r as any).updatedBy?.fullName ?? null)));
});

// PUT /fuel-prices -- upsert (create or replace) the active price for one
// fuel type. PME owner only.
router.put("/fuel-prices", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const body = UpsertFuelPriceBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const existing = await db.query.fuelPricesTable.findFirst({
    where: and(
      eq(fuelPricesTable.clientId, body.clientId),
      eq(fuelPricesTable.fuelType, body.fuelType),
    ),
  });

  const [saved] = existing
    ? await db
        .update(fuelPricesTable)
        .set({
          unitPrice: body.unitPrice,
          updatedById: req.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(fuelPricesTable.id, existing.id))
        .returning()
    : await db
        .insert(fuelPricesTable)
        .values({
          clientId: body.clientId,
          fuelType: body.fuelType,
          unitPrice: body.unitPrice,
          updatedById: req.user!.id,
        })
        .returning();

  res.json(serializeFuelPrice(saved, req.user!.fullName));
});

export default router;
