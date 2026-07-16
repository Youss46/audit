import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  invoicesTable,
  mobileMoneyAccountsTable,
  mobileMoneyTransactionsTable,
  isPortalRole,
  type MobileMoneyAccountRow,
  type MobileMoneyTransactionRow,
} from "@workspace/db";
import { requireAuth, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  computeMobileMoneyVirementJournalLines,
  computeMobileMoneyInflowJournalLines,
  computeMobileMoneyRepatriationOutflowLines,
  computeMobileMoneyRepatriationReceptionLines,
  MOBILE_MONEY_PROVIDER_LABELS,
  AccountingEngineError,
} from "../lib/accounting-engine";
import { isPeriodLocked } from "../lib/closing-engine";
import { withJournalLines, HttpError } from "./accounting";
import {
  CreateMobileMoneyTransferBody,
  CreateMobileMoneyTransferResponse,
  ListMobileMoneyAccountsQueryParams,
  CreateMobileMoneyAccountBody,
  UpdateMobileMoneyAccountParams,
  UpdateMobileMoneyAccountBody,
  ListMobileMoneyTransactionsQueryParams,
  RecordMobileMoneySaleBody,
  RecordMobileMoneySaleResponse,
  CreateMobileMoneyRepatriationBody,
  CreateMobileMoneyRepatriationResponse,
  ConfirmMobileMoneyRepatriationReceptionParams,
  ConfirmMobileMoneyRepatriationReceptionResponse,
} from "@workspace/api-zod";

// Module P7 Mobile Money (Cabinet only): records a "Virement Mobile Money →
// Banque" withdrawal for a station-service client. The compound SYSCOHADA
// entry debits 52 (Banques) for the net amount, debits 631700 (Frais sur
// instruments monétaires électroniques) for the operator fee, and credits
// the relevant Classe 55 account (552100/552200/552300/552400).

const router: IRouter = Router();

router.use(requireAuth);

router.post("/mobile-money/transfers", async (req, res) => {
  // Cabinet-only: portal roles (POMPISTE, CLIENT_PME, etc.) cannot record
  // cross-account fund transfers -- only an accountant can.
  if (isPortalRole(req.user!.role)) {
    res.status(403).json({ error: "Accès réservé au cabinet comptable." });
    return;
  }

  const body = CreateMobileMoneyTransferBody.parse(req.body);

  // Prevent booking into a locked fiscal year.
  const txDate = new Date(body.date instanceof Date ? body.date : String(body.date));
  const txYear = txDate.getFullYear();
  if (await isPeriodLocked(req.user!.firmId, body.clientId, txYear)) {
    res.status(403).json({
      error: `L'exercice ${txYear} est définitivement clôturé. Aucune écriture ne peut y être ajoutée.`,
    });
    return;
  }

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  if (body.feeAmount >= body.totalAmount) {
    res
      .status(400)
      .json({ error: "Les frais de retrait ne peuvent pas être supérieurs ou égaux au montant total du virement." });
    return;
  }

  const providerLabel = MOBILE_MONEY_PROVIDER_LABELS[body.provider] ?? body.provider;

  const journalLines = computeMobileMoneyVirementJournalLines({
    provider: body.provider,
    totalAmount: body.totalAmount,
    feeAmount: body.feeAmount,
  });

  const txLabel =
    body.note?.trim() ||
    `Virement ${providerLabel} → Banque — ${client.name}`;

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: body.clientId,
      date: txDate,
      label: txLabel,
      amount: body.totalAmount,
      type: "depense",
      category: "frais_mobile_money",
      paymentType: "cash",
      paymentMethod: "mobile_money",
      status: "a_valider",
      source: "manual_cabinet",
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
    entityType: "mobile_money_transfer",
    entityId: tx.id,
    details: `Virement ${providerLabel} → Banque : ${body.totalAmount} FCFA (dont frais : ${body.feeAmount} FCFA) — ${client.name}`,
    ipAddress: req.ip,
  });

  const transaction = await withJournalLines(tx, {
    clientName: client.name,
    createdByName: req.user!.fullName,
  });

  res.status(201).json(CreateMobileMoneyTransferResponse.parse({ transaction }));
});

// ---------------------------------------------------------------------------
// Module Trésorerie Mobile Money (generalized, all PME clients)
// ---------------------------------------------------------------------------

function serializeAccount(row: MobileMoneyAccountRow) {
  return {
    id: row.id,
    clientId: row.clientId,
    provider: row.provider,
    accountNumber: row.accountNumber,
    label: row.label,
    isActive: row.isActive,
    balance: row.balance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeMMTransaction(
  row: MobileMoneyTransactionRow,
  extra: { provider?: string; invoiceNumber?: string | null },
) {
  return {
    id: row.id,
    mobileMoneyAccountId: row.mobileMoneyAccountId,
    provider: extra.provider,
    invoiceId: row.invoiceId,
    invoiceNumber: extra.invoiceNumber ?? null,
    transactionId: row.transactionId,
    type: row.type,
    status: row.status,
    amount: row.amount,
    feeAmount: row.feeAmount,
    referenceCode: row.referenceCode,
    label: row.label,
    date: row.date,
    createdAt: row.createdAt,
  };
}

async function loadOwnedAccount(
  accountId: number,
  clientId: number,
  firmId: number,
): Promise<MobileMoneyAccountRow> {
  const account = await db.query.mobileMoneyAccountsTable.findFirst({
    where: and(
      eq(mobileMoneyAccountsTable.id, accountId),
      eq(mobileMoneyAccountsTable.clientId, clientId),
      eq(mobileMoneyAccountsTable.firmId, firmId),
    ),
  });
  if (!account) throw new HttpError(404, "Compte Mobile Money introuvable pour ce client.");
  return account;
}

// -- Accounts (merchant profiles) --------------------------------------------
router.get("/mobile-money/accounts", requirePermission("facturation.view"), async (req, res) => {
  const query = ListMobileMoneyAccountsQueryParams.parse(req.query);
  const isClientPme = isPortalRole(req.user!.role);
  const effectiveClientId = isClientPme ? req.user!.clientId! : query.clientId;

  const conditions = [eq(mobileMoneyAccountsTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(mobileMoneyAccountsTable.clientId, effectiveClientId));

  const rows = await db.query.mobileMoneyAccountsTable.findMany({
    where: and(...conditions),
    orderBy: [desc(mobileMoneyAccountsTable.createdAt)],
  });
  res.json(rows.map(serializeAccount));
});

router.post("/mobile-money/accounts", requirePermission("facturation.create"), async (req, res) => {
  const body = CreateMobileMoneyAccountBody.parse(req.body);
  const isClientPme = isPortalRole(req.user!.role);
  const clientId = isClientPme ? req.user!.clientId! : body.clientId;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) throw new HttpError(404, "Client introuvable.");

  const [account] = await db
    .insert(mobileMoneyAccountsTable)
    .values({
      firmId: req.user!.firmId,
      clientId,
      provider: body.provider,
      accountNumber: body.accountNumber,
      label: body.label ?? null,
      createdById: req.user!.id,
    })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_CREATE,
    entityType: "mobile_money_account",
    entityId: account.id,
    details: `Compte Mobile Money ajouté : ${MOBILE_MONEY_PROVIDER_LABELS[body.provider] ?? body.provider} (${body.accountNumber}) — ${client.name}`,
    ipAddress: req.ip,
  });

  res.status(201).json(serializeAccount(account));
});

router.patch("/mobile-money/accounts/:id", requirePermission("facturation.create"), async (req, res) => {
  const { id } = UpdateMobileMoneyAccountParams.parse(req.params);
  const body = UpdateMobileMoneyAccountBody.parse(req.body);

  const account = await db.query.mobileMoneyAccountsTable.findFirst({
    where: and(eq(mobileMoneyAccountsTable.id, id), eq(mobileMoneyAccountsTable.firmId, req.user!.firmId)),
  });
  if (!account) throw new HttpError(404, "Compte Mobile Money introuvable.");
  if (isPortalRole(req.user!.role) && account.clientId !== req.user!.clientId) {
    throw new HttpError(403, "Accès non autorisé à ce compte Mobile Money.");
  }

  const [updated] = await db
    .update(mobileMoneyAccountsTable)
    .set({
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive ? "true" : "false" } : {}),
    })
    .where(eq(mobileMoneyAccountsTable.id, id))
    .returning();

  res.json(serializeAccount(updated));
});

// -- Transaction history -------------------------------------------------
router.get("/mobile-money/transactions", requirePermission("facturation.view"), async (req, res) => {
  const query = ListMobileMoneyTransactionsQueryParams.parse(req.query);
  const isClientPme = isPortalRole(req.user!.role);
  const effectiveClientId = isClientPme ? req.user!.clientId! : query.clientId;

  const conditions = [eq(mobileMoneyTransactionsTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(mobileMoneyTransactionsTable.clientId, effectiveClientId));
  if (query.mobileMoneyAccountId) {
    conditions.push(eq(mobileMoneyTransactionsTable.mobileMoneyAccountId, query.mobileMoneyAccountId));
  }

  const rows = await db.query.mobileMoneyTransactionsTable.findMany({
    where: and(...conditions),
    with: {
      account: { columns: { provider: true } },
      invoice: { columns: { invoiceNumber: true } },
    },
    orderBy: [desc(mobileMoneyTransactionsTable.date)],
  });

  res.json(
    rows.map((r) =>
      serializeMMTransaction(r, {
        provider: r.account?.provider,
        invoiceNumber: r.invoice?.invoiceNumber,
      }),
    ),
  );
});

// -- Manual daily sale ("Ventes globales") --------------------------------
router.post("/mobile-money/sales", requirePermission("facturation.create"), async (req, res) => {
  const body = RecordMobileMoneySaleBody.parse(req.body);
  const isClientPme = isPortalRole(req.user!.role);
  const clientId = isClientPme ? req.user!.clientId! : body.clientId;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) throw new HttpError(404, "Client introuvable.");

  const account = await loadOwnedAccount(body.mobileMoneyAccountId, clientId, req.user!.firmId);

  const txDate = new Date(body.date instanceof Date ? body.date : String(body.date));
  const txYear = txDate.getFullYear();
  if (await isPeriodLocked(req.user!.firmId, clientId, txYear)) {
    throw new HttpError(403, `L'exercice ${txYear} est définitivement clôturé. Aucune écriture ne peut y être ajoutée.`);
  }

  const salesLabel = body.salesAccount === "701" ? "Ventes de marchandises" : "Prestations de services";
  let journalLines;
  try {
    journalLines = computeMobileMoneyInflowJournalLines({
      provider: account.provider,
      totalAmount: body.amount,
      feeAmount: body.feeAmount ?? 0,
      creditAccount: body.salesAccount,
      creditLabel: salesLabel,
    });
  } catch (err) {
    if (err instanceof AccountingEngineError) throw new HttpError(400, err.message);
    throw err;
  }

  const providerLabel = MOBILE_MONEY_PROVIDER_LABELS[account.provider] ?? account.provider;
  const label = body.note?.trim() || `Vente globale ${providerLabel} — ${client.name}`;

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId,
      date: txDate,
      label,
      amount: body.amount,
      type: "recette",
      category: "Ventes Mobile Money",
      paymentType: "cash",
      paymentMethod: "mobile_money",
      status: "a_valider",
      source: "manual_cabinet",
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

  const netAmount = body.amount - (body.feeAmount ?? 0);
  const [updatedAccount] = await db
    .update(mobileMoneyAccountsTable)
    .set({ balance: account.balance + netAmount })
    .where(eq(mobileMoneyAccountsTable.id, account.id))
    .returning();

  await db.insert(mobileMoneyTransactionsTable).values({
    firmId: req.user!.firmId,
    clientId,
    mobileMoneyAccountId: account.id,
    transactionId: tx.id,
    type: "inflow",
    status: "completed",
    amount: body.amount,
    feeAmount: body.feeAmount ?? 0,
    label,
    date: txDate,
    createdById: req.user!.id,
  });

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_CREATE,
    entityType: "mobile_money_sale",
    entityId: tx.id,
    details: `Vente globale ${providerLabel} : ${body.amount} FCFA (dont frais : ${body.feeAmount ?? 0} FCFA) — ${client.name}`,
    ipAddress: req.ip,
  });

  const transaction = await withJournalLines(tx, {
    clientName: client.name,
    createdByName: req.user!.fullName,
  });

  res.status(201).json(
    RecordMobileMoneySaleResponse.parse({ transaction, account: serializeAccount(updatedAccount) }),
  );
});

// -- Bank repatriation (2-step: 585 transit → 5211 Banque) ------------------
router.post("/mobile-money/repatriations", requirePermission("facturation.create"), async (req, res) => {
  const body = CreateMobileMoneyRepatriationBody.parse(req.body);
  const isClientPme = isPortalRole(req.user!.role);
  const clientId = isClientPme ? req.user!.clientId! : body.clientId;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) throw new HttpError(404, "Client introuvable.");

  const account = await loadOwnedAccount(body.mobileMoneyAccountId, clientId, req.user!.firmId);
  if (body.amount > account.balance) {
    throw new HttpError(400, "Le montant du rapatriement dépasse le solde disponible sur ce compte Mobile Money.");
  }

  const txDate = new Date(body.date instanceof Date ? body.date : String(body.date));
  const txYear = txDate.getFullYear();
  if (await isPeriodLocked(req.user!.firmId, clientId, txYear)) {
    throw new HttpError(403, `L'exercice ${txYear} est définitivement clôturé. Aucune écriture ne peut y être ajoutée.`);
  }

  const providerLabel = MOBILE_MONEY_PROVIDER_LABELS[account.provider] ?? account.provider;
  const label = body.note?.trim() || `Rapatriement de fonds ${providerLabel} → Banque — ${client.name}`;

  const journalLines = computeMobileMoneyRepatriationOutflowLines({
    provider: account.provider,
    amount: body.amount,
  });

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId,
      date: txDate,
      label,
      amount: body.amount,
      type: "depense",
      category: "Rapatriement Mobile Money",
      paymentType: "cash",
      paymentMethod: "mobile_money",
      status: "a_valider",
      source: "manual_cabinet",
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

  const [updatedAccount] = await db
    .update(mobileMoneyAccountsTable)
    .set({ balance: account.balance - body.amount })
    .where(eq(mobileMoneyAccountsTable.id, account.id))
    .returning();

  const [mmTx] = await db
    .insert(mobileMoneyTransactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId,
      mobileMoneyAccountId: account.id,
      transactionId: tx.id,
      type: "outflow",
      status: "initiated",
      amount: body.amount,
      feeAmount: 0,
      label,
      date: txDate,
      createdById: req.user!.id,
    })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_CREATE,
    entityType: "mobile_money_repatriation",
    entityId: tx.id,
    details: `Rapatriement initié ${providerLabel} → 585 (transit) : ${body.amount} FCFA — ${client.name}`,
    ipAddress: req.ip,
  });

  const transaction = await withJournalLines(tx, {
    clientName: client.name,
    createdByName: req.user!.fullName,
  });

  res.status(201).json(
    CreateMobileMoneyRepatriationResponse.parse({
      transaction,
      mobileMoneyTransaction: serializeMMTransaction(mmTx, { provider: account.provider }),
      account: serializeAccount(updatedAccount),
    }),
  );
});

router.post(
  "/mobile-money/repatriations/:id/confirm-reception",
  requirePermission("facturation.create"),
  async (req, res) => {
    const { id } = ConfirmMobileMoneyRepatriationReceptionParams.parse(req.params);

    const mmTx = await db.query.mobileMoneyTransactionsTable.findFirst({
      where: and(eq(mobileMoneyTransactionsTable.id, id), eq(mobileMoneyTransactionsTable.firmId, req.user!.firmId)),
      with: { account: true, client: { columns: { name: true } } },
    });
    if (!mmTx || mmTx.type !== "outflow") throw new HttpError(404, "Rapatriement introuvable.");
    if (isPortalRole(req.user!.role) && mmTx.clientId !== req.user!.clientId) {
      throw new HttpError(403, "Accès non autorisé à ce rapatriement.");
    }
    if (mmTx.status !== "initiated") {
      throw new HttpError(409, "Ce rapatriement a déjà été confirmé.");
    }

    const journalLines = computeMobileMoneyRepatriationReceptionLines({ amount: mmTx.amount });

    const [tx] = await db
      .insert(transactionsTable)
      .values({
        firmId: req.user!.firmId,
        clientId: mmTx.clientId,
        date: new Date(),
        label: `Réception en banque — ${mmTx.label}`,
        amount: mmTx.amount,
        type: "recette",
        category: "Rapatriement Mobile Money",
        paymentType: "cash",
        paymentMethod: "virement",
        status: "a_valider",
        source: "manual_cabinet",
        parentTransactionId: mmTx.transactionId,
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

    const [updatedMmTx] = await db
      .update(mobileMoneyTransactionsTable)
      .set({ status: "completed" })
      .where(eq(mobileMoneyTransactionsTable.id, mmTx.id))
      .returning();

    // Companion "transfer_received" row so the transaction history shows
    // both legs of the repatriation distinctly.
    await db.insert(mobileMoneyTransactionsTable).values({
      firmId: req.user!.firmId,
      clientId: mmTx.clientId,
      mobileMoneyAccountId: mmTx.mobileMoneyAccountId,
      transactionId: tx.id,
      parentMobileMoneyTransactionId: mmTx.id,
      type: "transfer_received",
      status: "completed",
      amount: mmTx.amount,
      feeAmount: 0,
      label: `Réception en banque — ${mmTx.label}`,
      date: new Date(),
      createdById: req.user!.id,
    });

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.TRANSACTION_CREATE,
      entityType: "mobile_money_repatriation",
      entityId: tx.id,
      details: `Rapatriement confirmé en banque (5211) : ${mmTx.amount} FCFA — ${mmTx.client?.name}`,
      ipAddress: req.ip,
    });

    const transaction = await withJournalLines(tx, {
      clientName: mmTx.client?.name,
      createdByName: req.user!.fullName,
    });

    res.json(
      ConfirmMobileMoneyRepatriationReceptionResponse.parse({
        transaction,
        mobileMoneyTransaction: serializeMMTransaction(updatedMmTx, { provider: mmTx.account?.provider }),
      }),
    );
  },
);

export default router;
