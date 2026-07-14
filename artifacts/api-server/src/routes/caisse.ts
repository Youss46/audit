import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  cashRegistersTable,
  dailyClosuresTable,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  isPortalRole,
} from "@workspace/db";
import { broadcastPendingCounts } from "../lib/pending-counts";
import {
  ListCashRegistersQueryParams,
  ListCashRegistersResponse,
  CreateCashRegisterBody,
  CreateCashRegisterResponse,
  GetCashRegisterParams,
  GetCashRegisterResponse,
  GetTodayClosureParams,
  GetTodayClosureResponse,
  ListClosuresParams,
  ListClosuresResponse,
  CloseDailyClosureParams,
  CloseDailyClosureBody,
  CloseDailyClosureResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { computeJournalLines } from "../lib/accounting-engine";

const router: IRouter = Router();

router.use(requireAuth);

function serializeCashRegister(
  register: typeof cashRegistersTable.$inferSelect,
  extra: { clientName?: string | null } = {},
) {
  return {
    id: register.id,
    name: register.name,
    clientId: register.clientId,
    clientName: extra.clientName ?? null,
    currentBalance: register.currentBalance,
    createdAt: register.createdAt,
  };
}

function serializeClosure(
  closure: typeof dailyClosuresTable.$inferSelect,
  liveBalance: number,
  extra: { closedByName?: string | null } = {},
) {
  return {
    id: closure.id,
    cashRegisterId: closure.cashRegisterId,
    date: closure.date,
    openingBalance: closure.openingBalance,
    expectedClosingBalance: closure.expectedClosingBalance ?? null,
    physicalClosingBalance: closure.physicalClosingBalance ?? null,
    discrepancyAmount: closure.discrepancyAmount ?? null,
    liveBalance,
    status: closure.status,
    comment: closure.comment ?? null,
    closedById: closure.closedById ?? null,
    closedByName: extra.closedByName ?? null,
    closedAt: closure.closedAt ?? null,
    createdAt: closure.createdAt,
  };
}

// Today's date as "YYYY-MM-DD", used as the daily closure's natural key.
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadRegisterForRequest(
  req: Parameters<typeof requireOwnClient>[0],
  res: Parameters<typeof requireOwnClient>[1],
  id: number,
) {
  const register = await db.query.cashRegistersTable.findFirst({
    where: eq(cashRegistersTable.id, id),
    with: { client: true },
  });
  if (!register || register.client?.firmId !== req.user!.firmId) {
    res.status(404).json({ error: "Caisse introuvable." });
    return null;
  }
  if (!requireOwnClient(req, res, register.clientId)) return null;
  return register;
}

// Module P5: list the cash registers a PME (or the cabinet, for a given
// client) can operate. A client_pme account is always scoped to its own
// client, matching the rest of the Espace PME.
router.get("/cash-registers", requirePermission("caisse.view", "operations.view"), async (req, res) => {
  const { clientId } = ListCashRegistersQueryParams.parse(req.query);

  if (isPortalRole(req.user!.role)) {
    if (!req.user!.clientId || (clientId && clientId !== req.user!.clientId)) {
      res.json(ListCashRegistersResponse.parse([]));
      return;
    }
  }
  const effectiveClientId = isPortalRole(req.user!.role) ? req.user!.clientId! : clientId;

  const registers = await db.query.cashRegistersTable.findMany({
    where: effectiveClientId ? eq(cashRegistersTable.clientId, effectiveClientId) : undefined,
    with: { client: true },
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });

  res.json(
    ListCashRegistersResponse.parse(
      registers
        .filter((r) => r.client?.firmId === req.user!.firmId)
        .map((r) => serializeCashRegister(r, { clientName: r.client?.name })),
    ),
  );
});

router.post("/cash-registers", requirePermission("caisse.create", "operations.create"), async (req, res) => {
  const body = CreateCashRegisterBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const [register] = await db
    .insert(cashRegistersTable)
    .values({ name: body.name, clientId: body.clientId })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.CASH_REGISTER_CREATE,
    entityType: "cash_register",
    entityId: register.id,
    details: `Création de la caisse "${register.name}" pour "${client.name}"`,
    ipAddress: req.ip,
  });

  res
    .status(201)
    .json(CreateCashRegisterResponse.parse(serializeCashRegister(register, { clientName: client.name })));
});

router.get("/cash-registers/:id", requirePermission("caisse.view", "operations.view"), async (req, res) => {
  const { id } = GetCashRegisterParams.parse(req.params);
  const register = await loadRegisterForRequest(req, res, id);
  if (!register) return;

  res.json(
    GetCashRegisterResponse.parse(serializeCashRegister(register, { clientName: register.client?.name })),
  );
});

// Module P5 "Caisse Express" dashboard: returns today's OPEN closure,
// auto-creating it on first use. `openingBalance` is simply the register's
// running balance at that moment, since `currentBalance` already carries
// forward every prior day's physically-counted close.
router.get("/cash-registers/:id/closure-today", requirePermission("caisse.view"), async (req, res) => {
  const { id } = GetTodayClosureParams.parse(req.params);
  const register = await loadRegisterForRequest(req, res, id);
  if (!register) return;

  const date = todayKey();
  let closure = await db.query.dailyClosuresTable.findFirst({
    where: and(eq(dailyClosuresTable.cashRegisterId, id), eq(dailyClosuresTable.date, date)),
  });
  if (!closure) {
    [closure] = await db
      .insert(dailyClosuresTable)
      .values({ cashRegisterId: id, date, openingBalance: register.currentBalance, status: "OPEN" })
      .returning();
  }

  res.json(GetTodayClosureResponse.parse(serializeClosure(closure, register.currentBalance)));
});

router.get("/cash-registers/:id/closures", requirePermission("caisse.view"), async (req, res) => {
  const { id } = ListClosuresParams.parse(req.params);
  const register = await loadRegisterForRequest(req, res, id);
  if (!register) return;

  const closures = await db.query.dailyClosuresTable.findMany({
    where: eq(dailyClosuresTable.cashRegisterId, id),
    orderBy: [desc(dailyClosuresTable.date)],
    with: { closedBy: true },
  });

  res.json(
    ListClosuresResponse.parse(
      closures.map((c) =>
        serializeClosure(
          c,
          c.status === "OPEN" ? register.currentBalance : c.expectedClosingBalance ?? 0,
          { closedByName: c.closedBy?.fullName },
        ),
      ),
    ),
  );
});

// Module P5 "Clôture de Caisse en 1 Tap": freezes the theoretical balance,
// compares it against the physically counted balance, and -- when they
// differ -- books the écart de caisse as a new "à valider" transaction so
// the cabinet reviews it like any other entry. The register's
// currentBalance is then reset to the physical count: what was actually
// counted in the drawer is the new source of truth for tomorrow's opening.
router.post("/cash-registers/:id/closures/:closureId/close", requirePermission("caisse.create"), async (req, res) => {
  const { id, closureId } = CloseDailyClosureParams.parse(req.params);
  const body = CloseDailyClosureBody.parse(req.body);
  const register = await loadRegisterForRequest(req, res, id);
  if (!register) return;

  const closure = await db.query.dailyClosuresTable.findFirst({
    where: and(eq(dailyClosuresTable.id, closureId), eq(dailyClosuresTable.cashRegisterId, id)),
  });
  if (!closure) {
    res.status(404).json({ error: "Clôture introuvable." });
    return;
  }
  if (closure.status === "CLOSED") {
    res.status(409).json({ error: "Cette journée est déjà clôturée." });
    return;
  }

  const expectedClosingBalance = register.currentBalance;
  const discrepancyAmount = body.physicalClosingBalance - expectedClosingBalance;
  const comment = body.comment?.trim() || null;
  if (discrepancyAmount !== 0 && !comment) {
    res.status(400).json({
      error: "Une justification est requise lorsque l'écart de caisse n'est pas nul.",
    });
    return;
  }

  const [updatedClosure] = await db
    .update(dailyClosuresTable)
    .set({
      status: "CLOSED",
      expectedClosingBalance,
      physicalClosingBalance: body.physicalClosingBalance,
      discrepancyAmount,
      comment,
      closedById: req.user!.id,
      closedAt: new Date(),
    })
    .where(eq(dailyClosuresTable.id, closureId))
    .returning();

  let summaryTransaction: Awaited<ReturnType<typeof buildSummaryTransaction>> | null = null;
  if (discrepancyAmount !== 0) {
    summaryTransaction = await buildSummaryTransaction({
      firmId: req.user!.firmId,
      clientId: register.clientId,
      clientName: register.client?.name ?? null,
      cashRegisterId: register.id,
      cashRegisterName: register.name,
      date: closure.date,
      discrepancyAmount,
      createdById: req.user!.id,
    });
  }

  // The physical count becomes the new source of truth for the register's
  // running balance -- this is deliberately independent of whether the
  // écart transaction above has been reviewed yet by the cabinet.
  await db
    .update(cashRegistersTable)
    .set({ currentBalance: body.physicalClosingBalance })
    .where(eq(cashRegistersTable.id, id));

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.DAILY_CLOSURE_CLOSE,
    entityType: "daily_closure",
    entityId: closureId,
    details: `Clôture de la caisse "${register.name}" (${closure.date}), écart de ${discrepancyAmount} FCFA`,
    ipAddress: req.ip,
  });

  // Module M32: an écart de caisse lands in the "à valider" queue exactly
  // like any other entry, so the counters must reflect it right away.
  if (summaryTransaction) {
    await broadcastPendingCounts(req.user!.firmId, register.clientId);
  }

  res.json(
    CloseDailyClosureResponse.parse({
      closure: serializeClosure(updatedClosure, body.physicalClosingBalance),
      cashRegister: serializeCashRegister(
        { ...register, currentBalance: body.physicalClosingBalance },
        { clientName: register.client?.name },
      ),
      summaryTransaction,
    }),
  );
});

// Books the écart de caisse revealed by a daily closure as a standalone,
// separately reviewed transaction (never an edit of any existing entry),
// landing in the cabinet's "à valider" queue exactly like a normal P3
// declaration. It intentionally does NOT touch the register's
// currentBalance -- the caller already resets that directly to the
// physically counted amount.
async function buildSummaryTransaction(input: {
  firmId: number;
  clientId: number;
  clientName: string | null;
  cashRegisterId: number;
  cashRegisterName: string;
  date: string;
  discrepancyAmount: number;
  createdById: number;
}) {
  const isGain = input.discrepancyAmount > 0;
  const category = isGain ? "ecart_caisse_gain" : "ecart_caisse_perte";
  const type = isGain ? "recette" : "depense";
  const amount = Math.abs(input.discrepancyAmount);

  const journalLines = computeJournalLines({
    category,
    type,
    paymentType: "cash",
    paymentMethod: "especes",
    amount,
  });

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId: input.firmId,
      clientId: input.clientId,
      date: new Date(`${input.date}T00:00:00.000Z`),
      label: `Écart de caisse - ${input.cashRegisterName} (${input.date})`,
      amount,
      type,
      category,
      paymentType: "cash",
      paymentMethod: "especes",
      cashRegisterId: input.cashRegisterId,
      status: "a_valider",
      source: "caisse_closure",
      createdById: input.createdById,
    })
    .returning();

  const insertedJournalLines = await db
    .insert(journalLinesTable)
    .values(
      journalLines.map((line) => ({
        transactionId: tx.id,
        accountNumber: line.accountNumber,
        label: line.label,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
      })),
    )
    .returning();

  return {
    id: tx.id,
    firmId: tx.firmId,
    clientId: tx.clientId,
    clientName: input.clientName,
    date: tx.date,
    label: tx.label,
    amount: tx.amount,
    type: tx.type,
    category: tx.category,
    categoryLabel: isGain ? "Écart de caisse (excédent)" : "Écart de caisse (manquant)",
    paymentType: tx.paymentType,
    paymentMethod: tx.paymentMethod,
    dueDate: null,
    status: tx.status,
    source: tx.source,
    documentId: null,
    documentFileName: null,
    clarificationNote: null,
    settledAt: null,
    parentTransactionId: null,
    cashRegisterId: tx.cashRegisterId,
    cashRegisterName: input.cashRegisterName,
    createdByName: null,
    validatedByName: null,
    validatedAt: null,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    journalLines: insertedJournalLines,
  };
}

export default router;
