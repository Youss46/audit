import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  checklistItemsTable,
  clientsTable,
  db,
  missionsTable,
} from "@workspace/db";
import {
  ListMissionsQueryParams,
  ListMissionsResponse,
  CreateMissionBody,
  CreateMissionResponse,
  GetMissionParams,
  GetMissionResponse,
  UpdateMissionParams,
  UpdateMissionBody,
  UpdateMissionResponse,
  ListMissionChecklistItemsParams,
  ListMissionChecklistItemsResponse,
  UpdateMissionChecklistItemParams,
  UpdateMissionChecklistItemBody,
  UpdateMissionChecklistItemResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { determineAccountingSystem, generateChecklistLabels } from "../lib/visa-engine";

const router: IRouter = Router();

router.use(requireAuth);

async function withCounts(mission: typeof missionsTable.$inferSelect, clientName?: string | null) {
  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, mission.id),
  });
  return {
    id: mission.id,
    firmId: mission.firmId,
    clientId: mission.clientId,
    clientName: clientName ?? null,
    fiscalYear: mission.fiscalYear,
    accountingSystem: mission.accountingSystem,
    status: mission.status,
    checklistTotal: items.length,
    checklistCompleted: items.filter((i) => i.status === "conforme").length,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  };
}

router.get("/missions", async (req, res) => {
  const { clientId, status } = ListMissionsQueryParams.parse(req.query);

  const conditions = [eq(missionsTable.firmId, req.user!.firmId)];
  if (clientId) conditions.push(eq(missionsTable.clientId, clientId));
  if (status) conditions.push(eq(missionsTable.status, status));

  const missions = await db.query.missionsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { client: true },
  });

  const results = await Promise.all(
    missions.map((m) => withCounts(m, m.client?.name)),
  );

  res.json(ListMissionsResponse.parse(results));
});

// Opens a new visa mission: auto-determines the SYSCOHADA accounting system
// from the client's sector/turnover and generates the matching control
// checklist (module M4/P2).
router.post("/missions", async (req, res) => {
  const body = CreateMissionBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ message: "Client introuvable." });
    return;
  }
  if (client.annualTurnover == null) {
    res.status(422).json({
      message:
        "Le chiffre d'affaires annuel du client doit être renseigné avant d'ouvrir une mission.",
    });
    return;
  }

  const accountingSystem = determineAccountingSystem(client.sector, client.annualTurnover);

  const [mission] = await db
    .insert(missionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: client.id,
      fiscalYear: body.fiscalYear,
      accountingSystem,
      status: "en_attente",
      createdById: req.user!.id,
    })
    .returning();

  const labels = generateChecklistLabels(accountingSystem);
  await db.insert(checklistItemsTable).values(
    labels.map((label, index) => ({
      missionId: mission.id,
      orderIndex: index,
      label,
      status: "a_verifier" as const,
    })),
  );

  await db
    .update(clientsTable)
    .set({ accountingSystem, missionStatus: "en_attente" })
    .where(eq(clientsTable.id, client.id));

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "create",
    entityType: "mission",
    entityId: mission.id,
    details: `Ouverture de la mission ${body.fiscalYear} pour "${client.name}" (système ${accountingSystem})`,
  });

  res.status(201).json(CreateMissionResponse.parse(await withCounts(mission, client.name)));
});

router.get("/missions/:id", async (req, res) => {
  const { id } = GetMissionParams.parse(req.params);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
    with: { client: true },
  });
  if (!mission) {
    res.status(404).json({ message: "Mission introuvable." });
    return;
  }

  const checklist = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, id),
    orderBy: (t, { asc }) => [asc(t.orderIndex)],
  });

  const counts = await withCounts(mission, mission.client?.name);
  res.json(GetMissionResponse.parse({ ...counts, checklist }));
});

router.patch("/missions/:id", async (req, res) => {
  const { id } = UpdateMissionParams.parse(req.params);
  const body = UpdateMissionBody.parse(req.body);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
    with: { client: true },
  });
  if (!mission) {
    res.status(404).json({ message: "Mission introuvable." });
    return;
  }

  const [updated] = await db
    .update(missionsTable)
    .set(body)
    .where(eq(missionsTable.id, id))
    .returning();

  if (body.status) {
    await db
      .update(clientsTable)
      .set({ missionStatus: body.status })
      .where(eq(clientsTable.id, mission.clientId));
  }

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "update",
    entityType: "mission",
    entityId: id,
    details: body.status ? `Statut mis à jour : ${body.status}` : undefined,
  });

  res.json(UpdateMissionResponse.parse(await withCounts(updated, mission.client?.name)));
});

router.get("/missions/:id/checklist", async (req, res) => {
  const { id } = ListMissionChecklistItemsParams.parse(req.params);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
  });
  if (!mission) {
    res.status(404).json({ message: "Mission introuvable." });
    return;
  }

  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, id),
    orderBy: (t, { asc }) => [asc(t.orderIndex)],
  });

  res.json(ListMissionChecklistItemsResponse.parse(items));
});

router.patch("/missions/:id/checklist/:itemId", async (req, res) => {
  const { id, itemId } = UpdateMissionChecklistItemParams.parse(req.params);
  const body = UpdateMissionChecklistItemBody.parse(req.body);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
  });
  if (!mission) {
    res.status(404).json({ message: "Mission introuvable." });
    return;
  }

  const item = await db.query.checklistItemsTable.findFirst({
    where: and(eq(checklistItemsTable.id, itemId), eq(checklistItemsTable.missionId, id)),
  });
  if (!item) {
    res.status(404).json({ message: "Élément de checklist introuvable." });
    return;
  }

  const [updated] = await db
    .update(checklistItemsTable)
    .set(body)
    .where(eq(checklistItemsTable.id, itemId))
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "update",
    entityType: "checklist_item",
    entityId: itemId,
    details: body.status ? `"${item.label}" -> ${body.status}` : undefined,
  });

  res.json(UpdateMissionChecklistItemResponse.parse(updated));
});

export default router;
