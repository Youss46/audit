import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, rolesTable } from "@workspace/db";
import {
  ListRolesResponse,
  ListStaffResponse,
  CreateStaffBody,
  CreateStaffResponse,
  UpdateStaffParams,
  UpdateStaffBody,
  UpdateStaffResponse,
  DeleteStaffParams,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/auth";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";

// Module M29 (RBAC & Gestion du Personnel PME): the company owner
// ("client_pme" account) manages its own staff ("client_staff") accounts
// here. Only the owner itself may create/edit/remove staff -- there is no
// delegated "staff.manage" permission in this MVP, so a staff account (even
// one with the ADMIN role) can never create further staff. This keeps the
// escalation path simple: exactly one account per client dossier can grant
// access.
const router: IRouter = Router();

router.use(requireAuth);

function serializeStaff(
  user: typeof usersTable.$inferSelect,
  role: typeof rolesTable.$inferSelect | null,
) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    status: user.status,
    roleId: user.roleId,
    roleCode: role?.code ?? null,
    roleLabel: role?.label ?? null,
    createdAt: user.createdAt,
  };
}

// Module M29: catalog of assignable staff roles for the "Ajouter un
// collaborateur" dropdown. System-wide, seeded (see
// lib/db/src/seed-roles.ts) -- not editable from this MVP's UI.
router.get("/roles", requireRole("client_pme"), async (_req, res) => {
  const roles = await db.query.rolesTable.findMany({
    orderBy: (t, { asc }) => [asc(t.id)],
  });
  res.json(
    ListRolesResponse.parse(
      roles.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        description: r.description,
        permissions: r.permissions,
      })),
    ),
  );
});

router.get("/staff", requireRole("client_pme"), async (req, res) => {
  const staff = await db.query.usersTable.findMany({
    where: and(eq(usersTable.clientId, req.user!.clientId!), eq(usersTable.role, "client_staff")),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
    with: { role: true },
  });
  res.json(ListStaffResponse.parse(staff.map((s) => serializeStaff(s, s.role))));
});

router.post("/staff", requireRole("client_pme"), async (req, res) => {
  const body = CreateStaffBody.parse(req.body);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, body.email),
  });
  if (existing) {
    res.status(409).json({ error: "Cet email est déjà utilisé." });
    return;
  }

  const role = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.id, body.roleId),
  });
  if (!role) {
    res.status(404).json({ error: "Rôle introuvable." });
    return;
  }

  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(usersTable)
    .values({
      firmId: req.user!.firmId,
      clientId: req.user!.clientId!,
      roleId: role.id,
      email: body.email,
      passwordHash,
      fullName: body.fullName,
      role: "client_staff",
      status: "active",
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
    details: `Ajout du collaborateur ${user.fullName} (${role.label})`,
    ipAddress: req.ip,
  });

  res.status(201).json(CreateStaffResponse.parse(serializeStaff(user, role)));
});

router.patch("/staff/:id", requireRole("client_pme"), async (req, res) => {
  const { id } = UpdateStaffParams.parse(req.params);
  const body = UpdateStaffBody.parse(req.body);

  const existing = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.id, id),
      eq(usersTable.clientId, req.user!.clientId!),
      eq(usersTable.role, "client_staff"),
    ),
  });
  if (!existing) {
    res.status(404).json({ error: "Collaborateur introuvable." });
    return;
  }

  let role: typeof rolesTable.$inferSelect | null = null;
  if (body.roleId) {
    role = (await db.query.rolesTable.findFirst({ where: eq(rolesTable.id, body.roleId) })) ?? null;
    if (!role) {
      res.status(404).json({ error: "Rôle introuvable." });
      return;
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      fullName: body.fullName,
      status: body.status,
      roleId: body.roleId,
    })
    .where(eq(usersTable.id, id))
    .returning();

  if (!role && updated.roleId) {
    role = (await db.query.rolesTable.findFirst({ where: eq(rolesTable.id, updated.roleId) })) ?? null;
  }

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.USER_UPDATE,
    entityType: "user",
    entityId: id,
    details: `Modification du collaborateur ${updated.fullName}`,
    ipAddress: req.ip,
  });

  res.json(UpdateStaffResponse.parse(serializeStaff(updated, role)));
});

router.delete("/staff/:id", requireRole("client_pme"), async (req, res) => {
  const { id } = DeleteStaffParams.parse(req.params);

  const existing = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.id, id),
      eq(usersTable.clientId, req.user!.clientId!),
      eq(usersTable.role, "client_staff"),
    ),
  });
  if (!existing) {
    res.status(404).json({ error: "Collaborateur introuvable." });
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
    details: `Suppression du collaborateur ${existing.fullName}`,
    ipAddress: req.ip,
  });

  res.status(204).end();
});

export default router;
