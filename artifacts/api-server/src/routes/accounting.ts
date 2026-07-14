import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  documentsTable,
  transactionsTable,
  journalLinesTable,
  usersTable,
  cashRegistersTable,
  fixedAssetsTable,
  isPortalRole,
} from "@workspace/db";
import {
  ListTransactionCategoriesQueryParams,
  ListTransactionCategoriesResponse,
  ListTransactionsQueryParams,
  ListTransactionsResponse,
  CreateTransactionBody,
  CreateTransactionResponse,
  GetTransactionParams,
  GetTransactionResponse,
  ApproveTransactionParams,
  ApproveTransactionResponse,
  RejectTransactionParams,
  RejectTransactionBody,
  RejectTransactionResponse,
  SettleTransactionParams,
  SettleTransactionBody,
  SettleTransactionResponse,
  UpdateTransactionJournalLinesParams,
  UpdateTransactionJournalLinesBody,
  UpdateTransactionJournalLinesResponse,
  BatchCreateTransactionsBody,
  BatchCreateTransactionsResponse,
} from "@workspace/api-zod";
import { canAccessClient, requireAuth, requireOwnClient, requirePermission, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { auditInterceptor } from "../middlewares/audit-interceptor";
import {
  AccountingEngineError,
  CATEGORY_RULES,
  computeJournalLines,
  computeSettlementJournalLines,
  listCategoriesForType,
} from "../lib/accounting-engine";
import { detectAnomalies } from "../lib/anomaly-detector";
import { isPeriodLocked } from "../lib/closing-engine";
import { isVatAccount, ClientNotVatRegisteredError } from "../lib/vat-engine";

const router: IRouter = Router();

router.use(requireAuth);
// Module M14: safety net for the "Transactions" critical module -- see
// middlewares/audit-interceptor.ts.
router.use(auditInterceptor("transaction"));

function serializeTransaction(
  tx: typeof transactionsTable.$inferSelect,
  extra: {
    clientName?: string | null;
    documentFileName?: string | null;
    createdByName?: string | null;
    validatedByName?: string | null;
    cashRegisterName?: string | null;
  } = {},
) {
  return {
    id: tx.id,
    firmId: tx.firmId,
    clientId: tx.clientId,
    clientName: extra.clientName ?? null,
    date: tx.date,
    label: tx.label,
    amount: tx.amount,
    type: tx.type,
    category: tx.category ?? null,
    categoryLabel: tx.category ? CATEGORY_RULES[tx.category]?.label ?? null : null,
    paymentType: tx.paymentType,
    paymentMethod: tx.paymentMethod ?? null,
    dueDate: tx.dueDate ?? null,
    status: tx.status,
    source: tx.source,
    documentId: tx.documentId ?? null,
    documentFileName: extra.documentFileName ?? null,
    clarificationNote: tx.clarificationNote ?? null,
    settledAt: tx.settledAt ?? null,
    parentTransactionId: tx.parentTransactionId ?? null,
    cashRegisterId: tx.cashRegisterId ?? null,
    cashRegisterName: extra.cashRegisterName ?? null,
    createdByName: extra.createdByName ?? null,
    validatedByName: extra.validatedByName ?? null,
    validatedAt: tx.validatedAt ?? null,
    anomalies: tx.anomalies ?? [],
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}

// Module P5: applies a physical cash movement to a register's live running
// balance the instant it's recorded -- deliberately independent of the
// separate M3 cabinet approval workflow, which only governs when the entry
// is permanently booked into the general ledger. Uses an atomic SQL
// increment so concurrent Caisse Express entries never race each other.
async function applyCashRegisterMovement(
  cashRegisterId: number,
  type: "recette" | "depense",
  amount: number,
) {
  const delta = type === "recette" ? amount : -amount;
  await db
    .update(cashRegistersTable)
    .set({ currentBalance: sql`${cashRegistersTable.currentBalance} + ${delta}` })
    .where(eq(cashRegistersTable.id, cashRegisterId));
}

async function withJournalLines(
  tx: typeof transactionsTable.$inferSelect,
  extra: Parameters<typeof serializeTransaction>[1] = {},
) {
  const lines = await db.query.journalLinesTable.findMany({
    where: eq(journalLinesTable.transactionId, tx.id),
  });
  return { ...serializeTransaction(tx, extra), journalLines: lines };
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Shared by the single-entry POST /transactions and the module P5 offline
// sync POST /transactions/batch: validates one plain-language cash entry,
// computes its journal lines, inserts it as "à valider", and -- when it's
// an espèces movement -- applies it to the linked cash register's live
// balance. Throws HttpError for any validation failure so callers can
// decide whether to fail the whole request (single create) or just skip
// this one entry and keep processing the rest (batch sync).
async function createTransactionEntry(
  req: Parameters<typeof requireOwnClient>[0],
  body: ReturnType<typeof CreateTransactionBody.parse>,
) {
  if (!canAccessClient(req, body.clientId)) {
    throw new HttpError(403, "Accès refusé à ce dossier client.");
  }

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) throw new HttpError(404, "Client introuvable.");

  // M19: block entries for a locked fiscal year.
  const txYear = new Date(body.date instanceof Date ? body.date : String(body.date)).getFullYear();
  if (await isPeriodLocked(req.user!.firmId, body.clientId, txYear)) {
    throw new HttpError(
      403,
      `L'exercice ${txYear} est définitivement clôturé. Aucune écriture ne peut y être ajoutée.`,
    );
  }

  // A dépense (expense/purchase) must always carry a supporting document
  // (invoice, receipt, or ticket). Reject early so the error surfaces
  // before any DB work is done.
  if (body.type === "depense" && body.documentId == null) {
    throw new HttpError(
      400,
      "La soumission d'une dépense requiert obligatoirement une pièce justificative.",
    );
  }

  if (body.documentId != null) {
    const doc = await db.query.documentsTable.findFirst({
      where: and(
        eq(documentsTable.id, body.documentId),
        eq(documentsTable.clientId, body.clientId),
      ),
    });
    if (!doc) throw new HttpError(404, "Pièce jointe introuvable pour ce client.");
  }

  // Cash (au comptant) operations require a payment method; credit (à
  // crédit) operations require a due date instead, and never touch treasury
  // until settled (see /transactions/:id/settle).
  if (body.paymentType === "cash" && !body.paymentMethod) {
    throw new HttpError(400, "Le mode de règlement est requis pour une opération au comptant.");
  }
  if (body.paymentType === "credit" && !body.dueDate) {
    throw new HttpError(400, "La date d'échéance est requise pour une opération à crédit.");
  }

  // Module P5: every physical espèces movement must be tied to the cash
  // register it went in/out of, so that register's live balance stays
  // accurate.
  let cashRegisterId: number | null = null;
  let cashRegisterName: string | null = null;
  if (body.paymentType === "cash" && body.paymentMethod === "especes") {
    if (!body.cashRegisterId) {
      throw new HttpError(400, "La caisse est requise pour un règlement en espèces.");
    }
    const register = await db.query.cashRegistersTable.findFirst({
      where: and(
        eq(cashRegistersTable.id, body.cashRegisterId),
        eq(cashRegistersTable.clientId, body.clientId),
      ),
    });
    if (!register) throw new HttpError(404, "Caisse introuvable pour ce client.");
    cashRegisterId = register.id;
    cashRegisterName = register.name;
  }

  let journalLines: ReturnType<typeof computeJournalLines>;
  try {
    journalLines = computeJournalLines({
      category: body.category,
      type: body.type,
      paymentType: body.paymentType,
      paymentMethod: body.paymentMethod,
      amount: body.amount,
    });
  } catch (err) {
    if (err instanceof AccountingEngineError) throw new HttpError(400, err.message);
    throw err;
  }

  // A client dossier marked non-assujetti (isVatRegistered = false) must
  // never have a line posted to a VAT account (443 TVA Collectée / 445 TVA
  // Déductible) -- the full TTC amount belongs entirely on the class 6/2
  // counterpart. Defensive, in addition to the same guard on the manual
  // journal-line edit route below: if a future category or import path ever
  // produces a VAT line, it is still blocked here at the single point where
  // every transaction's initial journal lines get written.
  if (!client.isVatRegistered) {
    const blocked = journalLines.some((line) => isVatAccount(line.accountNumber));
    if (blocked) {
      const err = new ClientNotVatRegisteredError();
      throw new HttpError(err.statusCode, err.message);
    }
  }

  const source = isPortalRole(req.user!.role) ? "pme_entry" : "manual_cabinet";

  // Module M8: run the rule-based anomaly/duplicate detector before this
  // entry reaches the M3 review queue, so the accountant sees the warning
  // from the very first time it appears there. Never blocks creation --
  // only surfaces a flag the accountant can override ("Forcer la
  // validation").
  const anomalies = await detectAnomalies({
    firmId: req.user!.firmId,
    clientId: body.clientId,
    date: body.date,
    amount: body.amount,
    category: body.category,
    type: body.type,
    journalLines,
  });

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: body.clientId,
      date: body.date,
      label: body.label,
      amount: body.amount,
      type: body.type,
      category: body.category,
      paymentType: body.paymentType,
      paymentMethod: body.paymentType === "cash" ? body.paymentMethod : null,
      dueDate: body.paymentType === "credit" ? body.dueDate : null,
      documentId: body.documentId ?? null,
      cashRegisterId,
      status: "a_valider",
      source,
      anomalies,
      createdById: req.user!.id,
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

  if (cashRegisterId) {
    await applyCashRegisterMovement(cashRegisterId, body.type, body.amount);
  }

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_CREATE,
    entityType: "transaction",
    entityId: tx.id,
    details: `Déclaration "${body.label}" (${body.amount} FCFA) pour "${client.name}"`,
    ipAddress: req.ip,
  });

  return { tx, client, cashRegisterName };
}

// Module P3: the plain-language category menu the PME picks from, scoped to
// the operation type (Recette/Dépense tab) they're currently filling in.
router.get("/accounting/categories", (req, res) => {
  const { type } = ListTransactionCategoriesQueryParams.parse(req.query);
  res.json(ListTransactionCategoriesResponse.parse(listCategoriesForType(type)));
});

// Module P3/M3: the shared journal-entry feed. Espace PME accounts (client_pme)
// only ever see their own client's entries; cabinet staff see every entry for
// the firm (optionally filtered to one client), which is what drives the
// M3 "à valider" review queue.
router.get("/transactions", requirePermission("operations.view", "caisse.view"), async (req, res) => {
  const { clientId, status } = ListTransactionsQueryParams.parse(req.query);

  if (isPortalRole(req.user!.role)) {
    if (!req.user!.clientId || (clientId && clientId !== req.user!.clientId)) {
      res.json(ListTransactionsResponse.parse([]));
      return;
    }
  }
  const effectiveClientId = isPortalRole(req.user!.role) ? req.user!.clientId! : clientId;

  const conditions = [eq(transactionsTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(transactionsTable.clientId, effectiveClientId));
  if (status) conditions.push(eq(transactionsTable.status, status));

  const transactions = await db.query.transactionsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.date), desc(t.createdAt)],
    with: {
      client: true,
      document: true,
      createdBy: true,
      validatedBy: true,
      journalLines: true,
      cashRegister: true,
    },
  });

  res.json(
    ListTransactionsResponse.parse(
      transactions.map((t) => ({
        ...serializeTransaction(t, {
          clientName: t.client?.name,
          documentFileName: t.document?.fileName,
          createdByName: t.createdBy?.fullName,
          validatedByName: t.validatedBy?.fullName,
          cashRegisterName: t.cashRegister?.name,
        }),
        journalLines: t.journalLines,
      })),
    ),
  );
});

// Module P3: a PME (or the cabinet, for a manual entry) declares one cash
// movement in plain language. The matching engine immediately computes its
// SYSCOHADA double-entry lines and the transaction lands as "à valider" in
// the M3 review queue.
router.post("/transactions", requirePermission("operations.create", "caisse.create"), async (req, res) => {
  const body = CreateTransactionBody.parse(req.body);

  try {
    const { tx, client, cashRegisterName } = await createTransactionEntry(req, body);
    res
      .status(201)
      .json(
        CreateTransactionResponse.parse(
          await withJournalLines(tx, {
            clientName: client.name,
            createdByName: req.user!.fullName,
            cashRegisterName,
          }),
        ),
      );
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// Module P5 (Caisse Terrain) offline sync: a Caisse Express device queues
// quick cash entries locally (LocalStorage/IndexedDB) while hors-ligne, then
// flushes them here once back online. Each entry is validated and inserted
// independently so one bad entry never blocks the rest of the batch.
router.post("/transactions/batch", requirePermission("operations.create", "caisse.create"), async (req, res) => {
  const body = BatchCreateTransactionsBody.parse(req.body);

  const created: Awaited<ReturnType<typeof withJournalLines>>[] = [];
  const errors: { index: number; error: string }[] = [];

  for (let index = 0; index < body.entries.length; index++) {
    try {
      const { tx, client, cashRegisterName } = await createTransactionEntry(
        req,
        body.entries[index],
      );
      created.push(
        await withJournalLines(tx, {
          clientName: client.name,
          createdByName: req.user!.fullName,
          cashRegisterName,
        }),
      );
    } catch (err) {
      if (err instanceof HttpError) {
        errors.push({ index, error: err.message });
      } else {
        throw err;
      }
    }
  }

  if (created.length > 0) {
    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.CASH_ENTRIES_SYNC,
      entityType: "transaction",
      details: `Synchronisation hors-ligne : ${created.length} opération(s) importée(s)${errors.length ? `, ${errors.length} en échec` : ""}`,
      ipAddress: req.ip,
    });
  }

  res.json(BatchCreateTransactionsResponse.parse({ created, errors }));
});

router.get("/transactions/:id", requirePermission("operations.view", "caisse.view"), async (req, res) => {
  const { id } = GetTransactionParams.parse(req.params);

  const tx = await db.query.transactionsTable.findFirst({
    where: and(eq(transactionsTable.id, id), eq(transactionsTable.firmId, req.user!.firmId)),
    with: { client: true, document: true, createdBy: true, validatedBy: true, cashRegister: true },
  });
  if (!tx) {
    res.status(404).json({ error: "Opération introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, tx.clientId)) return;

  res.json(
    GetTransactionResponse.parse(
      await withJournalLines(tx, {
        clientName: tx.client?.name,
        documentFileName: tx.document?.fileName,
        createdByName: tx.createdBy?.fullName,
        validatedByName: tx.validatedBy?.fullName,
        cashRegisterName: tx.cashRegister?.name,
      }),
    ),
  );
});

// Module M3: "Approuver & Comptabiliser" -- permanently locks the entry into
// the general ledger. Only cabinet staff empowered to validate the ledger
// may do this; a stagiaire has read-only access here just like on the visa
// checklist.
router.post(
  "/transactions/:id/approve",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = ApproveTransactionParams.parse(req.params);

    const tx = await db.query.transactionsTable.findFirst({
      where: and(eq(transactionsTable.id, id), eq(transactionsTable.firmId, req.user!.firmId)),
      with: { client: true, document: true, createdBy: true },
    });
    if (!tx) {
      res.status(404).json({ error: "Opération introuvable." });
      return;
    }
    if (tx.status === "valide") {
      res.status(409).json({ error: "Cette opération est déjà comptabilisée." });
      return;
    }
    if (await isPeriodLocked(req.user!.firmId, tx.clientId, tx.date.getFullYear())) {
      res.status(403).json({
        error: `L'exercice ${tx.date.getFullYear()} est définitivement clôturé. Cette opération ne peut plus être comptabilisée.`,
      });
      return;
    }

    const [updated] = await db
      .update(transactionsTable)
      .set({ status: "valide", validatedById: req.user!.id, validatedAt: new Date(), clarificationNote: null })
      .where(eq(transactionsTable.id, id))
      .returning();

    // Module M8: an entry carrying an unresolved anomaly flag that still
    // gets approved is, by definition, being "forcée" by the accountant --
    // record that distinctly in the audit trail rather than as a routine
    // approval, without ever blocking the action itself.
    const hadAnomalies = (tx.anomalies ?? []).length > 0;
    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: hadAnomalies ? AuditAction.TRANSACTION_FORCE_VALIDATE : AuditAction.TRANSACTION_APPROVE,
      entityType: "transaction",
      entityId: id,
      details: hadAnomalies
        ? `Validation forcée de "${tx.label}" (${tx.amount} FCFA) malgré anomalie(s) : ${(tx.anomalies ?? []).join(", ")}`
        : `Comptabilisation de "${tx.label}" (${tx.amount} FCFA)`,
      ipAddress: req.ip,
    });

    // -----------------------------------------------------------------------
    // Auto-sync (M17 bridge): detect Class 2 debit lines in the validated
    // transaction and create pending fixed-asset stubs in the registry.
    // Accounts 27x (Avances et acomptes versés) are intentionally excluded —
    // they are balance-sheet receivables, not depreciable assets.
    // -----------------------------------------------------------------------
    const journalLines = await db.query.journalLinesTable.findMany({
      where: eq(journalLinesTable.transactionId, id),
    });

    const class2DebitLines = journalLines.filter(
      (line) =>
        line.debitAmount > 0 &&
        line.accountNumber.startsWith("2") &&
        !line.accountNumber.startsWith("27"),
    );

    const autoCreatedAssets: {
      id: number;
      accountNumber: string;
      label: string;
      acquisitionCost: number;
    }[] = [];

    for (const line of class2DebitLines) {
      const [newAsset] = await db
        .insert(fixedAssetsTable)
        .values({
          firmId: req.user!.firmId,
          clientId: tx.clientId,
          accountNumber: line.accountNumber,
          // Prefer the transaction's own description (the invoice/operation
          // label the accountant entered) over the journal line's label,
          // which is usually just the generic counterpart-account name
          // (e.g. "Autres charges externes") and not useful in the registry.
          label: tx.label || line.label || "",
          acquisitionDate: tx.date,
          acquisitionCost: line.debitAmount,
          depreciationType: null,   // accountant must complete
          usefulLifeYears: null,    // accountant must complete
          salvageValue: 0,
          status: "ACTIF",
          syncedFromTransactionId: tx.id,
          createdById: req.user!.id,
        })
        .returning();

      autoCreatedAssets.push({
        id: newAsset.id,
        accountNumber: newAsset.accountNumber,
        label: newAsset.label,
        acquisitionCost: newAsset.acquisitionCost,
      });

      await logAudit({
        firmId: req.user!.firmId,
        userId: req.user!.id,
        userName: req.user!.fullName,
        userRole: req.user!.role,
        action: AuditAction.FIXED_ASSET_CREATE,
        entityType: "fixed_asset",
        entityId: newAsset.id,
        details: `Immobilisation synchronisée depuis transaction #${tx.id} : "${newAsset.label}" (compte ${newAsset.accountNumber}, ${newAsset.acquisitionCost.toLocaleString("fr")} FCFA) — paramètres d'amortissement à configurer.`,
        ipAddress: req.ip,
      });
    }

    res.json(
      ApproveTransactionResponse.parse({
        ...(await withJournalLines(updated, {
          clientName: tx.client?.name,
          documentFileName: tx.document?.fileName,
          createdByName: tx.createdBy?.fullName,
          validatedByName: req.user!.fullName,
        })),
        autoCreatedAssets,
      }),
    );
  },
);

// Module M3: "Invalider" -- sends the entry back to the PME with a
// mandatory clarification note explaining what needs to be fixed.
router.post(
  "/transactions/:id/reject",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = RejectTransactionParams.parse(req.params);
    const body = RejectTransactionBody.parse(req.body);

    const tx = await db.query.transactionsTable.findFirst({
      where: and(eq(transactionsTable.id, id), eq(transactionsTable.firmId, req.user!.firmId)),
      with: { client: true, document: true, createdBy: true },
    });
    if (!tx) {
      res.status(404).json({ error: "Opération introuvable." });
      return;
    }
    if (tx.status === "valide") {
      res.status(409).json({
        error: "Cette opération est déjà comptabilisée et ne peut plus être invalidée.",
      });
      return;
    }

    const [updated] = await db
      .update(transactionsTable)
      .set({
        status: "anomalie",
        clarificationNote: body.clarificationNote,
        validatedById: null,
        validatedAt: null,
      })
      .where(eq(transactionsTable.id, id))
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.TRANSACTION_REJECT,
      entityType: "transaction",
      entityId: id,
      details: `Invalidation de "${tx.label}" : ${body.clarificationNote}`,
      ipAddress: req.ip,
    });

    res.json(
      RejectTransactionResponse.parse(
        await withJournalLines(updated, {
          clientName: tx.client?.name,
          documentFileName: tx.document?.fileName,
          createdByName: tx.createdBy?.fullName,
        }),
      ),
    );
  },
);

// Module P3: "Marquer comme payé" -- the PME (or cabinet) declares an
// outstanding credit operation as settled. This never edits the original
// entry; it creates a new, separately reviewed "settlement" transaction
// carrying the second SYSCOHADA leg (4111/4011 -> treasury), so the general
// ledger always keeps both legs auditable.
router.post("/transactions/:id/settle", requirePermission("operations.create"), async (req, res) => {
  const { id } = SettleTransactionParams.parse(req.params);
  const body = SettleTransactionBody.parse(req.body);

  const tx = await db.query.transactionsTable.findFirst({
    where: and(eq(transactionsTable.id, id), eq(transactionsTable.firmId, req.user!.firmId)),
    with: { client: true },
  });
  if (!tx) {
    res.status(404).json({ error: "Opération introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, tx.clientId)) return;

  if (tx.paymentType !== "credit") {
    res.status(400).json({ error: "Cette opération n'est pas une opération à crédit." });
    return;
  }
  if (tx.status !== "valide") {
    res.status(400).json({
      error: "Cette facture doit être validée par le cabinet avant d'être réglée.",
    });
    return;
  }
  if (tx.settledAt) {
    res.status(409).json({ error: "Cette facture est déjà réglée." });
    return;
  }

  // Module P5: a cash settlement is a real physical cash movement, so it
  // needs a cash register just like any other espèces entry.
  let cashRegisterId: number | null = null;
  let cashRegisterName: string | null = null;
  if (body.paymentMethod === "especes") {
    if (!body.cashRegisterId) {
      res.status(400).json({ error: "La caisse est requise pour un règlement en espèces." });
      return;
    }
    const register = await db.query.cashRegistersTable.findFirst({
      where: and(
        eq(cashRegistersTable.id, body.cashRegisterId),
        eq(cashRegistersTable.clientId, tx.clientId),
      ),
    });
    if (!register) {
      res.status(404).json({ error: "Caisse introuvable pour ce client." });
      return;
    }
    cashRegisterId = register.id;
    cashRegisterName = register.name;
  }

  let journalLines: ReturnType<typeof computeSettlementJournalLines>;
  try {
    journalLines = computeSettlementJournalLines({
      type: tx.type,
      paymentMethod: body.paymentMethod,
      amount: tx.amount,
    });
  } catch (err) {
    if (err instanceof AccountingEngineError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [settlement] = await db
    .insert(transactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: tx.clientId,
      date: new Date(),
      label: `Règlement - ${tx.label}`,
      amount: tx.amount,
      type: tx.type,
      category: tx.category,
      paymentType: "cash",
      paymentMethod: body.paymentMethod,
      cashRegisterId,
      status: "a_valider",
      source: "settlement",
      parentTransactionId: tx.id,
      createdById: req.user!.id,
    })
    .returning();

  await db.insert(journalLinesTable).values(
    journalLines.map((line) => ({
      transactionId: settlement.id,
      accountNumber: line.accountNumber,
      label: line.label,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
    })),
  );

  if (cashRegisterId) {
    await applyCashRegisterMovement(cashRegisterId, tx.type, tx.amount);
  }

  await db
    .update(transactionsTable)
    .set({ settledAt: new Date() })
    .where(eq(transactionsTable.id, tx.id));

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_SETTLE,
    entityType: "transaction",
    entityId: settlement.id,
    details: `Règlement de "${tx.label}" (${tx.amount} FCFA) pour "${tx.client?.name}"`,
    ipAddress: req.ip,
  });

  res
    .status(201)
    .json(
      SettleTransactionResponse.parse(
        await withJournalLines(settlement, {
          clientName: tx.client?.name,
          createdByName: req.user!.fullName,
          cashRegisterName,
        }),
      ),
    );
});

// Module M3: lets the accountant adjust the account number of a computed
// journal line (e.g. redirect the generic 4111/4011 mapping to a more
// specific sub-account) before approving. Amounts are never editable here --
// only account numbers -- so the entry always stays balanced.
router.patch(
  "/transactions/:id/journal-lines",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = UpdateTransactionJournalLinesParams.parse(req.params);
    const body = UpdateTransactionJournalLinesBody.parse(req.body);

    const tx = await db.query.transactionsTable.findFirst({
      where: and(eq(transactionsTable.id, id), eq(transactionsTable.firmId, req.user!.firmId)),
      with: {
        client: true,
        document: true,
        createdBy: true,
        validatedBy: true,
        journalLines: true,
        cashRegister: true,
      },
    });
    if (!tx) {
      res.status(404).json({ error: "Opération introuvable." });
      return;
    }
    if (tx.status !== "a_valider") {
      res.status(409).json({
        error: "Les comptes ne peuvent être ajustés que pour une opération à valider.",
      });
      return;
    }
    if (await isPeriodLocked(req.user!.firmId, tx.clientId, tx.date.getFullYear())) {
      res.status(403).json({
        error: `L'exercice ${tx.date.getFullYear()} est définitivement clôturé. Cette opération ne peut plus être modifiée.`,
      });
      return;
    }

    const existingIds = new Set(tx.journalLines.map((line) => line.id));
    for (const line of body.lines) {
      if (!existingIds.has(line.id)) {
        res.status(400).json({ error: "Ligne d'écriture introuvable pour cette opération." });
        return;
      }
    }

    // VAT-exemption guard: a client whose dossier is not VAT-registered
    // (isVatRegistered = false) may never have a line redirected onto a
    // class 443 (TVA Collectée) or 445 (TVA Déductible) account -- the
    // TTC amount must stay entirely on the class 6/2 counterpart account.
    if (tx.client && !tx.client.isVatRegistered) {
      for (const line of body.lines) {
        if (isVatAccount(line.accountNumber)) {
          const err = new ClientNotVatRegisteredError();
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
      }
    }

    for (const line of body.lines) {
      await db
        .update(journalLinesTable)
        .set({ accountNumber: line.accountNumber })
        .where(
          and(eq(journalLinesTable.id, line.id), eq(journalLinesTable.transactionId, tx.id)),
        );
    }

    // Module M8: an account-number redirect can turn a previously coherent
    // entry into an incoherent one (or vice versa) -- recompute all rules
    // rather than patching just the incoherence flag, since the accountant
    // may also have caught up on a duplicate/spike in the meantime.
    const updatedLines = body.lines.map((line) => ({ accountNumber: line.accountNumber }));
    const untouchedLines = tx.journalLines
      .filter((line) => !body.lines.some((updated) => updated.id === line.id))
      .map((line) => ({ accountNumber: line.accountNumber }));
    const anomalies = await detectAnomalies({
      transactionId: tx.id,
      firmId: req.user!.firmId,
      clientId: tx.clientId,
      date: tx.date,
      amount: tx.amount,
      category: tx.category,
      type: tx.type,
      journalLines: [...updatedLines, ...untouchedLines],
    });
    const [updatedTx] = await db
      .update(transactionsTable)
      .set({ anomalies })
      .where(eq(transactionsTable.id, tx.id))
      .returning();

    // Module M14: capture the exact "before"/"after" account numbers so the
    // compliance log can show precisely what the accountant changed --
    // this is the same shape used for an AI_OVERRIDE (module M13), just
    // sourced from a manual edit instead of an AI pre-fill being corrected.
    const beforeAccounts: Record<string, unknown> = {};
    const afterAccounts: Record<string, unknown> = {};
    for (const line of body.lines) {
      const original = tx.journalLines.find((l) => l.id === line.id);
      beforeAccounts[`line_${line.id}`] = original?.accountNumber ?? null;
      afterAccounts[`line_${line.id}`] = line.accountNumber;
    }

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.TRANSACTION_JOURNAL_LINES_UPDATE,
      entityType: "transaction",
      entityId: tx.id,
      details: `Ajustement des comptes de l'écriture de "${tx.label}"`,
      ipAddress: req.ip,
      changesPayload: { before: beforeAccounts, after: afterAccounts },
    });

    res.json(
      UpdateTransactionJournalLinesResponse.parse(
        await withJournalLines(updatedTx, {
          clientName: tx.client?.name,
          documentFileName: tx.document?.fileName,
          createdByName: tx.createdBy?.fullName,
          validatedByName: tx.validatedBy?.fullName,
          cashRegisterName: tx.cashRegister?.name,
        }),
      ),
    );
  },
);

export default router;
