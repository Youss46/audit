import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, firmsTable, usersTable, rolesTable, stationsTable } from "@workspace/db";
import {
  RegisterBody,
  RegisterResponse,
  LoginBody,
  LoginResponse,
  ResetFirstPasswordBody,
  ResetFirstPasswordResponse,
  GetCurrentUserResponse,
} from "@workspace/api-zod";
import {
  comparePassword,
  hashPassword,
  isStrongPassword,
  signRestrictedPasswordResetToken,
  signToken,
} from "../lib/auth";
import { requireAuth, requirePasswordResetAuth } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";

const router: IRouter = Router();

function serializeUser(
  user: typeof usersTable.$inferSelect,
  firmName?: string | null,
  role?: typeof rolesTable.$inferSelect | null,
  station?: typeof stationsTable.$inferSelect | null,
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
    roleCode: role?.code ?? null,
    roleLabel: role?.label ?? null,
    permissions: role?.permissions ?? [],
    // Multi-station (P8): only set for site-restricted staff.
    stationId: user.stationId ?? null,
    stationName: station?.name ?? null,
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

// Multi-station (P8): resolves the station for site-restricted staff.
async function resolveStation(user: typeof usersTable.$inferSelect) {
  if (!user.stationId) return null;
  return (
    (await db.query.stationsTable.findFirst({
      where: eq(stationsTable.id, user.stationId),
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
      // Module M33: the owner chose this password themselves at
      // registration, so there is nothing to force-reset.
      requiresPasswordChange: false,
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
    RegisterResponse.parse({ status: "OK", token, user: serializeUser(user, firm.name) }),
  );
});

// Authenticates a user and returns a fresh JWT -- or, module M33, a
// restricted password-reset token if the account still has an unresolved
// temporary password.
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

  // Module M33: the account was created by an admin with an auto-generated
  // temporary password and hasn't replaced it yet -- issue a restricted
  // token that only works against POST /auth/reset-first-password instead
  // of a normal session.
  if (user.requiresPasswordChange) {
    const token = signRestrictedPasswordResetToken({
      id: user.id,
      firmId: user.firmId,
      role: user.role,
      email: user.email,
      fullName: user.fullName,
    });
    res.json(LoginResponse.parse({ status: "FORCE_PASSWORD_CHANGE", token }));
    return;
  }

  const [staffRole, station, firm] = await Promise.all([
    resolveStaffRole(user),
    resolveStation(user),
    db.query.firmsTable.findFirst({ where: eq(firmsTable.id, user.firmId) }),
  ]);
  const token = signToken({
    id: user.id,
    firmId: user.firmId,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
    clientId: user.clientId,
    roleId: user.roleId,
    permissions: staffRole?.permissions ?? [],
    stationId: user.stationId ?? null,
  });

  res.json(
    LoginResponse.parse({
      status: "OK",
      token,
      user: serializeUser(user, firm?.name, staffRole, station),
    }),
  );
});

// Module M33: exchanges a restricted first-login token for a full session
// by setting a new password. Only reachable with the restricted token
// returned above -- requirePasswordResetAuth rejects everything else.
router.post(
  "/auth/reset-first-password",
  requirePasswordResetAuth,
  async (req, res) => {
    const body = ResetFirstPasswordBody.parse(req.body);

    if (body.newPassword !== body.confirmPassword) {
      res.status(400).json({ error: "Les deux mots de passe ne correspondent pas." });
      return;
    }
    if (!isStrongPassword(body.newPassword)) {
      res.status(400).json({
        error:
          "Le mot de passe doit contenir au moins 8 caractères, un chiffre et un caractère spécial.",
      });
      return;
    }

    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, req.user!.id),
    });
    if (!user) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }
    // The JWT scope check alone only proves this token was minted for a
    // first-login reset -- it stays cryptographically valid for its full
    // 15-minute lifetime even after being used once. Re-checking the DB
    // flag here closes that window: once requiresPasswordChange is false,
    // the same token can never reset the password again.
    if (!user.requiresPasswordChange) {
      res.status(400).json({
        error: "Ce lien de réinitialisation a déjà été utilisé. Veuillez vous reconnecter.",
      });
      return;
    }

    const passwordHash = await hashPassword(body.newPassword);
    const [updated] = await db
      .update(usersTable)
      .set({
        passwordHash,
        requiresPasswordChange: false,
        temporaryPasswordPlain: null,
        // The account has now actually logged in and set its own
        // password -- no longer merely "invited".
        status: user.status === "invited" ? "active" : user.status,
      })
      .where(eq(usersTable.id, user.id))
      .returning();

    await logAudit({
      firmId: updated.firmId,
      userId: updated.id,
      userName: updated.fullName,
      userRole: updated.role,
      action: AuditAction.AUTH_FORCED_PASSWORD_RESET,
      entityType: "user",
      entityId: updated.id,
      details: "Première connexion : remplacement du mot de passe temporaire.",
      ipAddress: req.ip,
    });

    const [staffRole, station, firm] = await Promise.all([
      resolveStaffRole(updated),
      resolveStation(updated),
      db.query.firmsTable.findFirst({ where: eq(firmsTable.id, updated.firmId) }),
    ]);
    const token = signToken({
      id: updated.id,
      firmId: updated.firmId,
      role: updated.role,
      email: updated.email,
      fullName: updated.fullName,
      clientId: updated.clientId,
      roleId: updated.roleId,
      permissions: staffRole?.permissions ?? [],
      stationId: updated.stationId ?? null,
    });

    res.json(
      ResetFirstPasswordResponse.parse({
        status: "OK",
        token,
        user: serializeUser(updated, firm?.name, staffRole, station),
      }),
    );
  },
);

router.get("/auth/me", requireAuth, async (req, res) => {
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, req.user!.id),
  });
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable." });
    return;
  }
  const [firm, staffRole, station] = await Promise.all([
    db.query.firmsTable.findFirst({ where: eq(firmsTable.id, user.firmId) }),
    resolveStaffRole(user),
    resolveStation(user),
  ]);
  res.json(GetCurrentUserResponse.parse(serializeUser(user, firm?.name, staffRole, station)));
});

export default router;
