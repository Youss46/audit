import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  pumpShiftsTable,
  cashRegistersTable,
  transactionsTable,
  journalLinesTable,
  isPortalRole,
  type PumpShift,
} from "@workspace/db";
import { broadcastPendingCounts } from "../lib/pending-counts";
import {
  GetLastPumpIndexQueryParams,
  GetLastPumpIndexResponse,
  ListPumpShiftsQueryParams,
  ListPumpShiftsResponse,
  CreatePumpShiftBody,
  CreatePumpShiftResponse,
  GetPumpShiftParams,
  GetPumpShiftResponse,
  ValidatePumpShiftParams,
  ValidatePumpShiftBody,
  ValidatePumpShiftResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { computeJournalLines } from "../lib/accounting-engine";
import { createTransactionEntry, HttpError, withJournalLines } from "./accounting";

// Module P7 (Un Pompiste = Un Shift — Relevé d'Index & Ventes de Carburant):
// gives the "Relevé d'index de pompe" and "Ventes de carburant" Espace PME
// cards their own dedicated screens and data, instead of both landing on
// the generic Caisse Express quick-entry form.

const router: IRouter = Router();

router.use(requireAuth);

function serializePumpShift(
  shift: PumpShift,
  extra: { openedByName?: string | null; validatedByName?: string | null } = {},
) {
  return {
    id: shift.id,
    clientId: shift.clientId,
    cashRegisterId: shift.cashRegisterId ?? null,
    pumpLabel: shift.pumpLabel,
    fuelType: shift.fuelType,
    indexStart: shift.indexStart,
    indexEnd: shift.indexEnd,
    volumeLiters: Math.round((shift.indexEnd - shift.indexStart) * 100) / 100,
    status: shift.status,
    unitPrice: shift.unitPrice ?? null,
    paymentMethod: shift.paymentMethod ?? null,
    expectedAmount: shift.expectedAmount ?? null,
    declaredPhysicalAmount: shift.declaredPhysicalAmount ?? null,
    discrepancyAmount: shift.discrepancyAmount ?? null,
    transactionId: shift.transactionId ?? null,
    discrepancyTransactionId: shift.discrepancyTransactionId ?? null,
    openedByName: extra.openedByName ?? null,
    validatedByName: extra.validatedByName ?? null,
    validatedAt: shift.validatedAt ?? null,
    createdAt: shift.createdAt,
  };
}

// A POMPISTE (or any other portal role) may only ever see/act on their own
// client's pump shifts -- same ownership boundary as every other Espace PME
// resource (module P2 scoping).
function effectiveClientIdFor(req: Parameters<typeof requireOwnClient>[0], requested?: number) {
  if (isPortalRole(req.user!.role)) return req.user!.clientId ?? null;
  return requested ?? null;
}

router.get("/pump-shifts/last-index", requirePermission("caisse.view"), async (req, res) => {
  const { clientId, pumpLabel, fuelType } = GetLastPumpIndexQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const last = await db.query.pumpShiftsTable.findFirst({
    where: and(
      eq(pumpShiftsTable.clientId, clientId),
      eq(pumpShiftsTable.pumpLabel, pumpLabel),
      eq(pumpShiftsTable.fuelType, fuelType),
    ),
    orderBy: [desc(pumpShiftsTable.createdAt)],
  });

  res.json(GetLastPumpIndexResponse.parse({ indexEnd: last?.indexEnd ?? null }));
});

router.get("/pump-shifts", requirePermission("caisse.view"), async (req, res) => {
  const { clientId, status } = ListPumpShiftsQueryParams.parse(req.query);
  const effectiveClientId = effectiveClientIdFor(req, clientId);
  if (!effectiveClientId || !requireOwnClient(req, res, effectiveClientId)) return;

  const shifts = await db.query.pumpShiftsTable.findMany({
    where: and(
      eq(pumpShiftsTable.clientId, effectiveClientId),
      status ? eq(pumpShiftsTable.status, status) : undefined,
    ),
    orderBy: [desc(pumpShiftsTable.createdAt)],
    with: { openedBy: true, validatedBy: true },
  });

  res.json(
    ListPumpShiftsResponse.parse(
      shifts.map((s) =>
        serializePumpShift(s, {
          openedByName: s.openedBy?.fullName,
          validatedByName: s.validatedBy?.fullName,
        }),
      ),
    ),
  );
});

// "Relevé d'index de pompe": indexStart is always resolved from this
// pump/fuel's own last shift (never trusted from the client), so a
// pompiste can never inflate the sold volume by editing a hidden field.
router.post("/pump-shifts", requirePermission("caisse.create"), async (req, res) => {
  const body = CreatePumpShiftBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const last = await db.query.pumpShiftsTable.findFirst({
    where: and(
      eq(pumpShiftsTable.clientId, body.clientId),
      eq(pumpShiftsTable.pumpLabel, body.pumpLabel),
      eq(pumpShiftsTable.fuelType, body.fuelType),
    ),
    orderBy: [desc(pumpShiftsTable.createdAt)],
  });
  const indexStart = last?.indexEnd ?? 0;

  if (body.indexEnd < indexStart) {
    res.status(400).json({
      error: `L'index de fin (${body.indexEnd} L) ne peut pas être inférieur à l'index de début (${indexStart} L).`,
    });
    return;
  }

  // Module P6: a pompiste with their own cash drawer keeps this shift tied
  // to it from the start, so "Ventes de carburant" later books straight to
  // their personal sub-account without asking again.
  const ownedRegister = isPortalRole(req.user!.role)
    ? await db.query.cashRegistersTable.findFirst({
        where: eq(cashRegistersTable.ownerUserId, req.user!.id),
      })
    : null;

  const [shift] = await db
    .insert(pumpShiftsTable)
    .values({
      clientId: body.clientId,
      cashRegisterId: ownedRegister?.id ?? null,
      pumpLabel: body.pumpLabel,
      fuelType: body.fuelType,
      indexStart,
      indexEnd: body.indexEnd,
      status: "OPEN",
      openedById: req.user!.id,
    })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_CREATE,
    entityType: "pump_shift",
    entityId: shift.id,
    details: `Relevé d'index "${body.pumpLabel}" (${body.fuelType}) pour "${client.name}" : ${indexStart} L → ${body.indexEnd} L`,
    ipAddress: req.ip,
  });

  res.status(201).json(CreatePumpShiftResponse.parse(serializePumpShift(shift, { openedByName: req.user!.fullName })));
});

async function loadShiftForRequest(
  req: Parameters<typeof requireOwnClient>[0],
  res: Parameters<typeof requireOwnClient>[1],
  id: number,
) {
  const shift = await db.query.pumpShiftsTable.findFirst({
    where: eq(pumpShiftsTable.id, id),
    with: { client: true, openedBy: true, validatedBy: true },
  });
  if (!shift || shift.client?.firmId !== req.user!.firmId) {
    res.status(404).json({ error: "Relevé introuvable." });
    return null;
  }
  if (!requireOwnClient(req, res, shift.clientId)) return null;
  return shift;
}

router.get("/pump-shifts/:id", requirePermission("caisse.view"), async (req, res) => {
  const { id } = GetPumpShiftParams.parse(req.params);
  const shift = await loadShiftForRequest(req, res, id);
  if (!shift) return;

  res.json(
    GetPumpShiftResponse.parse(
      serializePumpShift(shift, {
        openedByName: shift.openedBy?.fullName,
        validatedByName: shift.validatedBy?.fullName,
      }),
    ),
  );
});

// Books the shift's cash discrepancy (declared physical cash vs. the
// theoretical sale value) as a standalone, separately reviewed transaction
// -- same pattern as the P5 daily-closure écart -- and, unlike that flow,
// also applies it to the register's live balance since there is no
// separate "reset to physical count" step here.
async function bookDiscrepancy(input: {
  firmId: number;
  clientId: number;
  cashRegisterId: number;
  cashRegisterAccountNumber?: string | null;
  cashRegisterName?: string | null;
  pumpLabel: string;
  discrepancyAmount: number;
  createdById: number;
}) {
  const isGain = input.discrepancyAmount > 0;
  const category = isGain ? "ecart_caisse_gain" : "ecart_caisse_perte";
  const type = isGain ? "recette" : "depense";
  const amount = Math.abs(input.discrepancyAmount);

  // Module P6: when this register is a pompiste's own dedicated drawer
  // (e.g. "571101"), the écart must book against that same sub-account --
  // never the generic "571" -- exactly like the sale line above, or the
  // pompiste's personal sub-ledger stops reconciling with their register.
  const journalLines = computeJournalLines({
    category,
    type,
    paymentType: "cash",
    paymentMethod: "especes",
    amount,
    treasuryAccountOverride:
      input.cashRegisterAccountNumber && input.cashRegisterName
        ? { accountNumber: input.cashRegisterAccountNumber, label: input.cashRegisterName }
        : undefined,
  });

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId: input.firmId,
      clientId: input.clientId,
      date: new Date(),
      label: `Écart de caisse - Vente de carburant (${input.pumpLabel})`,
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

  await db.insert(journalLinesTable).values(
    journalLines.map((line) => ({
      transactionId: tx.id,
      accountNumber: line.accountNumber,
      label: line.label,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
    })),
  );

  // The register's live balance is updated by the caller (using an atomic
  // increment), since it already knows the signed discrepancy amount.
  return tx;
}

// "Valider le Shift": computes the theoretical sale value from the sold
// volume, posts it as a SYSCOHADA sale entry through the same
// createTransactionEntry() helper as every other P3/P5 entry, then -- for
// espèces settlements -- compares the declared physical cash to that
// theoretical value and books any gap as a separate écart.
router.post("/pump-shifts/:id/validate", requirePermission("caisse.create"), async (req, res) => {
  const { id } = ValidatePumpShiftParams.parse(req.params);
  const body = ValidatePumpShiftBody.parse(req.body);
  const shift = await loadShiftForRequest(req, res, id);
  if (!shift) return;

  if (shift.status === "VALIDATED") {
    res.status(409).json({ error: "Ce shift a déjà été validé." });
    return;
  }
  if (body.paymentMethod === "especes" && body.declaredPhysicalAmount == null) {
    res.status(400).json({
      error: "Le montant physiquement compté en caisse est requis pour un règlement en espèces.",
    });
    return;
  }

  const volumeLiters = Math.round((shift.indexEnd - shift.indexStart) * 100) / 100;
  const expectedAmount = Math.round(volumeLiters * body.unitPrice);
  const fuelLabel = shift.fuelType === "super" ? "Super" : "Gasoil";

  let saleResult: Awaited<ReturnType<typeof createTransactionEntry>>;
  try {
    saleResult = await createTransactionEntry(req, {
      clientId: shift.clientId,
      date: new Date(),
      label: `Vente de carburant - ${fuelLabel} (${shift.pumpLabel}) : ${volumeLiters} L`,
      amount: expectedAmount,
      type: "recette",
      category: "vente_carburant",
      paymentType: "cash",
      paymentMethod: body.paymentMethod,
      documentId: null,
      dueDate: null,
      cashRegisterId: shift.cashRegisterId ?? undefined,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }

  const cashRegisterId = saleResult.tx.cashRegisterId ?? shift.cashRegisterId ?? null;
  const discrepancyAmount =
    body.paymentMethod === "especes" && body.declaredPhysicalAmount != null
      ? body.declaredPhysicalAmount - expectedAmount
      : null;

  let discrepancyTx: Awaited<ReturnType<typeof bookDiscrepancy>> | null = null;
  if (discrepancyAmount && cashRegisterId) {
    discrepancyTx = await bookDiscrepancy({
      firmId: req.user!.firmId,
      clientId: shift.clientId,
      cashRegisterId,
      cashRegisterAccountNumber: saleResult.cashRegisterAccountNumber,
      cashRegisterName: saleResult.cashRegisterName,
      pumpLabel: shift.pumpLabel,
      discrepancyAmount,
      createdById: req.user!.id,
    });
    await db
      .update(cashRegistersTable)
      .set({ currentBalance: sql`${cashRegistersTable.currentBalance} + ${discrepancyAmount}` })
      .where(eq(cashRegistersTable.id, cashRegisterId));
  }

  const [updatedShift] = await db
    .update(pumpShiftsTable)
    .set({
      status: "VALIDATED",
      unitPrice: body.unitPrice,
      paymentMethod: body.paymentMethod,
      expectedAmount,
      declaredPhysicalAmount: body.declaredPhysicalAmount ?? null,
      discrepancyAmount,
      transactionId: saleResult.tx.id,
      discrepancyTransactionId: discrepancyTx?.id ?? null,
      cashRegisterId,
      validatedById: req.user!.id,
      validatedAt: new Date(),
    })
    .where(eq(pumpShiftsTable.id, id))
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_CREATE,
    entityType: "pump_shift",
    entityId: id,
    details: `Validation du shift "${shift.pumpLabel}" (${fuelLabel}) : ${volumeLiters} L × ${body.unitPrice} FCFA = ${expectedAmount} FCFA`,
    ipAddress: req.ip,
  });

  await broadcastPendingCounts(req.user!.firmId, shift.clientId);

  const saleTransaction = await withJournalLines(saleResult.tx, {
    clientName: saleResult.client.name,
    createdByName: req.user!.fullName,
    cashRegisterName: saleResult.cashRegisterName,
    cashRegisterAccountNumber: saleResult.cashRegisterAccountNumber,
  });
  const discrepancyTransaction = discrepancyTx ? await withJournalLines(discrepancyTx) : null;

  res.json(
    ValidatePumpShiftResponse.parse({
      pumpShift: serializePumpShift(updatedShift, {
        openedByName: shift.openedBy?.fullName,
        validatedByName: req.user!.fullName,
      }),
      saleTransaction,
      discrepancyTransaction,
    }),
  );
});

export default router;
