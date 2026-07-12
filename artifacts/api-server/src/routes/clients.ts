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
import { requireAuth } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/clients", async (req, res) => {
  const { missionStatus } = ListClientsQueryParams.parse(req.query);

  const clients = await db.query.clientsTable.findMany({
    where: missionStatus
      ? and(
          eq(clientsTable.firmId, req.user!.firmId),
          eq(clientsTable.missionStatus, missionStatus),
        )
      : eq(clientsTable.firmId, req.user!.firmId),
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  res.json(ListClientsResponse.parse(clients));
});

router.post("/clients", async (req, res) => {
  const body = CreateClientBody.parse(req.body);

  const [client] = await db
    .insert(clientsTable)
    .values({ ...body, firmId: req.user!.firmId })
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

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ message: "Client introuvable." });
    return;
  }

  res.json(GetClientResponse.parse(client));
});

router.patch("/clients/:id", async (req, res) => {
  const { id } = UpdateClientParams.parse(req.params);
  const body = UpdateClientBody.parse(req.body);

  const existing = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!existing) {
    res.status(404).json({ message: "Client introuvable." });
    return;
  }

  const [updated] = await db
    .update(clientsTable)
    .set(body)
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

router.delete("/clients/:id", async (req, res) => {
  const { id } = DeleteClientParams.parse(req.params);

  const existing = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!existing) {
    res.status(404).json({ message: "Client introuvable." });
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
