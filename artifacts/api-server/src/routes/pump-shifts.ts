import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  pumpsTable,
  pumpShiftsTable,
  pumpAssignmentsTable,
  fuelPricesTable,
  cashRegistersTable,
  transactionsTable,
  journalLinesTable,
  isPortalRole,
  type PumpShift,
  type PaymentMethod,
} from "@workspace/db";
import { broadcastPendingCounts, notifyPmeTransactionSubmitted } from "../lib/pending-counts";
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
import { computeJournalLines, computeFuelSaleJournalLines } from "../lib/accounting-engine";
import { HttpError, withJournalLines } from "./accounting";
import { isPeriodLocked } from "../lib/closing-engine";


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
    cashAmount: shift.cashAmount ?? null,
    waveAmount: shift.waveAmount ?? null,
    orangeMoneyAmount: shift.orangeMoneyAmount ?? null,
    mtnMomoAmount: shift.mtnMomoAmount ?? null,
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

  // Priority 1: most recent VALIDATED shift's closing index.
  const last = await db.query.pumpShiftsTable.findFirst({
    where: and(
      eq(pumpShiftsTable.clientId, clientId),
      eq(pumpShiftsTable.pumpLabel, pumpLabel),
      eq(pumpShiftsTable.fuelType, fuelType),
      eq(pumpShiftsTable.status, "VALIDATED"),
    ),
    orderBy: [desc(pumpShiftsTable.createdAt)],
  });

  if (last) {
    return res.json(GetLastPumpIndexResponse.parse({ indexEnd: last.indexEnd }));
  }

  // Priority 2 (first-ever shift): fall back to the pump's initial
  // calibration index registered by the PME owner.  Returns null if
  // neither a past shift nor a registered pump exists yet.
  const pump = await db.query.pumpsTable.findFirst({
    where: and(
      eq(pumpsTable.clientId, clientId),
      eq(pumpsTable.label, pumpLabel),
      eq(pumpsTable.fuelType, fuelType),
    ),
  });

  res.json(GetLastPumpIndexResponse.parse({ indexEnd: pump?.initialIndex ?? null }));
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
function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

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

  // Module P7 (Restriction d'attribution des pompes): a "client_staff"
  // account (POMPISTE) may only submit a reading for a pump it has been
  // explicitly assigned to for today by the PME owner. This is the
  // authoritative check -- the frontend also filters the dropdown, but a
  // tampered request must still be rejected here, or a pompiste could
  // submit readings (and, downstream, sales) against a pump/register that
  // isn't theirs, corrupting that pump's index history and the other
  // pompiste's cash reconciliation. Every other role (owner, cabinet
  // staff) is unrestricted, matching the rest of this module's scoping.
  if (req.user!.role === "client_staff") {
    const pump = await db.query.pumpsTable.findFirst({
      where: and(
        eq(pumpsTable.clientId, body.clientId),
        eq(pumpsTable.label, body.pumpLabel),
        eq(pumpsTable.fuelType, body.fuelType),
      ),
    });
    const assignment = pump
      ? await db.query.pumpAssignmentsTable.findFirst({
          where: and(
            eq(pumpAssignmentsTable.clientId, body.clientId),
            eq(pumpAssignmentsTable.pumpId, pump.id),
            eq(pumpAssignmentsTable.staffUserId, req.user!.id),
            eq(pumpAssignmentsTable.shiftDate, todayISO()),
          ),
        })
      : null;
    if (!assignment) {
      res.status(403).json({
        error: "Cette pompe ne vous est pas attribuée pour aujourd'hui. Contactez votre responsable.",
      });
      return;
    }
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

// "Valider le Shift" (Ventes de carburant): computes the theoretical sale
// value from the sold volume, then books it as a multi-leg SYSCOHADA entry
// -- one debit per active payment channel (Espèces → 5711xx, Wave → 552200,
// Orange Money → 552100, MTN MoMo → 552300) and one credit to 701 (Ventes
// de marchandises carburant). For the espèces portion, compares the declared
// physical cash to the cash breakdown amount and books any écart as a
// separate reviewable transaction -- same pattern as the P5 daily closure.
router.post("/pump-shifts/:id/validate", requirePermission("caisse.create"), async (req, res) => {
  const { id } = ValidatePumpShiftParams.parse(req.params);
  const body = ValidatePumpShiftBody.parse(req.body);
  const shift = await loadShiftForRequest(req, res, id);
  if (!shift) return;

  if (shift.status === "VALIDATED") {
    res.status(409).json({ error: "Ce shift a déjà été validé." });
    return;
  }

  // SECURITY: the unit price is never accepted from the client. It is
  // always resolved server-side from the active FuelPrice row the PME
  // owner configured for this client + fuel type -- the "Prix unitaire au
  // litre" field on "Ventes de carburant" is display-only. A shift can't
  // be validated until the owner has set a price for that fuel type.
  const fuelPrice = await db.query.fuelPricesTable.findFirst({
    where: and(
      eq(fuelPricesTable.clientId, shift.clientId),
      eq(fuelPricesTable.fuelType, shift.fuelType),
    ),
  });
  if (!fuelPrice) {
    res.status(400).json({
      error: `Aucun prix carburant n'a été configuré pour "${shift.fuelType === "super" ? "Super" : "Gasoil"}". Contactez le propriétaire du dossier PME pour définir le prix avant de valider ce shift.`,
    });
    return;
  }
  const unitPrice = fuelPrice.unitPrice;

  const volumeLiters = Math.round((shift.indexEnd - shift.indexStart) * 100) / 100;
  const expectedAmount = Math.round(volumeLiters * unitPrice);
  const fuelLabel = shift.fuelType === "super" ? "Super" : "Gasoil";

  // Payment breakdown (default to 0 for each channel).
  const cashAmount = body.cashAmount ?? 0;
  const waveAmount = body.waveAmount ?? 0;
  const orangeMoneyAmount = body.orangeMoneyAmount ?? 0;
  const mtnMomoAmount = body.mtnMomoAmount ?? 0;
  const totalPayments = cashAmount + waveAmount + orangeMoneyAmount + mtnMomoAmount;

  if (totalPayments !== expectedAmount) {
    res.status(400).json({
      error: `La somme des paiements (${totalPayments} FCFA) ne correspond pas au montant attendu (${expectedAmount} FCFA). Vérifiez la répartition.`,
    });
    return;
  }

  if (cashAmount > 0 && body.declaredPhysicalAmount == null) {
    res.status(400).json({
      error: "Le montant physiquement compté en caisse est requis lorsqu'une partie du règlement est en espèces.",
    });
    return;
  }

  // Block entries for a locked fiscal year.
  const txYear = new Date().getFullYear();
  if (await isPeriodLocked(req.user!.firmId, shift.clientId, txYear)) {
    res.status(403).json({
      error: `L'exercice ${txYear} est définitivement clôturé. Aucune écriture ne peut y être ajoutée.`,
    });
    return;
  }

  // Resolve the cash register for the espèces portion (Module P6).
  // A pompiste with their own dedicated drawer always posts to that
  // sub-account; otherwise fall back to the shift's pre-assigned register.
  let cashRegisterId: number | null = cashAmount > 0 ? (shift.cashRegisterId ?? null) : null;
  let cashRegisterAccountNumber: string | null = null;
  let cashRegisterName: string | null = null;

  if (cashAmount > 0) {
    const ownedRegister = isPortalRole(req.user!.role)
      ? await db.query.cashRegistersTable.findFirst({
          where: eq(cashRegistersTable.ownerUserId, req.user!.id),
        })
      : null;

    if (ownedRegister) {
      cashRegisterId = ownedRegister.id;
      cashRegisterAccountNumber = ownedRegister.syscohadaAccount ?? null;
      cashRegisterName = ownedRegister.name;
    } else if (cashRegisterId) {
      const register = await db.query.cashRegistersTable.findFirst({
        where: and(
          eq(cashRegistersTable.id, cashRegisterId),
          eq(cashRegistersTable.clientId, shift.clientId),
        ),
      });
      if (register) {
        cashRegisterAccountNumber = register.syscohadaAccount ?? null;
        cashRegisterName = register.name;
      }
    }
  }

  // Derive a summary paymentMethod for the transaction record (informational
  // only -- the journal lines are the real accounting truth).
  const hasCash = cashAmount > 0;
  const hasMM = waveAmount > 0 || orangeMoneyAmount > 0 || mtnMomoAmount > 0;
  const txPaymentMethod: PaymentMethod | null =
    hasCash && !hasMM ? "especes" : hasMM && !hasCash ? "mobile_money" : null;

  // Multi-leg journal entry: one debit per active payment channel + one credit to 701.
  const journalLines = computeFuelSaleJournalLines({
    cashAmount,
    waveAmount,
    orangeMoneyAmount,
    mtnMomoAmount,
    totalAmount: expectedAmount,
    cashRegisterAccountNumber,
    cashRegisterName,
  });

  const txLabel = `Vente de carburant - ${fuelLabel} (${shift.pumpLabel}) : ${volumeLiters} L`;

  const [saleTx] = await db
    .insert(transactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: shift.clientId,
      date: new Date(),
      label: txLabel,
      amount: expectedAmount,
      type: "recette",
      category: "vente_carburant",
      paymentType: "cash",
      paymentMethod: txPaymentMethod,
      cashRegisterId: cashAmount > 0 ? cashRegisterId : null,
      status: "a_valider",
      source: isPortalRole(req.user!.role) ? "pme_entry" : "manual_cabinet",
      createdById: req.user!.id,
    })
    .returning();

  await db.insert(journalLinesTable).values(
    journalLines.map((line) => ({
      transactionId: saleTx.id,
      accountNumber: line.accountNumber,
      label: line.label,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
    })),
  );

  // Apply the cash portion to the register's live balance.
  if (cashAmount > 0 && cashRegisterId) {
    await db
      .update(cashRegistersTable)
      .set({ currentBalance: sql`${cashRegistersTable.currentBalance} + ${cashAmount}` })
      .where(eq(cashRegistersTable.id, cashRegisterId));
  }

  // Écart de caisse: declared physical cash vs. the cash breakdown amount.
  // Only applicable when there is an espèces portion.
  const discrepancyAmount =
    cashAmount > 0 && body.declaredPhysicalAmount != null
      ? body.declaredPhysicalAmount - cashAmount
      : null;

  let discrepancyTx: Awaited<ReturnType<typeof bookDiscrepancy>> | null = null;
  if (discrepancyAmount && cashRegisterId) {
    discrepancyTx = await bookDiscrepancy({
      firmId: req.user!.firmId,
      clientId: shift.clientId,
      cashRegisterId,
      cashRegisterAccountNumber,
      cashRegisterName,
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
      unitPrice,
      paymentMethod: txPaymentMethod,
      expectedAmount,
      cashAmount,
      waveAmount,
      orangeMoneyAmount,
      mtnMomoAmount,
      declaredPhysicalAmount: body.declaredPhysicalAmount ?? null,
      discrepancyAmount,
      transactionId: saleTx.id,
      discrepancyTransactionId: discrepancyTx?.id ?? null,
      cashRegisterId: cashAmount > 0 ? cashRegisterId : shift.cashRegisterId,
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
    details: `Validation shift "${shift.pumpLabel}" (${fuelLabel}) : ${volumeLiters} L × ${unitPrice} FCFA = ${expectedAmount} FCFA | Espèces: ${cashAmount} | Wave: ${waveAmount} | Orange Money: ${orangeMoneyAmount} | MTN MoMo: ${mtnMomoAmount}`,
    ipAddress: req.ip,
  });

  await broadcastPendingCounts(req.user!.firmId, shift.clientId);

  // Module M32: same "à valider" notification the cabinet gets for any
  // other PME-originated entry -- without this, "Ventes de carburant"
  // (booked here, not through the generic accounting.ts create route)
  // silently skipped the notifications table, leaving the sidebar badge
  // in sync while the header bell stayed empty.
  if (isPortalRole(req.user!.role)) {
    await notifyPmeTransactionSubmitted({
      firmId: req.user!.firmId,
      clientId: shift.clientId,
      transactionId: saleTx.id,
      clientName: shift.client?.name ?? "Client",
      type: "recette",
      amount: expectedAmount,
    });
  }

  const saleTransaction = await withJournalLines(saleTx, {
    clientName: shift.client?.name,
    createdByName: req.user!.fullName,
    cashRegisterName,
    cashRegisterAccountNumber,
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
