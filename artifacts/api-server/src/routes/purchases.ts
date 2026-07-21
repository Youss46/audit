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
  GetPurchaseReceiptParams,
  UploadPurchaseReceiptParams,
  UploadPurchaseReceiptBody,
  ValidatePurchaseParams,
  ValidatePurchaseBody,
} from "@workspace/api-zod";

// Module Dépenses & Achats — structured purchase recording for all PME
// clients. Handles three payment modes:
//   - "credit"       → Cr 4011 Fournisseurs     (HA journal, pending until settled)
//   - "bank"         → Cr 5211 Banques           (BQ journal, settled immediately)
//   - "mobile_money" → Cr 552xxx                 (BQ journal, settled immediately)
//
// Workflow status (reviewStatus):
//   brouillon   → PME saved as draft, not yet submitted for review
//   en_attente  → submitted, cabinet accountant must validate
//   valide      → cabinet validated + optionally corrected the charge account
//
// AIB (Acompte sur Impôts et Bénéfices, Côte d'Ivoire):
//   Immediate payments: Cr 447200 AIB + Cr treasury (net)
//   Credit purchases:   AIB deducted at settlement time

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EnrichedPurchase = PurchaseRow & {
  mobileMoneyProvider?: string | null;
  mobileMoneyAccountNumber?: string | null;
  clientName?: string | null;
};

function serializePurchase(p: EnrichedPurchase) {
  const cat = PURCHASE_CATEGORIES[p.categoryKey];
  return {
    id: p.id,
    clientId: p.clientId,
    clientName: p.clientName ?? null,
    date: p.date,
    supplierName: p.supplierName,
    supplierNcc: p.supplierNcc ?? null,
    invoiceRef: p.invoiceRef ?? null,
    categoryKey: p.categoryKey,
    chargeAccount: p.correctedChargeAccount ?? p.chargeAccount,
    chargeName: p.correctedChargeName ?? p.chargeName,
    categoryLabel: cat?.label ?? p.chargeName,
    amountHt: p.amountHt,
    vatRate: p.vatRate,
    vatAmount: p.vatAmount,
    aibRate: p.aibRate,
    aibAmount: p.aibAmount,
    amountTtc: p.amountTtc,
    paymentMode: p.paymentMode,
    mobileMoneyAccountId: p.mobileMoneyAccountId ?? null,
    mobileMoneyProvider: p.mobileMoneyProvider ?? null,
    mobileMoneyAccountNumber: p.mobileMoneyAccountNumber ?? null,
    notes: p.notes ?? null,
    status: p.status,
    reviewStatus: p.reviewStatus,
    isLettre: p.isLettre,
    hasReceipt: !!p.receiptFileData,
    receiptFileName: p.receiptFileName ?? null,
    receiptMimeType: p.receiptMimeType ?? null,
    validatedById: p.validatedById ?? null,
    validatedAt: p.validatedAt ?? null,
    correctedChargeAccount: p.correctedChargeAccount ?? null,
    correctedChargeName: p.correctedChargeName ?? null,
    transactionId: p.transactionId ?? null,
    settlementTransactionId: p.settlementTransactionId ?? null,
    settledAt: p.settledAt ?? null,
    createdAt: p.createdAt,
  };
}

async function enrichRows(rows: PurchaseRow[]): Promise<EnrichedPurchase[]> {
  // Mobile money provider labels
  const mmIds = [...new Set(rows.map((r) => r.mobileMoneyAccountId).filter(Boolean))] as number[];
  const mmMap = new Map<number, { provider: string; accountNumber: string }>();
  if (mmIds.length) {
    const accounts = await db.query.mobileMoneyAccountsTable.findMany({
      where: (t, { inArray }) => inArray(t.id, mmIds),
      columns: { id: true, provider: true, accountNumber: true },
    });
    for (const a of accounts) mmMap.set(a.id, a);
  }

  // Client names (needed for cabinet-side review)
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const clientMap = new Map<number, string>();
  if (clientIds.length) {
    const clients = await db.query.clientsTable.findMany({
      where: (t, { inArray }) => inArray(t.id, clientIds),
      columns: { id: true, name: true },
    });
    for (const c of clients) clientMap.set(c.id, c.name);
  }

  return rows.map((r) => ({
    ...r,
    mobileMoneyProvider: r.mobileMoneyAccountId ? (mmMap.get(r.mobileMoneyAccountId)?.provider ?? null) : null,
    mobileMoneyAccountNumber: r.mobileMoneyAccountId ? (mmMap.get(r.mobileMoneyAccountId)?.accountNumber ?? null) : null,
    clientName: clientMap.get(r.clientId) ?? null,
  }));
}

function getCreditAccount(
  paymentMode: "credit" | "bank" | "mobile_money",
  mmProvider?: string | null,
): { account: string; label: string; journal: "HA" | "BQ" } {
  if (paymentMode === "credit") return { account: "401100", label: "Fournisseurs d'exploitation", journal: "HA" };
  if (paymentMode === "bank")   return { account: "521100", label: "Banques locales",              journal: "BQ" };
  const acct  = mmProvider ? (MOBILE_MONEY_PROVIDER_ACCOUNTS[mmProvider] ?? "552100") : "552100";
  const label = mmProvider ? (MOBILE_MONEY_PROVIDER_LABELS[mmProvider]   ?? "Monnaie Électronique") : "Monnaie Électronique";
  return { account: acct, label, journal: "BQ" };
}

// ---------------------------------------------------------------------------
// GET /purchases/categories  — must be before /:id
// Lit depuis transaction_categories (DB) en priorité ; repli statique si vide.
// ---------------------------------------------------------------------------
router.get("/purchases/categories", async (_req, res) => {
  // Tente de lire depuis le référentiel DB (transaction_categories).
  try {
    const { transactionCategoriesTable } = await import("@workspace/db");
    const { asc, eq } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(transactionCategoriesTable)
      .where(eq(transactionCategoriesTable.isHidden, false))
      .orderBy(asc(transactionCategoriesTable.key));

    if (rows.length > 0) {
      return res.json(
        rows.map((r) => ({
          key:         r.key,
          label:       r.displayName,
          account:     r.defaultAccountNumber,
          accountName: r.displayName,
          vatEligible: r.vatEligible,
        })),
      );
    }
  } catch {
    // Table pas encore migrée — repli sur les constantes statiques ci-dessous.
  }

  // Repli statique : PURCHASE_CATEGORIES (toujours cohérent avec le moteur).
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

  const effectiveClientId = isPortalRole(req.user!.role)
    ? req.user!.clientId!
    : (query.clientId ?? null);

  const rows = await db.query.purchasesTable.findMany({
    where: and(
      effectiveClientId ? eq(purchasesTable.clientId, effectiveClientId) : undefined,
      eq(purchasesTable.firmId, req.user!.firmId),
      query.status       ? eq(purchasesTable.status,       query.status)       : undefined,
      query.reviewStatus ? eq(purchasesTable.reviewStatus, query.reviewStatus) : undefined,
    ),
    orderBy: [desc(purchasesTable.date)],
  });

  const enriched = await enrichRows(rows);
  res.json(enriched.map(serializePurchase));
});

// ---------------------------------------------------------------------------
// POST /purchases
// ---------------------------------------------------------------------------
router.post("/purchases", requirePermission("operations.create"), async (req, res) => {
  const body = CreatePurchaseBody.parse(req.body);

  if (isPortalRole(req.user!.role) && body.clientId !== req.user!.clientId) {
    res.status(403).json({ error: "Accès non autorisé à ce dossier client." });
    return;
  }

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) { res.status(404).json({ error: "Client introuvable." }); return; }

  if (await isPeriodLocked(req.user!.firmId, body.clientId, new Date(body.date).getFullYear())) {
    res.status(409).json({ error: "La période comptable est clôturée. Modification impossible." });
    return;
  }

  const cat = PURCHASE_CATEGORIES[body.categoryKey];
  if (!cat) { res.status(400).json({ error: `Catégorie inconnue : "${body.categoryKey}".` }); return; }

  // Amounts
  const amountHt  = body.amountHt;
  const vatRate   = body.vatRate ?? 0;
  const vatAmount = Math.round(amountHt * (vatRate / 100));
  const amountTtc = amountHt + vatAmount;
  const aibRate   = body.aibRate ?? 0;
  const aibAmount = Math.round(amountTtc * (aibRate / 100));

  // Review workflow status
  const reviewStatus = body.reviewStatus ?? "en_attente";

  // Resolve mobile money provider
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

  const { account: creditAccount, label: creditLabel } = getCreditAccount(body.paymentMode, mmProvider);

  try {
    const lines = computePurchaseJournalLines({
      amountHt,
      vatAmount,
      amountTtc,
      aibAmount,
      chargeAccount: cat.account,
      chargeName: cat.accountName,
      creditAccount,
      creditLabel,
      paymentMode: body.paymentMode,
    });

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
        aibRate,
        aibAmount,
        amountTtc,
        paymentMode: body.paymentMode,
        mobileMoneyAccountId: body.mobileMoneyAccountId ?? null,
        notes: body.notes ?? null,
        status: body.paymentMode === "credit" ? "pending" : "settled",
        reviewStatus,
        // Receipt attachment (optional, stored inline as base64)
        receiptFileName: body.receipt?.fileName ?? null,
        receiptMimeType: body.receipt?.mimeType ?? null,
        receiptFileData: body.receipt?.fileData ?? null,
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
      details: `Dépense enregistrée : ${body.supplierName} — ${cat.label} — ${amountTtc} FCFA (${body.paymentMode})${aibAmount > 0 ? ` — AIB ${aibRate}% retenu : ${aibAmount} FCFA` : ""}`,
    });

    const enriched = await enrichRows([purchase]);
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
  const enriched = await enrichRows([row]);
  res.json(serializePurchase(enriched[0]));
});

// ---------------------------------------------------------------------------
// GET /purchases/:id/receipt — download attached justificatif
// ---------------------------------------------------------------------------
router.get("/purchases/:id/receipt", requirePermission("operations.view"), async (req, res) => {
  const { id } = GetPurchaseReceiptParams.parse(req.params);
  const row = await db.query.purchasesTable.findFirst({
    where: and(eq(purchasesTable.id, id), eq(purchasesTable.firmId, req.user!.firmId)),
    columns: { id: true, clientId: true, receiptFileData: true, receiptFileName: true, receiptMimeType: true },
  });
  if (!row) { res.status(404).json({ error: "Dépense introuvable." }); return; }
  if (isPortalRole(req.user!.role) && row.clientId !== req.user!.clientId) {
    res.status(403).json({ error: "Accès non autorisé." }); return;
  }
  if (!row.receiptFileData) {
    res.status(404).json({ error: "Aucune pièce jointe sur cette dépense." }); return;
  }
  res.json({
    fileData: row.receiptFileData,
    fileName: row.receiptFileName,
    mimeType: row.receiptMimeType,
  });
});

// ---------------------------------------------------------------------------
// POST /purchases/:id/receipt — attach or replace receipt
// ---------------------------------------------------------------------------
router.post("/purchases/:id/receipt", requirePermission("operations.create"), async (req, res) => {
  const { id } = UploadPurchaseReceiptParams.parse(req.params);
  const body   = UploadPurchaseReceiptBody.parse(req.body);

  const purchase = await db.query.purchasesTable.findFirst({
    where: and(eq(purchasesTable.id, id), eq(purchasesTable.firmId, req.user!.firmId)),
  });
  if (!purchase) { res.status(404).json({ error: "Dépense introuvable." }); return; }
  if (isPortalRole(req.user!.role) && purchase.clientId !== req.user!.clientId) {
    res.status(403).json({ error: "Accès non autorisé." }); return;
  }
  if (purchase.reviewStatus === "valide") {
    res.status(409).json({ error: "Cette dépense est validée. Pièce jointe non modifiable." }); return;
  }

  const [updated] = await db.update(purchasesTable)
    .set({ receiptFileName: body.fileName, receiptMimeType: body.mimeType, receiptFileData: body.fileData })
    .where(eq(purchasesTable.id, id))
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    action: AuditAction.UPDATE,
    entityType: "purchase",
    entityId: String(id),
    details: `Pièce justificative jointe : ${body.fileName}`,
  });

  const enriched = await enrichRows([updated]);
  res.json(serializePurchase(enriched[0]));
});

// ---------------------------------------------------------------------------
// POST /purchases/:id/validate — cabinet validates + optionally corrects account
// ---------------------------------------------------------------------------
router.post("/purchases/:id/validate", requirePermission("operations.create"), async (req, res) => {
  const { id } = ValidatePurchaseParams.parse(req.params);
  const body   = ValidatePurchaseBody.parse(req.body);

  // Cabinet-only: portal roles cannot validate
  if (isPortalRole(req.user!.role)) {
    res.status(403).json({ error: "Seul le cabinet peut valider une dépense." }); return;
  }

  const purchase = await db.query.purchasesTable.findFirst({
    where: and(eq(purchasesTable.id, id), eq(purchasesTable.firmId, req.user!.firmId)),
  });
  if (!purchase) { res.status(404).json({ error: "Dépense introuvable." }); return; }
  if (purchase.reviewStatus === "valide") {
    res.status(400).json({ error: "Cette dépense est déjà validée." }); return;
  }
  if (await isPeriodLocked(req.user!.firmId, purchase.clientId, new Date(purchase.date).getFullYear())) {
    res.status(409).json({ error: "La période comptable est clôturée. Modification impossible." }); return;
  }

  const correctedAccount = body.correctedChargeAccount?.trim() || null;
  const correctedName    = body.correctedChargeName?.trim()    || null;
  const now = new Date();

  const [updated] = await db.transaction(async (tx) => {
    // If cabinet corrected the charge account, update the journal line in-place.
    if (correctedAccount && correctedAccount !== purchase.chargeAccount && purchase.transactionId) {
      await tx.update(journalLinesTable)
        .set({
          accountNumber: correctedAccount,
          label: correctedName ?? purchase.chargeName,
        })
        .where(
          and(
            eq(journalLinesTable.transactionId, purchase.transactionId),
            eq(journalLinesTable.accountNumber, purchase.chargeAccount),
          ),
        );
    }

    const [p] = await tx.update(purchasesTable)
      .set({
        reviewStatus: "valide",
        validatedById: req.user!.id,
        validatedAt: now,
        ...(correctedAccount ? { correctedChargeAccount: correctedAccount, correctedChargeName: correctedName } : {}),
      })
      .where(eq(purchasesTable.id, id))
      .returning();
    return [p];
  });

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    action: AuditAction.UPDATE,
    entityType: "purchase",
    entityId: String(id),
    details: `Dépense validée${correctedAccount ? ` — compte corrigé : ${purchase.chargeAccount} → ${correctedAccount}` : ""}`,
  });

  const enriched = await enrichRows([updated]);
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
  if (await isPeriodLocked(req.user!.firmId, purchase.clientId, new Date(purchase.date).getFullYear())) {
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
    aibAmount: purchase.aibAmount,
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
    details: `Règlement dépense à crédit : ${purchase.supplierName} — ${purchase.amountTtc} FCFA via ${body.paymentMode}${purchase.aibAmount > 0 ? ` — AIB retenu : ${purchase.aibAmount} FCFA` : ""}`,
  });

  const enriched = await enrichRows([updated]);
  res.json({
    purchase: serializePurchase(enriched[0]),
    transaction: { id: txRow.id, label: txRow.label, amount: txRow.amount, journalLines: settlementLines },
  });
});

export default router;
