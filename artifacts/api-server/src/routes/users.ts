import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, clientsTable } from "@workspace/db";
import {
  ListUsersResponse,
  CreateUserBody,
  CreateUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/auth";
import { requireAuth, requireRole } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.use(requireAuth);

function serializeUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    firmId: user.firmId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    clientId: user.clientId ?? null,
    createdAt: user.createdAt,
  };
}

router.get("/users", async (req, res) => {
  const users = await db.query.usersTable.findMany({
    where: eq(usersTable.firmId, req.user!.firmId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
  res.json(ListUsersResponse.parse(users.map(serializeUser)));
});

router.post("/users", requireRole("expert_comptable"), async (req, res) => {
  const body = CreateUserBody.parse(req.body);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, body.email),
  });
  if (existing) {
    res.status(409).json({ error: "Cet email est déjà utilisé." });
    return;
  }

  // An Espace PME (client_pme) account must be bound to exactly one client
  // dossier in this firm -- that's how portal access is scoped.
  if (body.role === "client_pme") {
    if (!body.clientId) {
      res.status(400).json({
        error: "Un compte Espace PME doit être associé à un dossier client.",
      });
      return;
    }
    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }
  }

  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(usersTable)
    .values({
      firmId: req.user!.firmId,
      email: body.email,
      passwordHash,
      fullName: body.fullName,
      role: body.role,
      clientId: body.role === "client_pme" ? body.clientId : null,
      status: "invited",
    })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "create",
    entityType: "user",
    entityId: user.id,
    details: `Invitation de ${user.fullName} (${user.role})`,
  });

  res.status(201).json(CreateUserResponse.parse(serializeUser(user)));
});

router.patch(
  "/users/:id",
  requireRole("expert_comptable"),
  async (req, res) => {
    const { id } = UpdateUserParams.parse(req.params);
    const body = UpdateUserBody.parse(req.body);

    const existing = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, id), eq(usersTable.firmId, req.user!.firmId)),
    });
    if (!existing) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }

    if (body.clientId) {
      const client = await db.query.clientsTable.findFirst({
        where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
      });
      if (!client) {
        res.status(404).json({ error: "Client introuvable." });
        return;
      }
    }

    const [updated] = await db
      .update(usersTable)
      .set(body)
      .where(eq(usersTable.id, id))
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: "update",
      entityType: "user",
      entityId: id,
    });

    res.json(UpdateUserResponse.parse(serializeUser(updated)));
  },
);

router.delete(
  "/users/:id",
  requireRole("expert_comptable"),
  async (req, res) => {
    const { id } = DeleteUserParams.parse(req.params);

    const existing = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, id), eq(usersTable.firmId, req.user!.firmId)),
    });
    if (!existing) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }

    await db.delete(usersTable).where(eq(usersTable.id, id));

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: "delete",
      entityType: "user",
      entityId: id,
      details: `Suppression de ${existing.fullName}`,
    });

    res.status(204).end();
  },
);

export default router;
