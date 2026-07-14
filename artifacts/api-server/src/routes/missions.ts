import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  checklistItemsTable,
  clientsTable,
  db,
  missionsTable,
  usersTable,
  isPortalRole,
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
import { requireAuth, requireOwnClient, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  assertValidMissionTransition,
  determineAccountingSystem,
  generateChecklistLabels,
  generateVisaStampCode,
  VisaWorkflowError,
} from "../lib/visa-engine";

const router: IRouter = Router();

router.use(requireAuth);

async function withCounts(
  mission: typeof missionsTable.$inferSelect,
  client?: typeof clientsTable.$inferSelect | null,
  assignedToName?: string | null,
) {
  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, mission.id),
  });
  return {
    id: mission.id,
    firmId: mission.firmId,
    clientId: mission.clientId,
    clientName: client?.name ?? null,
    clientLegalForm: client?.legalForm ?? null,
    clientSector: client?.sector ?? null,
    clientAnnualTurnover: client?.annualTurnover ?? null,
    fiscalYear: mission.fiscalYear,
    accountingSystem: mission.accountingSystem,
    status: mission.status,
    checklistTotal: items.length,
    checklistCompleted: items.filter((i) => i.status === "conforme").length,
    assignedToId: mission.assignedToId ?? null,
    assignedToName: assignedToName ?? null,
    visaStampCode: mission.visaStampCode ?? null,
    visaIssuedAt: mission.visaIssuedAt ?? null,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  };
}

// Applies the checklist's current anomaly state to the mission (and its
// client) automatically: entering "anomalie" as soon as any item is flagged,
// and returning to "en_cours" once every anomaly has been resolved. This is
// the system-driven half of the visa status state machine.
async function syncMissionAnomalyState(mission: typeof missionsTable.$inferSelect) {
  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, mission.id),
  });
  const hasAnomalies = items.some((i) => i.status === "anomalie");

  let nextStatus = mission.status;
  if (hasAnomalies && mission.status === "en_cours") {
    nextStatus = "anomalie";
  } else if (!hasAnomalies && mission.status === "anomalie") {
    nextStatus = "en_cours";
  }

  if (nextStatus === mission.status) return mission;

  const [updated] = await db
    .update(missionsTable)
    .set({ status: nextStatus })
    .where(eq(missionsTable.id, mission.id))
    .returning();
  await db
    .update(clientsTable)
    .set({ missionStatus: nextStatus })
    .where(eq(clientsTable.id, mission.clientId));

  return updated;
}

router.get("/missions", async (req, res) => {
  const { clientId, status } = ListMissionsQueryParams.parse(req.query);

  // Espace PME (client_pme) accounts only ever see missions for their own
  // client dossier, regardless of what clientId was requested.
  if (isPortalRole(req.user!.role)) {
    if (!req.user!.clientId || (clientId && clientId !== req.user!.clientId)) {
      res.json(ListMissionsResponse.parse([]));
      return;
    }
  }
  const effectiveClientId = isPortalRole(req.user!.role) ? req.user!.clientId! : clientId;

  const conditions = [eq(missionsTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(missionsTable.clientId, effectiveClientId));
  if (status) conditions.push(eq(missionsTable.status, status));

  const missions = await db.query.missionsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { client: true, assignedTo: true },
  });

  const results = await Promise.all(
    missions.map((m) => withCounts(m, m.client, m.assignedTo?.fullName)),
  );

  res.json(ListMissionsResponse.parse(results));
});

// Opens a new visa mission: auto-determines the SYSCOHADA accounting system
// from the client's sector/turnover and generates the matching control
// checklist (module M4/P2).
router.post(
  "/missions",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
  const body = CreateMissionBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }
  if (client.annualTurnover == null) {
    res.status(422).json({
      error:
        "Le chiffre d'affaires annuel du client doit être renseigné avant d'ouvrir une mission.",
    });
    return;
  }

  let assignedTo: typeof usersTable.$inferSelect | null = null;
  if (body.assignedToId != null) {
    assignedTo =
      (await db.query.usersTable.findFirst({
        where: and(eq(usersTable.id, body.assignedToId), eq(usersTable.firmId, req.user!.firmId)),
      })) ?? null;
    if (!assignedTo) {
      res.status(404).json({ error: "Collaborateur assigné introuvable." });
      return;
    }
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
      assignedToId: assignedTo?.id ?? null,
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
    userRole: req.user!.role,
    action: AuditAction.MISSION_CREATE,
    entityType: "mission",
    entityId: mission.id,
    details: `Ouverture de la mission ${body.fiscalYear} pour "${client.name}" (système ${accountingSystem})`,
    ipAddress: req.ip,
  });

  res
    .status(201)
    .json(CreateMissionResponse.parse(await withCounts(mission, client, assignedTo?.fullName)));
});

router.get("/missions/:id", async (req, res) => {
  const { id } = GetMissionParams.parse(req.params);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
    with: { client: true, assignedTo: true },
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, mission.clientId)) return;

  const checklist = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, id),
    orderBy: (t, { asc }) => [asc(t.orderIndex)],
  });

  const counts = await withCounts(mission, mission.client, mission.assignedTo?.fullName);
  res.json(GetMissionResponse.parse({ ...counts, checklist }));
});

router.patch(
  "/missions/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
  const { id } = UpdateMissionParams.parse(req.params);
  const body = UpdateMissionBody.parse(req.body);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
    with: { client: true },
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }

  let assignedTo: typeof usersTable.$inferSelect | null = null;
  if (body.assignedToId !== undefined && body.assignedToId !== null) {
    assignedTo =
      (await db.query.usersTable.findFirst({
        where: and(eq(usersTable.id, body.assignedToId), eq(usersTable.firmId, req.user!.firmId)),
      })) ?? null;
    if (!assignedTo) {
      res.status(404).json({ error: "Collaborateur assigné introuvable." });
      return;
    }
  }

  // Only the Expert-comptable (cabinet owner) may issue the final digital
  // Visa stamp -- a Collaborateur can bring the dossier to "valide" but
  // cannot perform the emission itself.
  if (body.status === "visa_emis" && req.user!.role !== "expert_comptable") {
    res.status(403).json({
      error: "Seul l'expert-comptable peut émettre le visa numérique.",
    });
    return;
  }

  let extraUpdates: Partial<typeof missionsTable.$inferInsert> = {};

  if (body.status && body.status !== mission.status) {
    const items = await db.query.checklistItemsTable.findMany({
      where: eq(checklistItemsTable.missionId, id),
    });
    const hasAnomalies = items.some((i) => i.status === "anomalie");
    const allConform = items.length > 0 && items.every((i) => i.status === "conforme");

    try {
      assertValidMissionTransition(mission.status, body.status, { allConform, hasAnomalies });
    } catch (err) {
      if (err instanceof VisaWorkflowError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Mock the emission of the digital visa stamp when the mission finally
    // reaches "visa_emis".
    if (body.status === "visa_emis") {
      extraUpdates = {
        visaStampCode: generateVisaStampCode(mission.fiscalYear, mission.id),
        visaIssuedAt: new Date(),
      };
    }
  }

  const [updated] = await db
    .update(missionsTable)
    .set({ ...body, ...extraUpdates })
    .where(eq(missionsTable.id, id))
    .returning();

  if (body.status) {
    await db
      .update(clientsTable)
      .set({ missionStatus: body.status })
      .where(eq(clientsTable.id, mission.clientId));
  }

  const assignedToName =
    body.assignedToId !== undefined
      ? assignedTo?.fullName ?? null
      : (
          await db.query.usersTable.findFirst({
            where: eq(usersTable.id, updated.assignedToId ?? -1),
          })
        )?.fullName ?? null;

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: body.status === "visa_emis" ? AuditAction.VISA_ISSUED : AuditAction.MISSION_UPDATE,
    entityType: "mission",
    entityId: id,
    details: body.status ? `Statut mis à jour : ${body.status}` : undefined,
    ipAddress: req.ip,
  });

  res.json(
    UpdateMissionResponse.parse(await withCounts(updated, mission.client, assignedToName)),
  );
});

router.get("/missions/:id/checklist", async (req, res) => {
  const { id } = ListMissionChecklistItemsParams.parse(req.params);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, mission.clientId)) return;

  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, id),
    orderBy: (t, { asc }) => [asc(t.orderIndex)],
  });

  res.json(ListMissionChecklistItemsResponse.parse(items));
});

router.patch(
  "/missions/:id/checklist/:itemId",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
  const { id, itemId } = UpdateMissionChecklistItemParams.parse(req.params);
  const body = UpdateMissionChecklistItemBody.parse(req.body);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }
  if (mission.status === "visa_emis") {
    res.status(409).json({
      error: "Le visa a déjà été émis : la grille de contrôle est verrouillée.",
    });
    return;
  }

  const item = await db.query.checklistItemsTable.findFirst({
    where: and(eq(checklistItemsTable.id, itemId), eq(checklistItemsTable.missionId, id)),
  });
  if (!item) {
    res.status(404).json({ error: "Élément de checklist introuvable." });
    return;
  }

  // Stagiaire has read-only access to the checklist: they may fill in a
  // draft observation (the `note` field) but cannot validate a control
  // point (change its `status` to conforme/anomalie).
  if (req.user!.role === "stagiaire" && body.status !== undefined) {
    res.status(403).json({
      error:
        "Les stagiaires ne peuvent pas valider les points de contrôle, uniquement ajouter des observations.",
    });
    return;
  }

  // Flagging a control point as an anomaly always requires a justification
  // comment so the accountant knows what to fix before the visa can be issued.
  if (body.status === "anomalie") {
    const note = (body.note ?? item.note ?? "").trim();
    if (!note) {
      res.status(400).json({
        error:
          "Un commentaire est obligatoire pour signaler une anomalie sur ce point de contrôle.",
      });
      return;
    }
  }

  const [updated] = await db
    .update(checklistItemsTable)
    .set(body)
    .where(eq(checklistItemsTable.id, itemId))
    .returning();

  // Reflect the checklist's anomaly state onto the mission/client status
  // automatically (system-driven part of the visa workflow state machine).
  await syncMissionAnomalyState(mission);

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: body.status !== undefined ? AuditAction.CHECKLIST_VALIDATE : AuditAction.CHECKLIST_NOTE,
    entityType: "checklist_item",
    entityId: itemId,
    details: body.status ? `"${item.label}" -> ${body.status}` : undefined,
    ipAddress: req.ip,
  });

  res.json(UpdateMissionChecklistItemResponse.parse(updated));
});

export default router;
