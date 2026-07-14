import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, firmsTable, usersTable, rolesTable } from "@workspace/db";
import {
  RegisterBody,
  RegisterResponse,
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
} from "@workspace/api-zod";
import { comparePassword, hashPassword, signToken } from "../lib/auth";
import { requireAuth } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";

const router: IRouter = Router();

function serializeUser(
  user: typeof usersTable.$inferSelect,
  firmName?: string | null,
  role?: typeof rolesTable.$inferSelect | null,
) {
  return {
    id: user.id,
    firmId: user.firmId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    clientId: user.clientId ?? null,
    firmName: firmName ?? null,
    createdAt: user.createdAt,
    // Module M29: only populated for "client_staff" accounts.
    roleId: user.roleId ?? null,
    roleLabel: role?.label ?? null,
    permissions: role?.permissions ?? [],
  };
}

// Module M29: resolves the staff role (and its permission list) for the
// JWT payload and the serialized user. Returns null for every other role.
async function resolveStaffRole(user: typeof usersTable.$inferSelect) {
  if (user.role !== "client_staff" || !user.roleId) return null;
  return (
    (await db.query.rolesTable.findFirst({
      where: eq(rolesTable.id, user.roleId),
    })) ?? null
  );
}

// Creates a new accounting firm and its first Expert-comptable user.
router.post("/auth/register", async (req, res) => {
  const body = RegisterBody.parse(req.body);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, body.email),
  });
  if (existing) {
    res.status(409).json({ error: "Cet email est déjà utilisé." });
    return;
  }

  const [firm] = await db
    .insert(firmsTable)
    .values({ name: body.firmName })
    .returning();

  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(usersTable)
    .values({
      firmId: firm.id,
      email: body.email,
      passwordHash,
      fullName: body.fullName,
      role: "expert_comptable",
      status: "active",
    })
    .returning();

  await logAudit({
    firmId: firm.id,
    userId: user.id,
    userName: user.fullName,
    userRole: user.role,
    action: AuditAction.AUTH_REGISTER,
    entityType: "firm",
    entityId: firm.id,
    details: `Création du cabinet "${firm.name}"`,
    ipAddress: req.ip,
  });

  const token = signToken({
    id: user.id,
    firmId: user.firmId,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
    clientId: user.clientId,
  });

  res.status(201).json(
    RegisterResponse.parse({ token, user: serializeUser(user, firm.name) }),
  );
});

// Authenticates a user and returns a fresh JWT.
router.post("/auth/login", async (req, res) => {
  const body = LoginBody.parse(req.body);

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, body.email),
  });
  if (!user || user.status === "disabled") {
    res.status(401).json({ error: "Email ou mot de passe incorrect." });
    return;
  }

  const valid = await comparePassword(body.password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Email ou mot de passe incorrect." });
    return;
  }

  await logAudit({
    firmId: user.firmId,
    userId: user.id,
    userName: user.fullName,
    userRole: user.role,
    action: AuditAction.AUTH_LOGIN,
    entityType: "user",
    entityId: user.id,
    ipAddress: req.ip,
  });

  const staffRole = await resolveStaffRole(user);
  const token = signToken({
    id: user.id,
    firmId: user.firmId,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
    clientId: user.clientId,
    roleId: user.roleId,
    permissions: staffRole?.permissions ?? [],
  });

  const firm = await db.query.firmsTable.findFirst({
    where: eq(firmsTable.id, user.firmId),
  });
  res.json(LoginResponse.parse({ token, user: serializeUser(user, firm?.name, staffRole) }));
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, req.user!.id),
  });
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable." });
    return;
  }
  const firm = await db.query.firmsTable.findFirst({
    where: eq(firmsTable.id, user.firmId),
  });
  const staffRole = await resolveStaffRole(user);
  res.json(GetCurrentUserResponse.parse(serializeUser(user, firm?.name, staffRole)));
});

export default router;
