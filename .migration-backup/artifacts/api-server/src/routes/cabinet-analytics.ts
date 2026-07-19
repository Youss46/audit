import { Router, type IRouter } from "express";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  usersTable,
  clientsTable,
  firmsTable,
  cabinetUserRatesTable,
  clientContractsTable,
  timesheetEntriesTable,
  missionExpensesTable,
  TASK_TYPES,
  type TaskType,
} from "@workspace/db";
import { generateProfitabilityPdf } from "../lib/export-engine";
import {
  UpsertUserRateParams,
  UpsertUserRateBody,
  ListClientContractsQueryParams,
  CreateClientContractBody,
  UpdateClientContractParams,
  UpdateClientContractBody,
  DeleteClientContractParams,
  ListTimesheetEntriesQueryParams,
  CreateTimesheetEntryBody,
  UpdateTimesheetEntryParams,
  UpdateTimesheetEntryBody,
  DeleteTimesheetEntryParams,
  GetProfitabilityReportParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeRate(
  rate: typeof cabinetUserRatesTable.$inferSelect,
  userFullName: string,
) {
  return {
    id: rate.id,
    firmId: rate.firmId,
    userId: rate.userId,
    userFullName,
    hourlyCostRate: rate.hourlyCostRate,
    billingHourlyRate: rate.billingHourlyRate,
    createdAt: rate.createdAt,
    updatedAt: rate.updatedAt,
  };
}

function serializeContract(
  contract: typeof clientContractsTable.$inferSelect,
  clientName: string,
) {
  return {
    id: contract.id,
    firmId: contract.firmId,
    clientId: contract.clientId,
    clientName,
    monthlyFlatFee: contract.monthlyFlatFee,
    startDate: contract.startDate,
    endDate: contract.endDate ?? null,
    createdAt: contract.createdAt,
  };
}

function serializeEntry(
  entry: typeof timesheetEntriesTable.$inferSelect,
  userFullName: string,
  clientName: string,
) {
  return {
    id: entry.id,
    firmId: entry.firmId,
    userId: entry.userId,
    userFullName,
    clientId: entry.clientId,
    clientName,
    date: entry.date,
    durationHours: entry.durationHours,
    taskType: entry.taskType,
    description: entry.description ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /cabinet-analytics/rates — list all collaborator rates for this firm
// ---------------------------------------------------------------------------

router.get("/cabinet-analytics/rates", requireRole("expert_comptable", "collaborateur", "stagiaire"), async (req, res) => {
  const rates = await db.query.cabinetUserRatesTable.findMany({
    where: eq(cabinetUserRatesTable.firmId, req.user!.firmId),
    with: { user: true },
    orderBy: (t, { asc }) => [asc(t.userId)],
  });

  res.json(rates.map((r) => serializeRate(r, r.user?.fullName ?? "—")));
});

// ---------------------------------------------------------------------------
// PUT /cabinet-analytics/rates/:userId — upsert a collaborator's rates
// ---------------------------------------------------------------------------

router.put("/cabinet-analytics/rates/:userId", requireRole("expert_comptable"), async (req, res) => {
  const { userId } = UpsertUserRateParams.parse(req.params);
  const body = UpsertUserRateBody.parse(req.body);

  const user = await db.query.usersTable.findFirst({
    where: and(eq(usersTable.id, userId), eq(usersTable.firmId, req.user!.firmId)),
  });
  if (!user) {
    res.status(404).json({ error: "Collaborateur introuvable." });
    return;
  }

  const existing = await db.query.cabinetUserRatesTable.findFirst({
    where: and(
      eq(cabinetUserRatesTable.userId, userId),
      eq(cabinetUserRatesTable.firmId, req.user!.firmId),
    ),
  });

  let rate: typeof cabinetUserRatesTable.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(cabinetUserRatesTable)
      .set({ hourlyCostRate: body.hourlyCostRate, billingHourlyRate: body.billingHourlyRate })
      .where(eq(cabinetUserRatesTable.id, existing.id))
      .returning();
    rate = updated;
  } else {
    const [inserted] = await db
      .insert(cabinetUserRatesTable)
      .values({
        firmId: req.user!.firmId,
        userId,
        hourlyCostRate: body.hourlyCostRate,
        billingHourlyRate: body.billingHourlyRate,
      })
      .returning();
    rate = inserted;
  }

  res.json(serializeRate(rate, user.fullName));
});

// ---------------------------------------------------------------------------
// GET /cabinet-analytics/contracts — list client forfait contracts
// ---------------------------------------------------------------------------

router.get("/cabinet-analytics/contracts", requireRole("expert_comptable", "collaborateur", "stagiaire"), async (req, res) => {
  const { clientId } = ListClientContractsQueryParams.parse(req.query);

  const contracts = await db.query.clientContractsTable.findMany({
    where: and(
      eq(clientContractsTable.firmId, req.user!.firmId),
      clientId ? eq(clientContractsTable.clientId, clientId) : undefined,
    ),
    with: { client: true },
    orderBy: (t, { desc }) => [desc(t.startDate)],
  });

  res.json(contracts.map((c) => serializeContract(c, c.client?.name ?? "—")));
});

// ---------------------------------------------------------------------------
// POST /cabinet-analytics/contracts — create a forfait contract
// ---------------------------------------------------------------------------

router.post("/cabinet-analytics/contracts", requireRole("expert_comptable"), async (req, res) => {
  const body = CreateClientContractBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const [contract] = await db
    .insert(clientContractsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: body.clientId,
      monthlyFlatFee: body.monthlyFlatFee,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : null,
    })
    .returning();

  res.status(201).json(serializeContract(contract, client.name));
});

// ---------------------------------------------------------------------------
// PATCH /cabinet-analytics/contracts/:id — update a forfait contract
// ---------------------------------------------------------------------------

router.patch("/cabinet-analytics/contracts/:id", requireRole("expert_comptable"), async (req, res) => {
  const { id } = UpdateClientContractParams.parse(req.params);
  const body = UpdateClientContractBody.parse(req.body);

  const existing = await db.query.clientContractsTable.findFirst({
    where: and(eq(clientContractsTable.id, id), eq(clientContractsTable.firmId, req.user!.firmId)),
    with: { client: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Contrat introuvable." });
    return;
  }

  const updates: Partial<typeof clientContractsTable.$inferInsert> = {};
  if (body.monthlyFlatFee !== undefined) updates.monthlyFlatFee = body.monthlyFlatFee;
  if ("endDate" in body) updates.endDate = body.endDate ? new Date(body.endDate) : null;

  const [updated] = await db
    .update(clientContractsTable)
    .set(updates)
    .where(eq(clientContractsTable.id, id))
    .returning();

  res.json(serializeContract(updated, existing.client?.name ?? "—"));
});

// ---------------------------------------------------------------------------
// DELETE /cabinet-analytics/contracts/:id — delete a contract
// ---------------------------------------------------------------------------

router.delete("/cabinet-analytics/contracts/:id", requireRole("expert_comptable"), async (req, res) => {
  const { id } = DeleteClientContractParams.parse(req.params);

  const existing = await db.query.clientContractsTable.findFirst({
    where: and(eq(clientContractsTable.id, id), eq(clientContractsTable.firmId, req.user!.firmId)),
  });
  if (!existing) {
    res.status(404).json({ error: "Contrat introuvable." });
    return;
  }

  await db.delete(clientContractsTable).where(eq(clientContractsTable.id, id));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// GET /cabinet-analytics/timesheet-entries — list entries
// ---------------------------------------------------------------------------

router.get("/cabinet-analytics/timesheet-entries", requireRole("expert_comptable", "collaborateur", "stagiaire"), async (req, res) => {
  const params = ListTimesheetEntriesQueryParams.parse(req.query);
  // dateFrom/dateTo are plain strings in the schema (not format: date-time)
  // -- see openapi.yaml for why -- so they need to be parsed into Dates
  // here rather than relying on the generated zod schema to coerce them.
  const dateFrom = params.dateFrom ? new Date(params.dateFrom) : undefined;
  const dateTo = params.dateTo ? new Date(params.dateTo) : undefined;

  // Non-expert callers always see their own entries only.
  const effectiveUserId =
    req.user!.role === "expert_comptable" ? params.userId : req.user!.id;

  const entries = await db.query.timesheetEntriesTable.findMany({
    where: and(
      eq(timesheetEntriesTable.firmId, req.user!.firmId),
      effectiveUserId ? eq(timesheetEntriesTable.userId, effectiveUserId) : undefined,
      params.clientId ? eq(timesheetEntriesTable.clientId, params.clientId) : undefined,
      dateFrom ? gte(timesheetEntriesTable.date, dateFrom) : undefined,
      dateTo ? lte(timesheetEntriesTable.date, dateTo) : undefined,
    ),
    with: { user: true, client: true },
    orderBy: (t, { desc }) => [desc(t.date)],
  });

  res.json(
    entries.map((e) => serializeEntry(e, e.user?.fullName ?? "—", e.client?.name ?? "—")),
  );
});

// ---------------------------------------------------------------------------
// POST /cabinet-analytics/timesheet-entries — log a new entry
// ---------------------------------------------------------------------------

router.post("/cabinet-analytics/timesheet-entries", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const body = CreateTimesheetEntryBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const [entry] = await db
    .insert(timesheetEntriesTable)
    .values({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      clientId: body.clientId,
      date: new Date(body.date),
      durationHours: body.durationHours,
      taskType: body.taskType,
      description: body.description ?? null,
    })
    .returning();

  res.status(201).json(serializeEntry(entry, req.user!.fullName, client.name));
});

// ---------------------------------------------------------------------------
// PATCH /cabinet-analytics/timesheet-entries/:id — update an entry
// ---------------------------------------------------------------------------

router.patch("/cabinet-analytics/timesheet-entries/:id", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const { id } = UpdateTimesheetEntryParams.parse(req.params);
  const body = UpdateTimesheetEntryBody.parse(req.body);

  const existing = await db.query.timesheetEntriesTable.findFirst({
    where: and(
      eq(timesheetEntriesTable.id, id),
      eq(timesheetEntriesTable.firmId, req.user!.firmId),
    ),
    with: { user: true, client: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Entrée introuvable." });
    return;
  }

  // Non-expert callers can only edit their own entries.
  if (req.user!.role !== "expert_comptable" && existing.userId !== req.user!.id) {
    res.status(403).json({ error: "Vous ne pouvez modifier que vos propres saisies." });
    return;
  }

  const updates: Partial<typeof timesheetEntriesTable.$inferInsert> = {};
  if (body.clientId !== undefined) {
    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }
    updates.clientId = body.clientId;
  }
  if (body.date !== undefined) updates.date = new Date(body.date);
  if (body.durationHours !== undefined) updates.durationHours = body.durationHours;
  if (body.taskType !== undefined) updates.taskType = body.taskType;
  if ("description" in body) updates.description = body.description ?? null;

  const [updated] = await db
    .update(timesheetEntriesTable)
    .set(updates)
    .where(eq(timesheetEntriesTable.id, id))
    .returning();

  const clientName =
    updates.clientId !== undefined
      ? (await db.query.clientsTable.findFirst({ where: eq(clientsTable.id, updated.clientId) }))?.name ?? "—"
      : existing.client?.name ?? "—";

  res.json(serializeEntry(updated, existing.user?.fullName ?? req.user!.fullName, clientName));
});

// ---------------------------------------------------------------------------
// DELETE /cabinet-analytics/timesheet-entries/:id — delete an entry
// ---------------------------------------------------------------------------

router.delete("/cabinet-analytics/timesheet-entries/:id", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const { id } = DeleteTimesheetEntryParams.parse(req.params);

  const existing = await db.query.timesheetEntriesTable.findFirst({
    where: and(
      eq(timesheetEntriesTable.id, id),
      eq(timesheetEntriesTable.firmId, req.user!.firmId),
    ),
  });
  if (!existing) {
    res.status(404).json({ error: "Entrée introuvable." });
    return;
  }

  if (req.user!.role !== "expert_comptable" && existing.userId !== req.user!.id) {
    res.status(403).json({ error: "Vous ne pouvez supprimer que vos propres saisies." });
    return;
  }

  await db.delete(timesheetEntriesTable).where(eq(timesheetEntriesTable.id, id));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// GET /cabinet-analytics/profitability/:year/:month — compute per-client KPIs
// ---------------------------------------------------------------------------

router.get("/cabinet-analytics/profitability/:year/:month", requireRole("expert_comptable"), async (req, res) => {
  const { year, month } = GetProfitabilityReportParams.parse(req.params);

  // Build the [startOfMonth, endOfMonth] window.
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999); // last day inclusive

  // 1. All timesheet entries for the firm in this month.
  const entries = await db.query.timesheetEntriesTable.findMany({
    where: and(
      eq(timesheetEntriesTable.firmId, req.user!.firmId),
      gte(timesheetEntriesTable.date, monthStart),
      lte(timesheetEntriesTable.date, monthEnd),
    ),
    with: { client: true },
  });

  if (entries.length === 0) {
    res.json({
      year,
      month,
      globalKpis: { totalHours: 0, totalInternalCost: 0, totalFees: 0, grossMargin: 0, grossMarginPct: null },
      rows: [],
      taskBreakdown: [],
    });
    return;
  }

  // 2. Load all rates for users that appear in entries.
  const userIdsInEntries = [...new Set(entries.map((e) => e.userId))];
  const rates = await db.query.cabinetUserRatesTable.findMany({
    where: and(
      eq(cabinetUserRatesTable.firmId, req.user!.firmId),
    ),
  });
  const rateByUserId = new Map(rates.map((r) => [r.userId, r]));

  // 3. Load active forfait contracts for the month for each client.
  const clientIdsInEntries = [...new Set(entries.map((e) => e.clientId))];
  const contracts = await db.query.clientContractsTable.findMany({
    where: and(
      eq(clientContractsTable.firmId, req.user!.firmId),
      lte(clientContractsTable.startDate, monthEnd),
      or(isNull(clientContractsTable.endDate), gte(clientContractsTable.endDate, monthStart)),
    ),
  });
  // If a client has multiple overlapping contracts (renegotiated), pick the
  // most recent one by startDate.
  const contractByClientId = new Map<number, typeof clientContractsTable.$inferSelect>();
  for (const contract of contracts) {
    const existing = contractByClientId.get(contract.clientId);
    if (!existing || contract.startDate > existing.startDate) {
      contractByClientId.set(contract.clientId, contract);
    }
  }

  // 4. Aggregate per-client.
  type ClientAgg = {
    clientId: number;
    clientName: string;
    totalHours: number;
    internalCost: number;
    theoreticalBilled: number;
  };
  const byClient = new Map<number, ClientAgg>();

  for (const entry of entries) {
    const rate = rateByUserId.get(entry.userId);
    const costRate = rate?.hourlyCostRate ?? 0;
    const billingRate = rate?.billingHourlyRate ?? 0;

    const agg = byClient.get(entry.clientId) ?? {
      clientId: entry.clientId,
      clientName: entry.client?.name ?? "—",
      totalHours: 0,
      internalCost: 0,
      theoreticalBilled: 0,
    };
    agg.totalHours += entry.durationHours;
    agg.internalCost += entry.durationHours * costRate;
    agg.theoreticalBilled += entry.durationHours * billingRate;
    byClient.set(entry.clientId, agg);
  }

  // 5. Build profitability rows.
  const rows = Array.from(byClient.values()).map((agg) => {
    const contract = contractByClientId.get(agg.clientId);
    const monthlyFlatFee = contract?.monthlyFlatFee ?? 0;
    const netMargin = monthlyFlatFee - agg.internalCost;
    const marginPct = monthlyFlatFee > 0 ? (netMargin / monthlyFlatFee) * 100 : null;
    return {
      clientId: agg.clientId,
      clientName: agg.clientName,
      totalHours: Math.round(agg.totalHours * 100) / 100,
      monthlyFlatFee,
      internalCost: Math.round(agg.internalCost),
      theoreticalBilled: Math.round(agg.theoreticalBilled),
      netMargin: Math.round(netMargin),
      marginPct: marginPct !== null ? Math.round(marginPct * 10) / 10 : null,
      isUnprofitable: netMargin < 0,
      isLowMargin: marginPct !== null && marginPct >= 0 && marginPct < 30,
    };
  });

  // Sort: most unprofitable first, then by margin ascending.
  rows.sort((a, b) => {
    if (a.isUnprofitable && !b.isUnprofitable) return -1;
    if (!a.isUnprofitable && b.isUnprofitable) return 1;
    return (a.marginPct ?? 0) - (b.marginPct ?? 0);
  });

  // 6. Global KPIs.
  const totalHours = rows.reduce((s, r) => s + r.totalHours, 0);
  const totalInternalCost = rows.reduce((s, r) => s + r.internalCost, 0);
  const totalFees = rows.reduce((s, r) => s + r.monthlyFlatFee, 0);
  const grossMargin = totalFees - totalInternalCost;
  const grossMarginPct = totalFees > 0 ? (grossMargin / totalFees) * 100 : null;

  // 7. Task breakdown (all entries in the month).
  const hoursByTask = new Map<TaskType, number>();
  for (const entry of entries) {
    const prev = hoursByTask.get(entry.taskType as TaskType) ?? 0;
    hoursByTask.set(entry.taskType as TaskType, prev + entry.durationHours);
  }
  const taskBreakdown = TASK_TYPES.filter((t) => (hoursByTask.get(t) ?? 0) > 0)
    .map((taskType) => {
      const hours = Math.round((hoursByTask.get(taskType) ?? 0) * 100) / 100;
      const pct = totalHours > 0 ? Math.round((hours / totalHours) * 1000) / 10 : 0;
      return { taskType, hours, pct };
    })
    .sort((a, b) => b.hours - a.hours);

  res.json({
    year,
    month,
    globalKpis: {
      totalHours: Math.round(totalHours * 100) / 100,
      totalInternalCost: Math.round(totalInternalCost),
      totalFees: Math.round(totalFees),
      grossMargin: Math.round(grossMargin),
      grossMarginPct: grossMarginPct !== null ? Math.round(grossMarginPct * 10) / 10 : null,
    },
    rows,
    taskBreakdown,
  });
});

// ---------------------------------------------------------------------------
// Mission Expenses (Frais Directs / Débours) — M22 extension
// ---------------------------------------------------------------------------

const ExpenseBodySchema = z.object({
  clientId:  z.number().int().positive(),
  year:      z.number().int().positive(),
  month:     z.number().int().min(1).max(12),
  label:     z.string().min(1),
  amount:    z.number().int().positive(),
  category:  z.enum(["DEPLACEMENT", "HEBERGEMENT", "RESTAURATION", "AUTRE"]),
});

router.get("/cabinet-analytics/expenses", requireRole("expert_comptable", "collaborateur", "stagiaire"), async (req, res) => {
  const { year, month, clientId } = z.object({
    year:     z.coerce.number().int(),
    month:    z.coerce.number().int(),
    clientId: z.coerce.number().int().positive(),
  }).parse(req.query);

  const expenses = await db.query.missionExpensesTable.findMany({
    where: and(
      eq(missionExpensesTable.firmId, req.user!.firmId),
      eq(missionExpensesTable.clientId, clientId),
      eq(missionExpensesTable.year, year),
      eq(missionExpensesTable.month, month),
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { user: true },
  });

  res.json(expenses.map((e) => ({
    id: e.id, firmId: e.firmId, clientId: e.clientId,
    userId: e.userId, year: e.year, month: e.month,
    label: e.label, amount: e.amount, category: e.category,
    addedByName: (e as any).user?.fullName ?? null,
    createdAt: e.createdAt.toISOString(),
  })));
});

router.post("/cabinet-analytics/expenses", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const body = ExpenseBodySchema.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) { res.status(404).json({ error: "Client introuvable." }); return; }

  const [expense] = await db
    .insert(missionExpensesTable)
    .values({
      firmId: req.user!.firmId,
      clientId: body.clientId,
      userId: req.user!.id,
      year: body.year,
      month: body.month,
      label: body.label,
      amount: body.amount,
      category: body.category,
    })
    .returning();

  res.status(201).json({
    id: expense.id, firmId: expense.firmId, clientId: expense.clientId,
    userId: expense.userId, year: expense.year, month: expense.month,
    label: expense.label, amount: expense.amount, category: expense.category,
    addedByName: req.user!.fullName,
    createdAt: expense.createdAt.toISOString(),
  });
});

router.delete("/cabinet-analytics/expenses/:id", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

  const expense = await db.query.missionExpensesTable.findFirst({
    where: and(eq(missionExpensesTable.id, id), eq(missionExpensesTable.firmId, req.user!.firmId)),
  });
  if (!expense) { res.status(404).json({ error: "Frais introuvable." }); return; }

  await db.delete(missionExpensesTable).where(eq(missionExpensesTable.id, id));
  res.json({ ok: true, id });
});

// ---------------------------------------------------------------------------
// GET /cabinet-analytics/profitability/:year/:month/export-pdf
// ---------------------------------------------------------------------------

router.get("/cabinet-analytics/profitability/:year/:month/export-pdf", requireRole("expert_comptable"), async (req, res) => {
  const { year, month } = z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }).parse(req.params);

  // Load data (same logic as the main profitability route)
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const entries = await db.query.timesheetEntriesTable.findMany({
    where: and(
      eq(timesheetEntriesTable.firmId, req.user!.firmId),
      gte(timesheetEntriesTable.date, monthStart),
      lte(timesheetEntriesTable.date, monthEnd),
    ),
    with: { client: true },
  });

  const firm = await db.query.firmsTable.findFirst({ where: eq(firmsTable.id, req.user!.firmId) });
  const firmName: string = firm?.name ?? "Cabinet";

  const rates = await db.query.cabinetUserRatesTable.findMany({
    where: eq(cabinetUserRatesTable.firmId, req.user!.firmId),
  });
  const rateByUserId = new Map(rates.map((r) => [r.userId, r]));

  const contracts = await db.query.clientContractsTable.findMany({
    where: and(
      eq(clientContractsTable.firmId, req.user!.firmId),
      lte(clientContractsTable.startDate, monthEnd),
      or(isNull(clientContractsTable.endDate), gte(clientContractsTable.endDate, monthStart)),
    ),
  });
  const contractByClientId = new Map<number, typeof clientContractsTable.$inferSelect>();
  for (const c of contracts) {
    const existing = contractByClientId.get(c.clientId);
    if (!existing || c.startDate > existing.startDate) contractByClientId.set(c.clientId, c);
  }

  // Load expenses for this month
  const clientIds = [...new Set(entries.map((e) => e.clientId))];
  const allExpenses = clientIds.length > 0
    ? await db.query.missionExpensesTable.findMany({
        where: and(
          eq(missionExpensesTable.firmId, req.user!.firmId),
          eq(missionExpensesTable.year, year),
          eq(missionExpensesTable.month, month),
        ),
      })
    : [];
  const expensesByClient = new Map<number, number>();
  for (const exp of allExpenses) {
    expensesByClient.set(exp.clientId, (expensesByClient.get(exp.clientId) ?? 0) + exp.amount);
  }

  const byClient = new Map<number, { clientName: string; totalHours: number; internalCost: number }>();
  for (const entry of entries) {
    const rate = rateByUserId.get(entry.userId);
    const agg = byClient.get(entry.clientId) ?? { clientName: entry.client?.name ?? "—", totalHours: 0, internalCost: 0 };
    agg.totalHours += entry.durationHours;
    agg.internalCost += entry.durationHours * (rate?.hourlyCostRate ?? 0);
    byClient.set(entry.clientId, agg);
  }

  const rows = Array.from(byClient.entries()).map(([clientId, agg]) => {
    const monthlyFlatFee = contractByClientId.get(clientId)?.monthlyFlatFee ?? 0;
    const directExpenses = expensesByClient.get(clientId) ?? 0;
    const netMargin = monthlyFlatFee - agg.internalCost - directExpenses;
    const marginPct = monthlyFlatFee > 0 ? (netMargin / monthlyFlatFee) * 100 : null;
    return {
      clientName: agg.clientName,
      totalHours: Math.round(agg.totalHours * 100) / 100,
      monthlyFlatFee,
      internalCost: Math.round(agg.internalCost),
      directExpenses,
      netMargin: Math.round(netMargin),
      marginPct: marginPct !== null ? Math.round(marginPct * 10) / 10 : null,
    };
  }).sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0));

  const totalHours = rows.reduce((s, r) => s + r.totalHours, 0);
  const totalFees = rows.reduce((s, r) => s + r.monthlyFlatFee, 0);
  const totalCost = rows.reduce((s, r) => s + r.internalCost, 0);
  const grossMargin = totalFees - totalCost;
  const grossMarginPct = totalFees > 0 ? (grossMargin / totalFees) * 100 : null;

  const pdfBuffer = await generateProfitabilityPdf({
    firmName, year, month, rows,
    globalKpis: { totalHours, totalInternalCost: totalCost, totalFees, grossMargin, grossMarginPct: grossMarginPct !== null ? Math.round(grossMarginPct * 10) / 10 : null },
  });

  const MONTH_NAMES = ["Janvier","Fevrier","Mars","Avril","Mai","Juin","Juillet","Aout","Septembre","Octobre","Novembre","Decembre"];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Rentabilite_${MONTH_NAMES[month - 1]}_${year}.pdf"`);
  res.send(pdfBuffer);
});

export default router;
