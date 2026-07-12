import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, firmsTable, usersTable } from "@workspace/db";
import {
  RegisterBody,
  RegisterResponse,
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
} from "@workspace/api-zod";
import { comparePassword, hashPassword, signToken } from "../lib/auth";
import { requireAuth } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

function serializeUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    firmId: user.firmId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

// Creates a new accounting firm and its first Expert-comptable user.
router.post("/auth/register", async (req, res) => {
  const body = RegisterBody.parse(req.body);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, body.email),
  });
  if (existing) {
    res.status(409).json({ message: "Cet email est déjà utilisé." });
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
    action: "register",
    entityType: "firm",
    entityId: firm.id,
    details: `Création du cabinet "${firm.name}"`,
  });

  const token = signToken({
    id: user.id,
    firmId: user.firmId,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
  });

  res.status(201).json(
    RegisterResponse.parse({ token, user: serializeUser(user) }),
  );
});

// Authenticates a user and returns a fresh JWT.
router.post("/auth/login", async (req, res) => {
  const body = LoginBody.parse(req.body);

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, body.email),
  });
  if (!user || user.status === "disabled") {
    res.status(401).json({ message: "Email ou mot de passe incorrect." });
    return;
  }

  const valid = await comparePassword(body.password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: "Email ou mot de passe incorrect." });
    return;
  }

  await logAudit({
    firmId: user.firmId,
    userId: user.id,
    userName: user.fullName,
    action: "login",
    entityType: "user",
    entityId: user.id,
  });

  const token = signToken({
    id: user.id,
    firmId: user.firmId,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
  });

  res.json(LoginResponse.parse({ token, user: serializeUser(user) }));
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, req.user!.id),
  });
  if (!user) {
    res.status(404).json({ message: "Utilisateur introuvable." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(serializeUser(user)));
});

export default router;
