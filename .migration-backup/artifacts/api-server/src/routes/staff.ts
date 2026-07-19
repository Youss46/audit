import { Router, type IRouter } from "express";
import { and, eq, like } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  clientsTable,
  cashRegistersTable,
  accountsTable,
  STATION_SERVICE_CASH_SUB_ACCOUNT_PREFIX,
} from "@workspace/db";
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
import { generateTemporaryPassword, hashPassword } from "../lib/auth";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";

// Module P6 (Un Pompiste = Une Caisse): picks the next free SYSCOHADA
// sub-account for a STATION_SERVICE client's per-pompiste cash drawer --
// "571101", "571102", etc. Scans ALL registers ever created for this
// client (not just active ones) so a disabled/removed pompiste's number is
// never reused, which would otherwise corrupt that account's historical
// ledger trail.
async function allocateStationServiceCashAccount(clientId: number): Promise<string> {
  const existing = await db.query.cashRegistersTable.findMany({
    where: and(
      eq(cashRegistersTable.clientId, clientId),
      like(cashRegistersTable.syscohadaAccount, `${STATION_SERVICE_CASH_SUB_ACCOUNT_PREFIX}%`),
    ),
    columns: { syscohadaAccount: true },
  });
  const usedSuffixes = existing
    .map((r) => r.syscohadaAccount)
    .filter((acc): acc is string => !!acc)
    .map((acc) => parseInt(acc.slice(STATION_SERVICE_CASH_SUB_ACCOUNT_PREFIX.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = usedSuffixes.length > 0 ? Math.max(...usedSuffixes) + 1 : 1;
  return `${STATION_SERVICE_CASH_SUB_ACCOUNT_PREFIX}${String(next).padStart(2, "0")}`;
}

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
  temporaryPassword?: string,
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
    // Module P6: null unless this account is a POMPISTE with a dedicated
    // cash drawer (see allocateStationServiceCashAccount below).
    associatedCashAccountNumber: user.associatedCashAccountNumber ?? null,
    // Module M33: only populated right after creation, below -- never on
    // list/update/delete.
    temporaryPassword: temporaryPassword ?? null,
  };
}

// Module M29: catalog of assignable staff roles for the "Ajouter un
// collaborateur" dropdown. System-wide, seeded (see
// lib/db/src/seed-roles.ts) -- not editable from this MVP's UI.
//
// Sector-aware filtering:
//   - POMPISTE     is shown ONLY for STATION_SERVICE clients.
//   - AGENT_TERRAIN is shown for every other sector.
// This keeps the dropdown free of irrelevant roles without changing the
// underlying permissions model.
router.get("/roles", requireRole("client_pme"), async (req, res) => {
  // Resolve the client's activity sector to decide which field-agent role
  // variant to expose.
  let clientSector: string | null = null;
  if (req.user!.clientId) {
    const client = await db.query.clientsTable.findFirst({
      where: eq(clientsTable.id, req.user!.clientId),
      columns: { sector: true },
    });
    clientSector = client?.sector ?? null;
  }

  const isStationService = clientSector === "STATION_SERVICE";
  // For station-service clients: hide AGENT_TERRAIN (Pompiste is the
  // sector-specific equivalent). For every other sector: hide POMPISTE.
  const excludedCode = isStationService ? "AGENT_TERRAIN" : "POMPISTE";

  const roles = await db.query.rolesTable.findMany({
    where: (t, { ne }) => ne(t.code, excludedCode),
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

  // Module M33: the owner no longer chooses the password -- a temporary
  // one is generated here, hashed for storage, and returned once (plus
  // kept in temporaryPasswordPlain) so it can be handed to the new staff
  // member. The account must replace it on first login (see /auth/login
  // and /auth/reset-first-password).
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  // Module P6 (Un Pompiste = Une Caisse): a POMPISTE hired for a
  // STATION_SERVICE client automatically gets their own cash drawer, wired
  // to a personal SYSCOHADA sub-account -- never the shared 571 account.
  // Everything below runs in one transaction so a failure partway through
  // (e.g. the account-number race) never leaves an orphaned user with no
  // register, or vice versa.
  const client = await db.query.clientsTable.findFirst({
    where: eq(clientsTable.id, req.user!.clientId!),
    columns: { sector: true },
  });
  const needsCashDrawer = client?.sector === "STATION_SERVICE" && role.code === "POMPISTE";

  const { user, cashAccountNumber } = await db.transaction(async (tx) => {
    const [insertedUser] = await tx
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
        requiresPasswordChange: true,
        temporaryPasswordPlain: temporaryPassword,
      })
      .returning();

    if (!needsCashDrawer) {
      return { user: insertedUser, cashAccountNumber: null as string | null };
    }

    const accountNumber = await allocateStationServiceCashAccount(req.user!.clientId!);

    await tx.insert(cashRegistersTable).values({
      name: `Caisse ${insertedUser.fullName}`,
      clientId: req.user!.clientId!,
      syscohadaAccount: accountNumber,
      isActive: true,
      ownerUserId: insertedUser.id,
    });

    // Sync into the (shared/global) chart of accounts so the number shows
    // up in ledger reports even before any transaction posts to it.
    // onConflictDoNothing: the global accountsTable is not per-tenant, so
    // if another client's pompiste ever produced the same numeric suffix
    // (shouldn't happen -- numbering is per-client -- but the table has no
    // per-client scoping to enforce that), we must never overwrite an
    // existing label with this employee's name.
    await tx
      .insert(accountsTable)
      .values({ accountNumber, name: `Caisse ${insertedUser.fullName}`, accountClass: 5 })
      .onConflictDoNothing();

    const [withCashAccount] = await tx
      .update(usersTable)
      .set({ associatedCashAccountNumber: accountNumber })
      .where(eq(usersTable.id, insertedUser.id))
      .returning();

    return { user: withCashAccount, cashAccountNumber: accountNumber };
  });

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

  if (cashAccountNumber) {
    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.CASH_REGISTER_CREATE,
      entityType: "cash_register",
      details: `Caisse dédiée créée pour ${user.fullName} (compte ${cashAccountNumber})`,
      ipAddress: req.ip,
    });
  }

  res
    .status(201)
    .json(
      CreateStaffResponse.parse(serializeStaff(user, role, temporaryPassword)),
    );
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
