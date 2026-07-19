import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, pumpAssignmentsTable, pumpsTable, usersTable } from "@workspace/db";
import {
  ListPumpAssignmentsQueryParams,
  CreatePumpAssignmentBody,
  DeletePumpAssignmentParams,
  GetMyPumpAssignmentsQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";

// Module P7 (Attributions de pompes): links a pompiste to a pump for one
// service day.  The PME owner creates assignments before each shift; the
// pompiste then fetches their own via GET /pump-assignments/my so the
// pump-index UI can restrict the selection and the server can validate it.

const router: IRouter = Router();
router.use(requireAuth);

function todayISO(): string {
  // Server-local "YYYY-MM-DD" for Africa/Abidjan-ish deployments.
  // Using UTC date keeps things simple and consistent with the client.
  return new Date().toISOString().split("T")[0];
}

function requirePmeOwner(req: any, res: any): boolean {
  if (req.user?.role !== "client_pme") {
    res.status(403).json({ error: "Réservé au propriétaire du dossier PME." });
    return false;
  }
  return true;
}

function dateToISO(d: Date | string): string {
  if (typeof d === "string") return d;
  return d.toISOString().split("T")[0];
}

// GET /pump-assignments?clientId=&date= -- PME owner lists assignments for a day
router.get("/pump-assignments", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const params = ListPumpAssignmentsQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, params.clientId)) return;

  const shiftDate = params.date ? dateToISO(params.date as any) : todayISO();

  const rows = await db.query.pumpAssignmentsTable.findMany({
    where: and(
      eq(pumpAssignmentsTable.clientId, params.clientId),
      eq(pumpAssignmentsTable.shiftDate, shiftDate),
    ),
    with: { pump: true, staffUser: true },
  });

  res.json(
    rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      pumpId: r.pumpId,
      pumpLabel: r.pump.label,
      fuelType: r.pump.fuelType,
      staffUserId: r.staffUserId,
      staffName: r.staffUser.fullName,
      shiftDate: r.shiftDate,
      createdAt: r.createdAt,
    })),
  );
});

// GET /pump-assignments/my?clientId= -- pompiste fetches their own assignments for today
// This must be registered BEFORE the /:id DELETE route so Express doesn't
// interpret "my" as an integer id.
router.get("/pump-assignments/my", async (req, res) => {
  const params = GetMyPumpAssignmentsQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, params.clientId)) return;

  const today = todayISO();

  const rows = await db.query.pumpAssignmentsTable.findMany({
    where: and(
      eq(pumpAssignmentsTable.staffUserId, req.user!.id),
      eq(pumpAssignmentsTable.shiftDate, today),
      eq(pumpAssignmentsTable.clientId, params.clientId),
    ),
    with: { pump: true },
  });

  res.json(
    rows.map((r) => ({
      id: r.id,
      pumpId: r.pumpId,
      label: r.pump.label,
      fuelType: r.pump.fuelType,
      shiftDate: r.shiftDate,
    })),
  );
});

// POST /pump-assignments -- PME owner creates an assignment
router.post("/pump-assignments", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const body = CreatePumpAssignmentBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const shiftDate = dateToISO(body.shiftDate as any);

  // Verify the pump belongs to this client
  const pump = await db.query.pumpsTable.findFirst({
    where: and(eq(pumpsTable.id, body.pumpId), eq(pumpsTable.clientId, body.clientId)),
  });
  if (!pump) {
    res.status(404).json({ error: "Pompe introuvable." });
    return;
  }

  // Verify the staff member belongs to this client
  const staff = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.id, body.staffUserId),
      eq(usersTable.clientId, body.clientId),
      eq(usersTable.role, "client_staff"),
    ),
  });
  if (!staff) {
    res.status(404).json({ error: "Collaborateur introuvable." });
    return;
  }

  // Prevent duplicate assignments (same staff + same pump + same day)
  const existing = await db.query.pumpAssignmentsTable.findFirst({
    where: and(
      eq(pumpAssignmentsTable.staffUserId, body.staffUserId),
      eq(pumpAssignmentsTable.pumpId, body.pumpId),
      eq(pumpAssignmentsTable.shiftDate, shiftDate),
    ),
  });
  if (existing) {
    res.status(409).json({ error: "Cette attribution existe déjà pour cette date." });
    return;
  }

  const [assignment] = await db
    .insert(pumpAssignmentsTable)
    .values({
      clientId: body.clientId,
      pumpId: body.pumpId,
      staffUserId: body.staffUserId,
      shiftDate,
    })
    .returning();

  res.status(201).json({
    id: assignment.id,
    clientId: assignment.clientId,
    pumpId: assignment.pumpId,
    pumpLabel: pump.label,
    fuelType: pump.fuelType,
    staffUserId: assignment.staffUserId,
    staffName: staff.fullName,
    shiftDate: assignment.shiftDate,
    createdAt: assignment.createdAt,
  });
});

// DELETE /pump-assignments/:id -- PME owner removes an assignment
router.delete("/pump-assignments/:id", async (req, res) => {
  if (!requirePmeOwner(req, res)) return;
  const { id } = DeletePumpAssignmentParams.parse(req.params);

  const existing = await db.query.pumpAssignmentsTable.findFirst({
    where: eq(pumpAssignmentsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Attribution introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, existing.clientId)) return;

  await db.delete(pumpAssignmentsTable).where(eq(pumpAssignmentsTable.id, id));
  res.status(204).send();
});

export default router;
