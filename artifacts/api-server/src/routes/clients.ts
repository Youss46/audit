import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientsTable, isPortalRole } from "@workspace/db";
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
import { AuditAction, logAudit } from "../lib/audit";
import { determineAccountingSystem } from "../lib/visa-engine";
import {
  postCapitalContribution,
  CapitalAlreadyInitializedError,
} from "../lib/capital-engine";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/clients", async (req, res) => {
  const { missionStatus } = ListClientsQueryParams.parse(req.query);

  // Espace PME (client_pme) accounts only ever see their own dossier.
  if (isPortalRole(req.user!.role)) {
    if (!req.user!.clientId) {
      res.json(ListClientsResponse.parse([]));
      return;
    }
    if (!requireOwnClient(req, res, req.user!.clientId)) return;
  }

  const conditions = [eq(clientsTable.firmId, req.user!.firmId)];
  if (missionStatus) conditions.push(eq(clientsTable.missionStatus, missionStatus));
  if (isPortalRole(req.user!.role)) conditions.push(eq(clientsTable.id, req.user!.clientId!));

  const clients = await db.query.clientsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  res.json(ListClientsResponse.parse(clients));
});

router.post("/clients", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const body = CreateClientBody.parse(req.body);

  // Compute the applicable SYSCOHADA system immediately if the turnover is
  // already known, so the dossier reflects it from the moment of creation.
  const accountingSystem =
    body.annualTurnover != null
      ? determineAccountingSystem(body.sector, body.annualTurnover)
      : null;

  // missionStatus stays null (no default) until an actual mission is opened
  // for this client -- see the note on clientsTable.missionStatus.
  const [client] = await db
    .insert(clientsTable)
    .values({ ...body, accountingSystem, firmId: req.user!.firmId, missionStatus: null })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.CLIENT_CREATE,
    entityType: "client",
    entityId: client.id,
    details: `Création du dossier client "${client.name}"`,
    ipAddress: req.ip,
  });

  // Génération automatique de l'écriture de constitution du capital social
  // si un capital > 0 a été renseigné à la création du dossier.
  if (client.capitalSocial > 0 && !client.isCapitalInitialized) {
    try {
      await postCapitalContribution(
        client.firmId,
        client.id,
        req.user!.id,
        client.name,
        client.capitalSocial,
        client.createdAt,
      );
      await logAudit({
        firmId: req.user!.firmId,
        userId: req.user!.id,
        userName: req.user!.fullName,
        userRole: req.user!.role,
        action: AuditAction.CAPITAL_INIT,
        entityType: "client",
        entityId: client.id,
        details: `Écriture de constitution du capital social générée (${client.capitalSocial.toLocaleString("fr")} FCFA) — Débit 5211 / Crédit 1013 — "${client.name}"`,
        ipAddress: req.ip,
      });
    } catch (err) {
      // La constitution est non-bloquante : le dossier est créé même si
      // l'écriture échoue (l'expert-comptable peut la saisir manuellement).
      if (!(err instanceof CapitalAlreadyInitializedError)) {
        console.error("[capital-engine] Erreur lors de la génération de l'écriture de constitution :", err);
      }
    }
  }

  // Re-fetch the client after potential isCapitalInitialized flag update
  const finalClient = await db.query.clientsTable.findFirst({
    where: eq(clientsTable.id, client.id),
  }) ?? client;

  res.status(201).json(CreateClientResponse.parse(finalClient));
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
  requireRole("expert_comptable", "collaborateur"),
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
    userRole: req.user!.role,
    action: AuditAction.CLIENT_UPDATE,
    entityType: "client",
    entityId: id,
    ipAddress: req.ip,
  });

  // Génération automatique de l'écriture de constitution si le capital social
  // vient d'être renseigné pour la première fois (n'avait jamais été initialisé).
  if (
    updated.capitalSocial > 0 &&
    !existing.isCapitalInitialized &&
    !updated.isCapitalInitialized
  ) {
    try {
      await postCapitalContribution(
        req.user!.firmId,
        id,
        req.user!.id,
        updated.name,
        updated.capitalSocial,
        updated.createdAt,
      );
      await logAudit({
        firmId: req.user!.firmId,
        userId: req.user!.id,
        userName: req.user!.fullName,
        userRole: req.user!.role,
        action: AuditAction.CAPITAL_INIT,
        entityType: "client",
        entityId: id,
        details: `Écriture de constitution du capital social générée (${updated.capitalSocial.toLocaleString("fr")} FCFA) — Débit 5211 / Crédit 1013 — "${updated.name}"`,
        ipAddress: req.ip,
      });
      // Re-fetch to get the latest isCapitalInitialized = true
      const refreshed = await db.query.clientsTable.findFirst({
        where: eq(clientsTable.id, id),
      });
      if (refreshed) {
        res.json(UpdateClientResponse.parse(refreshed));
        return;
      }
    } catch (err) {
      if (!(err instanceof CapitalAlreadyInitializedError)) {
        console.error("[capital-engine] Erreur lors de la génération de l'écriture de constitution :", err);
      }
    }
  }

  res.json(UpdateClientResponse.parse(updated));
});

// Deleting a client dossier is destructive and legally sensitive (it removes
// the firm's record of its engagement with that company) -- restricted to
// the Expert-comptable (cabinet owner) only. Collaborateurs may manage
// clients day-to-day but cannot delete them.
router.delete(
  "/clients/:id",
  requireRole("expert_comptable"),
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
    userRole: req.user!.role,
    action: AuditAction.CLIENT_DELETE,
    entityType: "client",
    entityId: id,
    details: `Suppression du dossier client "${existing.name}"`,
    ipAddress: req.ip,
  });

  res.status(204).end();
});

export default router;
