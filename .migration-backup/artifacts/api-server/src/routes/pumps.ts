import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, pumpsTable, stationsTable } from "@workspace/db";
import {
  ListPumpsQueryParams,
  CreatePumpBody,
  UpdatePumpBody,
  UpdatePumpParams,
  DeletePumpParams,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";

// Module P7 (Calibration initiale — Gestion des pompes):
// PME owner CRUD for registered pumps. Each row stores the physical
// meter reading (initial_index) at the time the pump was added to the
// platform; that value is used as indexStart for the pump's very first
// shift, after which the normal last-shift fallback takes over.
//
// Multi-station (P8): each pump now belongs to one physical station
// (stationId). The list endpoint filters by station for portal users
// whose JWT carries a stationId restriction.

const router: IRouter = Router();

router.use(requireAuth);

// Only the PME owner account ("client_pme") may manage pumps.
function requirePmeOwner(req: any, res: any): boolean {
  if (req.user?.role !== "client_pme") {
    res.status(403).json({ error: "Réservé au propriétaire du dossier PME." });
    return false;
  }
  return true;
}

type PumpWithStation = typeof pumpsTable.$inferSelect & {
  station?: typeof stationsTable.$inferSelect | null;
};

function serializePump(p: PumpWithStation) {
  return {
    id: p.id,
    clientId: p.clientId,
    stationId: p.stationId ?? null,
    stationName: p.station?.name ?? null,
    label: p.label,
    fuelType: p.fuelType,
    initialIndex: p.initialIndex,
    createdAt: p.createdAt,
  };
}

// GET /pumps?clientId= — list pumps; auto-scoped to the caller's station
// if their JWT carries stationId (pompiste / station manager).
router.get("/pumps", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const { clientId } = ListPumpsQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const pumps = await db.query.pumpsTable.findMany({
    where: eq(pumpsTable.clientId, clientId),
    orderBy: (t, { asc }) => [asc(t.fuelType), asc(t.label)],
    with: { station: true },
  });

  res.json(pumps.map(serializePump));
});

// POST /pumps — register a new pump. Multi-station (P8): every pump must
// belong to a physical station, so stationId is required.
router.post("/pumps", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const body = CreatePumpBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const station = await db.query.stationsTable.findFirst({
    where: and(
      eq(stationsTable.id, body.stationId),
      eq(stationsTable.clientId, body.clientId),
    ),
  });
  if (!station) {
    res.status(404).json({ error: "Station introuvable ou n'appartient pas à ce dossier." });
    return;
  }

  const [pump] = await db
    .insert(pumpsTable)
    .values({
      clientId: body.clientId,
      stationId: body.stationId,
      label: body.label,
      fuelType: body.fuelType,
      initialIndex: body.initialIndex ?? 0,
    })
    .returning();

  // Re-load with station for the response.
  const pumpsWithStation = await db.query.pumpsTable.findFirst({
    where: eq(pumpsTable.id, pump.id),
    with: { station: true },
  });

  res.status(201).json(serializePump(pumpsWithStation ?? pump));
});

// PUT /pumps/:id
router.put("/pumps/:id", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const { id } = UpdatePumpParams.parse(req.params);
  const body = UpdatePumpBody.parse(req.body);

  const existing = await db.query.pumpsTable.findFirst({
    where: eq(pumpsTable.id, id),
    with: { station: true },
  });
  if (!existing) return res.status(404).json({ error: "Pompe introuvable." });
  if (!requireOwnClient(req, res, existing.clientId)) return;

  const updates: Partial<typeof pumpsTable.$inferInsert> = {};
  if (body.label !== undefined) updates.label = body.label;
  if (body.fuelType !== undefined) updates.fuelType = body.fuelType;
  if (body.initialIndex !== undefined) updates.initialIndex = body.initialIndex;

  const [updated] = await db
    .update(pumpsTable)
    .set(updates)
    .where(eq(pumpsTable.id, id))
    .returning();

  // Re-load with station for the response.
  const updatedWithStation = await db.query.pumpsTable.findFirst({
    where: eq(pumpsTable.id, updated.id),
    with: { station: true },
  });

  res.json(serializePump(updatedWithStation ?? updated));
});

// DELETE /pumps/:id
router.delete("/pumps/:id", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const { id } = DeletePumpParams.parse(req.params);

  const existing = await db.query.pumpsTable.findFirst({
    where: eq(pumpsTable.id, id),
  });
  if (!existing) return res.status(404).json({ error: "Pompe introuvable." });
  if (!requireOwnClient(req, res, existing.clientId)) return;

  await db.delete(pumpsTable).where(eq(pumpsTable.id, id));
  res.status(204).send();
});

export default router;
