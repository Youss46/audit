import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, stationsTable, pumpsTable, usersTable } from "@workspace/db";
import {
  ListStationsQueryParams,
  CreateStationBody,
  UpdateStationParams,
  UpdateStationBody,
  DeleteStationParams,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, canAccessClient } from "../middlewares/auth";

// Multi-station architecture (P8): a single PME may own multiple physical
// gas stations in different cities. Each station is an independent
// operational unit -- pumps, staff, and accounting entries are all scoped
// to one station. The PME owner ("client_pme") and cabinet staff have
// cross-station visibility (stationId = null); POMPISTE and station-level
// staff carry a stationId that restricts every operation to their site.

const router: IRouter = Router();
router.use(requireAuth);

function requirePmeOwnerOrCabinet(req: any, res: any): boolean {
  if (req.user?.role === "client_staff" && !canAccessClient(req, req.user.clientId)) {
    res.status(403).json({ error: "Accès refusé à ce dossier client." });
    return false;
  }
  return true;
}

function requirePmeOwner(req: any, res: any): boolean {
  if (req.user?.role !== "client_pme") {
    res.status(403).json({ error: "Réservé au propriétaire du dossier PME." });
    return false;
  }
  return true;
}

function serializeStation(s: typeof stationsTable.$inferSelect) {
  return {
    id: s.id,
    clientId: s.clientId,
    name: s.name,
    city: s.city,
    createdAt: s.createdAt,
  };
}

// GET /stations?clientId= — PME owner, cabinet staff, and portal staff
// with the matching clientId can all list stations (needed for the
// assignment and pump-selection UIs).
router.get("/stations", async (req, res) => {
  const { clientId } = ListStationsQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const stations = await db.query.stationsTable.findMany({
    where: eq(stationsTable.clientId, clientId),
    orderBy: (t, { asc }) => [asc(t.city), asc(t.name)],
  });

  res.json(stations.map(serializeStation));
});

// POST /stations — PME owner only
router.post("/stations", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const body = CreateStationBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const [station] = await db
    .insert(stationsTable)
    .values({ clientId: body.clientId, name: body.name, city: body.city })
    .returning();

  res.status(201).json(serializeStation(station));
});

// PUT /stations/:id — PME owner only
router.put("/stations/:id", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const { id } = UpdateStationParams.parse(req.params);
  const body = UpdateStationBody.parse(req.body);

  const existing = await db.query.stationsTable.findFirst({
    where: eq(stationsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Station introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, existing.clientId)) return;

  const updates: Partial<typeof stationsTable.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.city !== undefined) updates.city = body.city;

  const [updated] = await db
    .update(stationsTable)
    .set(updates)
    .where(eq(stationsTable.id, id))
    .returning();

  res.json(serializeStation(updated));
});

// DELETE /stations/:id — PME owner only. Blocked if pumps still assigned.
router.delete("/stations/:id", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const { id } = DeleteStationParams.parse(req.params);

  const existing = await db.query.stationsTable.findFirst({
    where: eq(stationsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Station introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, existing.clientId)) return;

  // Block deletion if any pumps are still attached to this station.
  const linkedPump = await db.query.pumpsTable.findFirst({
    where: eq(pumpsTable.stationId, id),
  });
  if (linkedPump) {
    res.status(409).json({
      error:
        "Impossible de supprimer cette station : des pompes lui sont encore attribuées. Réattribuez ou supprimez les pompes d'abord.",
    });
    return;
  }

  // Detach any staff still linked to this station before deletion.
  await db
    .update(usersTable)
    .set({ stationId: null })
    .where(and(eq(usersTable.stationId, id)));

  await db.delete(stationsTable).where(eq(stationsTable.id, id));
  res.status(204).send();
});

export default router;
