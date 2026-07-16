import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  purchasesTable,
  mobileMoneyAccountsTable,
  isPortalRole,
  type PurchaseRow,
} from "@workspace/db";
import { requireAuth, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  PURCHASE_CATEGORIES,
  MOBILE_MONEY_PROVIDER_ACCOUNTS,
  MOBILE_MONEY_PROVIDER_LABELS,
  computePurchaseJournalLines,
  computePurchaseSettlementLines,
  AccountingEngineError,
} from "../lib/accounting-engine";
import { isPeriodLocked } from "../lib/closing-engine";
import {
  ListPurchasesQueryParams,
  CreatePurchaseBody,
  GetPurchaseParams,
  SettlePurchaseParams,
  SettlePurchaseBody,
} from "@workspace/api-zod";

// Module Dépenses & Achats — structured purchase recording for all PME
// clients. Handles three payment modes:
//   - "credit"       → Cr 4011 Fournisseurs (HA journal, pending until settled)
//   - "bank"         → Cr 5211 Banques       (BQ journal, settled immediately)
//   - "mobile_money" → Cr 552xxx             (BQ journal, settled immediately)
// Every save produces a balanced SYSCOHADA double-entry via computePurchaseJournalLines.

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializePurchase(
  p: PurchaseRow & { mobileMoneyProvider?: string | null; mobileMoneyAccountNumber?: string | null },
) {
  const cat = PURCHASE_CATEGORIES[p.categoryKey];
  return {
    id: p.id,
    clientId: p.clientId,
    date: p.date,
    supplierName: p.supplierName,
    supplierNcc: p.supplierNcc ?? null,
    invoiceRef: p.invoiceRef ?? null,
    categoryKey: p.categoryKey,
    chargeAccount: p.chargeAccount,
    chargeName: p.chargeName,
    categoryLabel: cat?.label ?? p.chargeName,
    amountHt: p.amountHt,
    vatRate: p.vatRate,
    vatAmount: p.vatAmount,
    amountTtc: p.amountTtc,
    paymentMode: p.paymentMode,
    mobileMoneyAccountId: p.mobileMoneyAccountId ?? null,
    mobileMoneyProvider: p.mobileMoneyProvider ?? null,
    mobileMoneyAccountNumber: p.mobileMoneyAccountNumber ?? null,
    notes: p.notes ?? null,
    status: p.status,
    transactionId: p.transactionId ?? null,
    settlementTransactionId: p.settlementTransactionId ?? null,
    settledAt: p.settledAt ?? null,
    createdAt: p.createdAt,
  };
}

async function enrichWithMmAccount(rows: PurchaseRow[]) {
  const mmIds = [...new Set(rows.map((r) => r.mobileMoneyAccountId).filter(Boolean))] as number[];
  const mmMap = new Map<number, { provider: string; accountNumber: string }>();
  if (mmIds.length) {
    const accounts = await db.query.mobileMoneyAccountsTable.findMany({
      where: (t, { inArray }) => inArray(t.id, mmIds),
      columns: { id: true, provider: true, accountNumber: true },
    });
    for (const a of accounts) mmMap.set(a.id, a);
  }
  return rows.map((r) => ({
    ...r,
    mobileMoneyProvider: r.mobileMoneyAccountId ? (mmMap.get(r.mobileMoneyAccountId)?.provider ?? null) : null,
    mobileMoneyAccountNumber: r.mobileMoneyAccountId ? (mmMap.get(r.mobileMoneyAccountId)?.accountNumber ?? null) : null,
  }));
}

function getCreditAccount(
  paymentMode: "credit" | "bank" | "mobile_money",
  mmProvider?: string | null,
): { account: string; label: string; journal: "HA" | "BQ" } {
  if (paymentMode === "credit")       return { account: "4011", label: "Fournisseurs d'exploitation",   journal: "HA" };
  if (paymentMode === "bank")         return { account: "5211", label: "Banques locales",               journal: "BQ" };
  // mobile_money
  const acct  = mmProvider ? (MOBILE_MONEY_PROVIDER_ACCOUNTS[mmProvider] ?? "552") : "552";
  const label = mmProvider ? (MOBILE_MONEY_PROVIDER_LABELS[mmProvider]   ?? "Monnaie Électronique") : "Monnaie Électronique";
  return { account: acct, label, journal: "BQ" };
}

// ---------------------------------------------------------------------------
// GET /purchases/categories — must be before /:id
// ---------------------------------------------------------------------------
router.get("/purchases/categories", async (_req, res) => {
  res.json(
    Object.entries(PURCHASE_CATEGORIES).map(([key, c]) => ({
      key,
      label: c.label,
      account: c.account,
      accountName: c.accountName,
      vatEligible: c.vatEligible,
    })),
  );
});

// ---------------------------------------------------------------------------
// GET /purchases
// ---------------------------------------------------------------------------
router.get("/purchases", requirePermission("operations.view"), async (req, res) => {
  const query = ListPurchasesQueryParams.parse(req.query);

  // Portal roles are scoped to their own client; cabinet staff can filter.
  const effectiveClientId = isPortalRole(req.user!.role)
    ? req.user!.clientId!
    : (query.clientId ?? null);

  const rows = await db.query.purchasesTable.findMany({
    where: and(
      effectiveClientId ? eq(purchasesTable.clientId, effectiveClientId) : undefined,
      eq(purchasesTable.firmId, req.user!.firmId),
      query.status ? eq(purchasesTable.status, query.status) : undefined,
    ),
    orderBy: [desc(purchasesTable.date)],
  });

  const enriched = await enrichWithMmAccount(rows);
  res.json(enriched.map(serializePurchase));
});

// ---------------------------------------------------------------------------
// POST /purchases
// ---------------------------------------------------------------------------
router.post("/purchases", requirePermission("operations.create"), async (req, res) => {
  const body = CreatePurchaseBody.parse(req.body);

  // Ownership check for portal roles.
  if (isPortalRole(req.user!.role) && body.clientId !== req.user!.clientId) {
    res.status(403).json({ error: "Accès non autorisé à ce dossier client." });
    return;
  }

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) { res.status(404).json({ error: "Client introuvable." }); return; }

  if (await isPeriodLocked(body.clientId, new Date(body.date))) {
    res.status(409).json({ error: "La période comptable est clôturée. Modification impossible." });
    return;
  }

  const cat = PURCHASE_CATEGORIES[body.categoryKey];
  if (!cat) { res.status(400).json({ error: `Catégorie inconnue : "${body.categoryKey}".` }); return; }

  // Compute amounts — vatRate 0 or 18.
  const amountHt  = body.amountHt;
  const vatRate   = body.vatRate ?? 0;
  const vatAmount = Math.round(amountHt * (vatRate / 100));
  const amountTtc = amountHt + vatAmount;

  // Resolve payment side.
  let mmProvider: string | null = null;
  if (body.paymentMode === "mobile_money") {
    if (!body.mobileMoneyAccountId) {
      res.status(400).json({ error: "Le compte Mobile Money est requis pour ce mode de règlement." });
      return;
    }
    const mmAcct = await db.query.mobileMoneyAccountsTable.findFirst({
      where: and(
        eq(mobileMoneyAccountsTable.id, body.mobileMoneyAccountId),
        eq(mobileMoneyAccountsTable.clientId, body.clientId),
      ),
    });
    if (!mmAcct) { res.status(404).json({ error: "Compte Mobile Money introuvable." }); return; }
    mmProvider = mmAcct.provider;
  }

  const { account: creditAccount, label: creditLabel, journal } = getCreditAccount(body.paymentMode, mmProvider);

  try {
    const lines = computePurchaseJournalLines({
      amountHt,
      vatAmount,
      amountTtc,
      chargeAccount: cat.account,
      chargeName: cat.accountName,
      creditAccount,
      creditLabel,
    });

    // Post transaction + journal lines in a DB transaction.
    const [purchase] = await db.transaction(async (tx) => {
      const label = `Achat — ${body.supplierName} — ${cat.label}`;

      const [txRow] = await tx.insert(transactionsTable).values({
        firmId: req.user!.firmId,
        clientId: body.clientId,
        date: new Date(body.date),
        label,
        amount: amountTtc,
        type: "depense",
        category: body.categoryKey,
        paymentType: body.paymentMode === "credit" ? "credit" : "cash",
        paymentMethod: body.paymentMode === "bank" ? "virement" : body.paymentMode === "mobile_money" ? "mobile_money" : null,
        status: "a_valider",
        source: "purchase",
        supplierName: body.supplierName,
        invoiceNumber: body.invoiceRef ?? null,
        createdById: req.user!.id,
      }).returning();

      await tx.insert(journalLinesTable).values(
        lines.map((l) => ({ ...l, transactionId: txRow.id })),
      );

      const [p] = await tx.insert(purchasesTable).values({
        firmId: req.user!.firmId,
        clientId: body.clientId,
        date: new Date(body.date),
        supplierName: body.supplierName,
        supplierNcc: body.supplierNcc ?? null,
        invoiceRef: body.invoiceRef ?? null,
        categoryKey: body.categoryKey,
        chargeAccount: cat.account,
        chargeName: cat.accountName,
        amountHt,
        vatRate,
        vatAmount,
        amountTtc,
        paymentMode: body.paymentMode,
        mobileMoneyAccountId: body.mobileMoneyAccountId ?? null,
        notes: body.notes ?? null,
        status: body.paymentMode === "credit" ? "pending" : "settled",
        transactionId: txRow.id,
        settledAt: body.paymentMode === "credit" ? null : new Date(),
        createdById: req.user!.id,
      }).returning();

      return [p];
    });

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      action: AuditAction.CREATE,
      entityType: "purchase",
      entityId: String(purchase.id),
      details: `Dépense enregistrée : ${body.supplierName} — ${cat.label} — ${amountTtc} FCFA (${body.paymentMode})`,
    });

    const enriched = await enrichWithMmAccount([purchase]);
    res.status(201).json(serializePurchase(enriched[0]));
  } catch (err) {
    if (err instanceof AccountingEngineError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /purchases/:id
// ---------------------------------------------------------------------------
router.get("/purchases/:id", requirePermission("operations.view"), async (req, res) => {
  const { id } = GetPurchaseParams.parse(req.params);
  const row = await db.query.purchasesTable.findFirst({
    where: and(eq(purchasesTable.id, id), eq(purchasesTable.firmId, req.user!.firmId)),
  });
  if (!row) { res.status(404).json({ error: "Dépense introuvable." }); return; }

  if (isPortalRole(req.user!.role) && row.clientId !== req.user!.clientId) {
    res.status(403).json({ error: "Accès non autorisé." });
    return;
  }
  const enriched = await enrichWithMmAccount([row]);
  res.json(serializePurchase(enriched[0]));
});

// ---------------------------------------------------------------------------
// POST /purchases/:id/settle — settle a credit purchase
// ---------------------------------------------------------------------------
router.post("/purchases/:id/settle", requirePermission("operations.create"), async (req, res) => {
  const { id } = SettlePurchaseParams.parse(req.params);
  const body   = SettlePurchaseBody.parse(req.body);

  const purchase = await db.query.purchasesTable.findFirst({
    where: and(eq(purchasesTable.id, id), eq(purchasesTable.firmId, req.user!.firmId)),
  });
  if (!purchase) { res.status(404).json({ error: "Dépense introuvable." }); return; }

  if (isPortalRole(req.user!.role) && purchase.clientId !== req.user!.clientId) {
    res.status(403).json({ error: "Accès non autorisé." }); return;
  }
  if (purchase.paymentMode !== "credit") {
    res.status(400).json({ error: "Seules les dépenses à crédit peuvent être réglées ici." }); return;
  }
  if (purchase.status === "settled") {
    res.status(400).json({ error: "Cette dépense est déjà réglée." }); return;
  }
  if (await isPeriodLocked(purchase.clientId, purchase.date)) {
    res.status(409).json({ error: "La période comptable est clôturée. Modification impossible." }); return;
  }

  let mmProvider: string | null = null;
  if (body.paymentMode === "mobile_money") {
    if (!body.mobileMoneyAccountId) {
      res.status(400).json({ error: "Le compte Mobile Money est requis." }); return;
    }
    const mmAcct = await db.query.mobileMoneyAccountsTable.findFirst({
      where: and(
        eq(mobileMoneyAccountsTable.id, body.mobileMoneyAccountId),
        eq(mobileMoneyAccountsTable.clientId, purchase.clientId),
      ),
    });
    if (!mmAcct) { res.status(404).json({ error: "Compte Mobile Money introuvable." }); return; }
    mmProvider = mmAcct.provider;
  }

  const { account: creditAccount, label: creditLabel } = getCreditAccount(body.paymentMode, mmProvider);

  const settlementLines = computePurchaseSettlementLines({
    amountTtc: purchase.amountTtc,
    creditAccount,
    creditLabel,
  });

  const cat = PURCHASE_CATEGORIES[purchase.categoryKey];
  const now = new Date();

  const [updated, txRow] = await db.transaction(async (tx) => {
    const [settleTx] = await tx.insert(transactionsTable).values({
      firmId: req.user!.firmId,
      clientId: purchase.clientId,
      date: now,
      label: `Règlement — ${purchase.supplierName} — ${cat?.label ?? purchase.chargeName}`,
      amount: purchase.amountTtc,
      type: "depense",
      category: purchase.categoryKey,
      paymentType: "cash",
      paymentMethod: body.paymentMode === "bank" ? "virement" : "mobile_money",
      status: "a_valider",
      source: "purchase_settlement",
      supplierName: purchase.supplierName,
      createdById: req.user!.id,
    }).returning();

    await tx.insert(journalLinesTable).values(
      settlementLines.map((l) => ({ ...l, transactionId: settleTx.id })),
    );

    const [p] = await tx.update(purchasesTable)
      .set({ status: "settled", settlementTransactionId: settleTx.id, settledAt: now })
      .where(eq(purchasesTable.id, purchase.id))
      .returning();

    return [p, settleTx];
  });

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    action: AuditAction.UPDATE,
    entityType: "purchase",
    entityId: String(purchase.id),
    details: `Règlement dépense à crédit : ${purchase.supplierName} — ${purchase.amountTtc} FCFA via ${body.paymentMode}`,
  });

  const enriched = await enrichWithMmAccount([updated]);
  res.json({
    purchase: serializePurchase(enriched[0]),
    transaction: { id: txRow.id, label: txRow.label, amount: txRow.amount, journalLines: settlementLines },
  });
});

export default router;
