import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import {
  ListClientsQueryParams,
  ListClientsResponse,
  CreateClientBody,
  CreateClientResponse,
  GetClientParams,
  GetClientResponse,
  UpdateClientParams,
  UpdateClientBody,
  UpdateClientResponse,
  DeleteClientParams,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requireRole } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { determineAccountingSystem } from "../lib/visa-engine";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/clients", async (req, res) => {
  const { missionStatus } = ListClientsQueryParams.parse(req.query);

  // Espace PME (client_pme) accounts only ever see their own dossier.
  if (req.user!.role === "client_pme") {
    if (!req.user!.clientId) {
      res.json(ListClientsResponse.parse([]));
      return;
    }
    if (!requireOwnClient(req, res, req.user!.clientId)) return;
  }

  const conditions = [eq(clientsTable.firmId, req.user!.firmId)];
  if (missionStatus) conditions.push(eq(clientsTable.missionStatus, missionStatus));
  if (req.user!.role === "client_pme") conditions.push(eq(clientsTable.id, req.user!.clientId!));

  const clients = await db.query.clientsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  res.json(ListClientsResponse.parse(clients));
});

router.post("/clients", requireRole("expert_comptable", "collaborateur", "stagiaire"), async (req, res) => {
  const body = CreateClientBody.parse(req.body);

  // Compute the applicable SYSCOHADA system immediately if the turnover is
  // already known, so the dossier reflects it from the moment of creation.
  const accountingSystem =
    body.annualTurnover != null
      ? determineAccountingSystem(body.sector, body.annualTurnover)
      : null;

  const [client] = await db
    .insert(clientsTable)
    .values({ ...body, accountingSystem, firmId: req.user!.firmId })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "create",
    entityType: "client",
    entityId: client.id,
    details: `Création du dossier client "${client.name}"`,
  });

  res.status(201).json(CreateClientResponse.parse(client));
});

router.get("/clients/:id", async (req, res) => {
  const { id } = GetClientParams.parse(req.params);
  if (!requireOwnClient(req, res, id)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  res.json(GetClientResponse.parse(client));
});

router.patch(
  "/clients/:id",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
  const { id } = UpdateClientParams.parse(req.params);
  const body = UpdateClientBody.parse(req.body);

  const existing = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!existing) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  // Re-derive the SYSCOHADA system whenever the sector or turnover changes,
  // so the classification shown to the accountant is always up to date.
  const sector = body.sector ?? existing.sector;
  const annualTurnover = body.annualTurnover ?? existing.annualTurnover;
  const accountingSystem =
    (body.sector !== undefined || body.annualTurnover !== undefined) && annualTurnover != null
      ? determineAccountingSystem(sector, annualTurnover)
      : existing.accountingSystem;

  const [updated] = await db
    .update(clientsTable)
    .set({ ...body, accountingSystem })
    .where(eq(clientsTable.id, id))
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "update",
    entityType: "client",
    entityId: id,
  });

  res.json(UpdateClientResponse.parse(updated));
});

router.delete(
  "/clients/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
  const { id } = DeleteClientParams.parse(req.params);

  const existing = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!existing) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  await db.delete(clientsTable).where(eq(clientsTable.id, id));

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "delete",
    entityType: "client",
    entityId: id,
    details: `Suppression du dossier client "${existing.name}"`,
  });

  res.status(204).end();
});

export default router;
