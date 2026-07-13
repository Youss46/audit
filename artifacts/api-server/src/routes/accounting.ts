import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  documentsTable,
  transactionsTable,
  journalLinesTable,
  usersTable,
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
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  AccountingEngineError,
  CATEGORY_RULES,
  computeJournalLines,
  computeSettlementJournalLines,
  listCategoriesForType,
} from "../lib/accounting-engine";

const router: IRouter = Router();

router.use(requireAuth);

function serializeTransaction(
  tx: typeof transactionsTable.$inferSelect,
  extra: {
    clientName?: string | null;
    documentFileName?: string | null;
    createdByName?: string | null;
    validatedByName?: string | null;
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
    createdByName: extra.createdByName ?? null,
    validatedByName: extra.validatedByName ?? null,
    validatedAt: tx.validatedAt ?? null,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
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
router.get("/transactions", async (req, res) => {
  const { clientId, status } = ListTransactionsQueryParams.parse(req.query);

  if (req.user!.role === "client_pme") {
    if (!req.user!.clientId || (clientId && clientId !== req.user!.clientId)) {
      res.json(ListTransactionsResponse.parse([]));
      return;
    }
  }
  const effectiveClientId = req.user!.role === "client_pme" ? req.user!.clientId! : clientId;

  const conditions = [eq(transactionsTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(transactionsTable.clientId, effectiveClientId));
  if (status) conditions.push(eq(transactionsTable.status, status));

  const transactions = await db.query.transactionsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.date), desc(t.createdAt)],
    with: { client: true, document: true, createdBy: true, validatedBy: true, journalLines: true },
  });

  res.json(
    ListTransactionsResponse.parse(
      transactions.map((t) => ({
        ...serializeTransaction(t, {
          clientName: t.client?.name,
          documentFileName: t.document?.fileName,
          createdByName: t.createdBy?.fullName,
          validatedByName: t.validatedBy?.fullName,
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
router.post("/transactions", async (req, res) => {
  const body = CreateTransactionBody.parse(req.body);

  if (!requireOwnClient(req, res, body.clientId)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  if (body.documentId != null) {
    const doc = await db.query.documentsTable.findFirst({
      where: and(
        eq(documentsTable.id, body.documentId),
        eq(documentsTable.clientId, body.clientId),
      ),
    });
    if (!doc) {
      res.status(404).json({ error: "Pièce jointe introuvable pour ce client." });
      return;
    }
  }

  // Cash (au comptant) operations require a payment method; credit (à
  // crédit) operations require a due date instead, and never touch treasury
  // until settled (see /transactions/:id/settle).
  if (body.paymentType === "cash" && !body.paymentMethod) {
    res.status(400).json({
      error: "Le mode de règlement est requis pour une opération au comptant.",
    });
    return;
  }
  if (body.paymentType === "credit" && !body.dueDate) {
    res.status(400).json({
      error: "La date d'échéance est requise pour une opération à crédit.",
    });
    return;
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
    if (err instanceof AccountingEngineError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const source = req.user!.role === "client_pme" ? "pme_entry" : "manual_cabinet";

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
      status: "a_valider",
      source,
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

  res
    .status(201)
    .json(
      CreateTransactionResponse.parse(
        await withJournalLines(tx, { clientName: client.name, createdByName: req.user!.fullName }),
      ),
    );
});

router.get("/transactions/:id", async (req, res) => {
  const { id } = GetTransactionParams.parse(req.params);

  const tx = await db.query.transactionsTable.findFirst({
    where: and(eq(transactionsTable.id, id), eq(transactionsTable.firmId, req.user!.firmId)),
    with: { client: true, document: true, createdBy: true, validatedBy: true },
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

    const [updated] = await db
      .update(transactionsTable)
      .set({ status: "valide", validatedById: req.user!.id, validatedAt: new Date(), clarificationNote: null })
      .where(eq(transactionsTable.id, id))
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.TRANSACTION_APPROVE,
      entityType: "transaction",
      entityId: id,
      details: `Comptabilisation de "${tx.label}" (${tx.amount} FCFA)`,
      ipAddress: req.ip,
    });

    res.json(
      ApproveTransactionResponse.parse(
        await withJournalLines(updated, {
          clientName: tx.client?.name,
          documentFileName: tx.document?.fileName,
          createdByName: tx.createdBy?.fullName,
          validatedByName: req.user!.fullName,
        }),
      ),
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
router.post("/transactions/:id/settle", async (req, res) => {
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
      with: { client: true, document: true, createdBy: true, validatedBy: true, journalLines: true },
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

    const existingIds = new Set(tx.journalLines.map((line) => line.id));
    for (const line of body.lines) {
      if (!existingIds.has(line.id)) {
        res.status(400).json({ error: "Ligne d'écriture introuvable pour cette opération." });
        return;
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
    });

    res.json(
      UpdateTransactionJournalLinesResponse.parse(
        await withJournalLines(tx, {
          clientName: tx.client?.name,
          documentFileName: tx.document?.fileName,
          createdByName: tx.createdBy?.fullName,
          validatedByName: tx.validatedBy?.fullName,
        }),
      ),
    );
  },
);

export default router;
