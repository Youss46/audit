import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, clientsTable, firmsTable } from "@workspace/db";
import {
  ListUsersResponse,
  CreateUserBody,
  CreateUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
} from "@workspace/api-zod";
import { generateTemporaryPassword, hashPassword } from "../lib/auth";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { sendMail, mailInvitation } from "../lib/mailer";
import { auditInterceptor } from "../middlewares/audit-interceptor";

const router: IRouter = Router();

router.use(requireAuth);
// Module M14: safety net for the "Users" critical module -- see
// middlewares/audit-interceptor.ts.
router.use(auditInterceptor("user"));

function serializeUser(
  user: typeof usersTable.$inferSelect,
  temporaryPassword?: string,
) {
  return {
    id: user.id,
    firmId: user.firmId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    clientId: user.clientId ?? null,
    createdAt: user.createdAt,
    // Module M33: only populated right after creation, below -- never on
    // list/update/delete.
    temporaryPassword: temporaryPassword ?? null,
  };
}

router.get("/users", async (req, res) => {
  const users = await db.query.usersTable.findMany({
    where: eq(usersTable.firmId, req.user!.firmId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
  res.json(ListUsersResponse.parse(users.map((u) => serializeUser(u))));
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

  // Module M33: the admin no longer chooses the password -- a temporary
  // one is generated here, hashed for storage, and returned once (plus
  // kept in temporaryPasswordPlain) so it can be handed to the new user.
  // The account must replace it on first login (see /auth/login and
  // /auth/reset-first-password).
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
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
      requiresPasswordChange: true,
      temporaryPasswordPlain: temporaryPassword,
    })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.USER_CREATE,
    entityType: "user",
    entityId: user.id,
    details: `Invitation de ${user.fullName} (${user.role})`,
    ipAddress: req.ip,
  });

  const firm = await db.query.firmsTable.findFirst({
    where: eq(firmsTable.id, req.user!.firmId),
    columns: { name: true },
  });
  const loginUrl = `${process.env.FRONTEND_URL ?? "https://audit.m15-edutech.ci"}/login`;
  sendMail(mailInvitation({
    to: user.email,
    fullName: user.fullName,
    firmName: firm?.name ?? "M15-AUDIT",
    temporaryPassword,
    loginUrl,
  })).catch(() => {});

  res
    .status(201)
    .json(CreateUserResponse.parse(serializeUser(user, temporaryPassword)));
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
      userRole: req.user!.role,
      action: AuditAction.USER_UPDATE,
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
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
      userRole: req.user!.role,
      action: AuditAction.USER_DELETE,
      entityType: "user",
      entityId: id,
      details: `Suppression de ${existing.fullName}`,
      ipAddress: req.ip,
    });

    res.status(204).end();
  },
);

export default router;
