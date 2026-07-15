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
  GetOpeningBalanceEligibilityParams,
  GetOpeningBalanceEligibilityQueryParams,
  GetOpeningBalanceEligibilityResponse,
  CreateOpeningBalanceParams,
  CreateOpeningBalanceBody,
  CreateOpeningBalanceResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { determineAccountingSystem } from "../lib/visa-engine";
import {
  postCapitalContribution,
  markCapitalAsReprise,
  CapitalAlreadyInitializedError,
} from "../lib/capital-engine";
import {
  checkOpeningBalanceEligibility,
  postOpeningBalance,
  OpeningBalanceNotEligibleError,
  OpeningBalanceEmptyError,
  OpeningBalanceImbalanceError,
  OpeningBalanceInvalidAccountError,
} from "../lib/opening-balance-engine";

const router: IRouter = Router();

router.use(requireAuth);

// Client tel que retourné par un insert/update de clientsTable -- suffisant
// pour piloter l'initialisation du capital (pas besoin du type Zod complet).
type ClientCapitalFields = {
  id: number;
  firmId: number;
  name: string;
  capitalSocial: number;
  capitalDeposited: boolean;
  isReprise: boolean;
  createdAt: Date;
};

/**
 * Initialise le capital social d'un dossier client (appelé à la création du
 * dossier, ou lors du premier renseignement du capital via une mise à jour).
 *
 * Deux branches, selon `isReprise` ("Reprise de dossier — Client existant") :
 *  - `isReprise = true`  : aucune écriture n'est générée. Le client est
 *    directement marqué `isCapitalInitialized = true` -- son capital et le
 *    reste de ses capitaux propres historiques seront repris globalement via
 *    la Balance d'Entrée (Journal des À-nouveaux), pas via un apport de
 *    constitution fictif daté d'aujourd'hui.
 *  - `isReprise = false` (création d'entreprise, cas standard) : génération
 *    automatique de l'écriture de constitution (Débit 5211/4613 / Crédit 1013)
 *    datée de la création du dossier.
 *
 * Non-bloquant : toute erreur (hors double-initialisation, silencieuse) est
 * journalisée mais ne fait pas échouer la requête HTTP appelante -- le
 * dossier reste utilisable et l'expert-comptable peut intervenir manuellement.
 */
async function initializeClientCapital(
  client: ClientCapitalFields,
  ctx: { firmId: number; userId: number; userName: string; userRole: string; ip: string | undefined },
): Promise<void> {
  try {
    if (client.isReprise) {
      await markCapitalAsReprise(client.firmId, client.id);
      await logAudit({
        firmId: ctx.firmId,
        userId: ctx.userId,
        userName: ctx.userName,
        userRole: ctx.userRole,
        action: AuditAction.CAPITAL_REPRISE,
        entityType: "client",
        entityId: client.id,
        details: `Dossier "${client.name}" marqué comme repris (client existant) : capital de ${client.capitalSocial.toLocaleString("fr")} FCFA initialisé sans écriture -- à reprendre via la Balance d'Entrée.`,
        ipAddress: ctx.ip,
      });
    } else {
      await postCapitalContribution(
        client.firmId,
        client.id,
        ctx.userId,
        client.name,
        client.capitalSocial,
        client.createdAt,
        client.capitalDeposited,
      );
      await logAudit({
        firmId: ctx.firmId,
        userId: ctx.userId,
        userName: ctx.userName,
        userRole: ctx.userRole,
        action: AuditAction.CAPITAL_INIT,
        entityType: "client",
        entityId: client.id,
        details: `Écriture de constitution du capital social générée (${client.capitalSocial.toLocaleString("fr")} FCFA) — Débit ${client.capitalDeposited ? "5211" : "4613"} / Crédit 1013 — "${client.name}"`,
        ipAddress: ctx.ip,
      });
    }
  } catch (err) {
    // Non-bloquant : le dossier reste créé/mis à jour même si l'écriture ou
    // le marquage échoue (l'expert-comptable peut intervenir manuellement).
    if (!(err instanceof CapitalAlreadyInitializedError)) {
      console.error("[capital-engine] Erreur lors de l'initialisation du capital :", err);
    }
  }
}

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

  // Initialisation du capital social à la création du dossier :
  //  - "Reprise de dossier" (client déjà existant) : on marque simplement le
  //    capital comme initialisé, sans écriture — le solde historique sera
  //    repris via la Balance d'Entrée globale (À-nouveaux).
  //  - Création d'entreprise (cas standard) : génération automatique de
  //    l'écriture de constitution (Débit 5211/4613 / Crédit 1013).
  if (client.capitalSocial > 0 && !client.isCapitalInitialized) {
    await initializeClientCapital(client, {
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      ip: req.ip,
    });
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

  // Initialisation du capital social si le capital vient d'être renseigné
  // pour la première fois (n'avait jamais été initialisé) -- que ce soit un
  // apport de constitution (création d'entreprise) ou une reprise de dossier.
  if (
    updated.capitalSocial > 0 &&
    !existing.isCapitalInitialized &&
    !updated.isCapitalInitialized
  ) {
    await initializeClientCapital(updated, {
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      ip: req.ip,
    });
    // Re-fetch to get the latest isCapitalInitialized = true
    const refreshed = await db.query.clientsTable.findFirst({
      where: eq(clientsTable.id, id),
    });
    res.json(UpdateClientResponse.parse(refreshed ?? updated));
    return;
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

// ---------------------------------------------------------------------------
// Reprise de dossier — Saisie de la Balance d'Entrée (À-nouveaux manuels)
// ---------------------------------------------------------------------------

// Lets the frontend decide whether to show the "Saisie de la Balance
// d'Entrée" section for this client/year before the accountant even starts
// filling in the grid.
router.get("/clients/:id/opening-balance-eligibility", async (req, res) => {
  const { id } = GetOpeningBalanceEligibilityParams.parse(req.params);
  const { year } = GetOpeningBalanceEligibilityQueryParams.parse(req.query);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const eligibility = await checkOpeningBalanceEligibility(req.user!.firmId, id, year);
  res.json(GetOpeningBalanceEligibilityResponse.parse(eligibility));
});

// Posts the manual opening balance for a Reprise de dossier client -- a
// single balanced entry dated January 1st of `year`, covering whichever
// Class 1-5 accounts the accountant enters. Never trusts the frontend's own
// balance/eligibility check: every guard is re-verified server-side.
router.post(
  "/clients/:id/opening-balance",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = CreateOpeningBalanceParams.parse(req.params);
    const body = CreateOpeningBalanceBody.parse(req.body);

    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    try {
      const result = await postOpeningBalance(
        req.user!.firmId,
        id,
        req.user!.id,
        client.name,
        body.year,
        body.lines,
      );

      await logAudit({
        firmId: req.user!.firmId,
        userId: req.user!.id,
        userName: req.user!.fullName,
        userRole: req.user!.role,
        action: AuditAction.OPENING_BALANCE_POST,
        entityType: "transaction",
        entityId: result.transactionId,
        details: `Balance d'entrée (Reprise de dossier) comptabilisée pour "${client.name}" — Exercice ${result.year}, ${result.accountsCount} compte(s), ${result.totalAmount.toLocaleString("fr")} FCFA.`,
        ipAddress: req.ip,
      });

      res.status(201).json(CreateOpeningBalanceResponse.parse(result));
    } catch (err) {
      if (
        err instanceof OpeningBalanceNotEligibleError ||
        err instanceof OpeningBalanceEmptyError ||
        err instanceof OpeningBalanceImbalanceError ||
        err instanceof OpeningBalanceInvalidAccountError
      ) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
