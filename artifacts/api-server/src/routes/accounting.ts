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
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  AccountingEngineError,
  CATEGORY_RULES,
  computeJournalLines,
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
    paymentMethod: tx.paymentMethod ?? null,
    status: tx.status,
    source: tx.source,
    documentId: tx.documentId ?? null,
    documentFileName: extra.documentFileName ?? null,
    clarificationNote: tx.clarificationNote ?? null,
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

  let journalLines: ReturnType<typeof computeJournalLines>;
  try {
    journalLines = computeJournalLines({
      category: body.category,
      type: body.type,
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
      paymentMethod: body.paymentMethod,
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

export default router;
