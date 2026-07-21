import { Router, type IRouter } from "express";
import { and, asc, desc, eq, like, max } from "drizzle-orm";
import {
  db,
  clientsTable,
  firmsTable,
  documentsTable,
  transactionsTable,
  journalLinesTable,
  invoicesTable,
  invoiceItemsTable,
  invoiceProductsTable,
  vatSettingsTable,
  mobileMoneyAccountsTable,
  mobileMoneyTransactionsTable,
  isPortalRole,
} from "@workspace/db";
import {
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  GetInvoiceParams,
  UpdateInvoiceParams,
  UpdateInvoiceBody,
  ValidateInvoiceParams,
  MarkInvoicePaidParams,
  MarkInvoicePaidBody as _MarkInvoicePaidBodyBase,
  CancelInvoiceParams,
  DownloadInvoicePdfParams,
  CreateCreditNoteParams,
  CreateCreditNoteBody,
} from "@workspace/api-zod";
import { z } from "zod";

// Local schemas for endpoints not yet reflected in the OpenAPI spec.
const MarkInvoicePaidBody = _MarkInvoicePaidBodyBase.extend({
  amount: z.number().positive().optional(), // partial payment amount (defaults to full remaining balance)
});
const CreateInvoiceProductBody = z.object({
  designation: z.string().min(1),
  defaultUnitPrice: z.number().nonnegative(),
  vatRate: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
});
const DeleteInvoiceProductParams = z.object({ id: z.coerce.number() });
const RemindInvoiceParams = z.object({ id: z.coerce.number() });
import { requireAuth, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { generateInvoicePdf } from "../lib/export-engine";
import { sendMail } from "../lib/mailer";
import { ACCOUNT_TVA_COLLECTEE_18 } from "../lib/vat-engine";
import {
  computeMobileMoneyInflowJournalLines,
  MOBILE_MONEY_PROVIDER_LABELS,
  AccountingEngineError,
} from "../lib/accounting-engine";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type InvoiceRow = Awaited<ReturnType<typeof fetchFullInvoice>>;

async function fetchFullInvoice(id: number) {
  const inv = await db.query.invoicesTable.findFirst({
    where: eq(invoicesTable.id, id),
    with: {
      client: { columns: { id: true, name: true, address: true, rccm: true } },
      createdBy: { columns: { fullName: true } },
      items: { orderBy: (t, { asc }) => [asc(t.id)] },
    },
  });
  return inv ?? null;
}

function serializeInvoice(inv: NonNullable<InvoiceRow>) {
  return {
    id: inv.id,
    firmId: inv.firmId,
    clientId: inv.clientId,
    clientName: inv.client?.name ?? null,
    invoiceNumber: inv.invoiceNumber ?? null,
    customerName: inv.customerName,
    customerEmail: inv.customerEmail ?? null,
    customerAddress: inv.customerAddress ?? null,
    subtotalHt: inv.subtotalHt,
    vatRate: inv.vatRate,
    vatAmount: inv.vatAmount,
    totalTtc: inv.totalTtc,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate ?? null,
    status: inv.status,
    notes: inv.notes ?? null,
    pdfDocumentId: inv.pdfDocumentId ?? null,
    postedTransactionId: inv.postedTransactionId ?? null,
    createdByName: inv.createdBy
      ? inv.createdBy.fullName
      : null,
    amountPaid: inv.amountPaid,
    balanceDue: inv.totalTtc - inv.amountPaid,
    lastRemindedAt: inv.lastRemindedAt ?? null,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    items: inv.items.map((item) => ({
      id: item.id,
      invoiceId: item.invoiceId,
      designation: item.designation,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      totalItemHt: item.totalItemHt,
    })),
  };
}

/** Compute invoice totals from item rows. */
function computeTotals(
  items: Array<{ quantity: number; unitPrice: number; vatRate?: number | null }>,
  defaultVatRate: number,
) {
  const subtotalHt = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const vatAmount = Math.round(subtotalHt * defaultVatRate / 100);
  return { subtotalHt, vatAmount, totalTtc: subtotalHt + vatAmount };
}

/**
 * Derive the next sequential invoice number for a firm/client/year.
 * Format: FAC-YYYY-XXXX (zero-padded 4 digits, sequential, no gaps once issued).
 */
async function getNextInvoiceNumber(
  firmId: number,
  clientId: number,
  year: number,
  prefix = "FAC",
): Promise<string> {
  const yearStr = String(year);
  const pattern = `${prefix}-${yearStr}-%`;

  // Pull only the invoiceNumber column to minimise data transfer.
  const rows = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.firmId, firmId),
        eq(invoicesTable.clientId, clientId),
        like(invoicesTable.invoiceNumber, pattern),
      ),
    );

  let maxSeq = 0;
  for (const row of rows) {
    if (!row.invoiceNumber) continue;
    const parts = row.invoiceNumber.split("-");
    const seq = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}-${yearStr}-${String(maxSeq + 1).padStart(4, "0")}`;
}

/** Guard: ensure the requesting user can access the given invoice. */
function assertOwnership(
  inv: NonNullable<InvoiceRow>,
  req: Parameters<typeof requireAuth>[0],
) {
  if (inv.firmId !== req.user!.firmId) throw new HttpError(404, "Facture introuvable.");
  if (isPortalRole(req.user!.role) && inv.clientId !== req.user!.clientId) {
    throw new HttpError(403, "Accès non autorisé à cette facture.");
  }
}

// ---------------------------------------------------------------------------
// GET /invoices  — list
// ---------------------------------------------------------------------------
router.get("/invoices", requirePermission("facturation.view"), async (req, res) => {
  const query = ListInvoicesQueryParams.parse(req.query);
  const isClientPme = isPortalRole(req.user!.role);
  const effectiveClientId = isClientPme ? req.user!.clientId! : query.clientId;

  const conditions = [eq(invoicesTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(invoicesTable.clientId, effectiveClientId));
  if (query.status)      conditions.push(eq(invoicesTable.status, query.status));

  const rows = await db.query.invoicesTable.findMany({
    where: and(...conditions),
    with: {
      client:    { columns: { id: true, name: true, address: true, rccm: true } },
      createdBy: { columns: { fullName: true } },
      items:     { orderBy: (t, { asc }) => [asc(t.id)] },
    },
    orderBy: [desc(invoicesTable.createdAt)],
  });

  res.json(rows.map(serializeInvoice));
});

// ---------------------------------------------------------------------------
// POST /invoices  — create draft
// ---------------------------------------------------------------------------
router.post("/invoices", requirePermission("facturation.create"), async (req, res) => {
  const body = CreateInvoiceBody.parse(req.body);
  const isClientPme = isPortalRole(req.user!.role);
  const clientId = isClientPme ? req.user!.clientId! : body.clientId;

  // Verify client belongs to this firm.
  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) throw new HttpError(404, "Client introuvable.");

  const vatRate = body.vatRate ?? 18;
  const { subtotalHt, vatAmount, totalTtc } = computeTotals(body.items, vatRate);

  const [inv] = await db
    .insert(invoicesTable)
    .values({
      firmId:          req.user!.firmId,
      clientId,
      customerName:    body.customerName,
      customerEmail:   body.customerEmail ?? null,
      customerAddress: body.customerAddress ?? null,
      subtotalHt,
      vatRate,
      vatAmount,
      totalTtc,
      invoiceDate:     new Date(body.invoiceDate),
      dueDate:         body.dueDate ? new Date(body.dueDate) : null,
      notes:           body.notes ?? null,
      status:          "BROUILLON",
      createdById:     req.user!.id,
    })
    .returning();

  await db.insert(invoiceItemsTable).values(
    body.items.map((it) => ({
      invoiceId:    inv.id,
      designation:  it.designation,
      quantity:     it.quantity,
      unitPrice:    it.unitPrice,
      vatRate:      it.vatRate ?? vatRate,
      totalItemHt:  it.quantity * it.unitPrice,
    })),
  );

  await logAudit({
    firmId:     req.user!.firmId,
    userId:     req.user!.id,
    userName:   req.user!.fullName,
    userRole:   req.user!.role,
    action:     AuditAction.INVOICE_CREATE,
    entityType: "invoice",
    entityId:   inv.id,
    details:    `Nouvelle facture brouillon — client: ${client.name}, montant TTC: ${totalTtc} FCFA`,
  });

  const full = await fetchFullInvoice(inv.id);
  res.status(201).json(serializeInvoice(full!));
});

// ---------------------------------------------------------------------------
// GET /invoices/:id  — detail
// ---------------------------------------------------------------------------
router.get("/invoices/:id", requirePermission("facturation.view"), async (req, res) => {
  const { id } = GetInvoiceParams.parse(req.params);
  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);
  res.json(serializeInvoice(inv));
});

// ---------------------------------------------------------------------------
// PUT /invoices/:id  — update (BROUILLON only)
// ---------------------------------------------------------------------------
router.put("/invoices/:id", requirePermission("facturation.create"), async (req, res) => {
  const { id } = UpdateInvoiceParams.parse(req.params);
  const body  = UpdateInvoiceBody.parse(req.body);

  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);
  if (inv.status !== "BROUILLON") {
    throw new HttpError(
      400,
      "Seules les factures en BROUILLON peuvent être modifiées. Pour corriger une facture validée, émettez un avoir (note de crédit).",
    );
  }

  const vatRate = body.vatRate ?? inv.vatRate;
  const { subtotalHt, vatAmount, totalTtc } = computeTotals(body.items, vatRate);

  await db
    .update(invoicesTable)
    .set({
      customerName:    body.customerName,
      customerEmail:   body.customerEmail ?? null,
      customerAddress: body.customerAddress ?? null,
      vatRate,
      subtotalHt,
      vatAmount,
      totalTtc,
      invoiceDate: new Date(body.invoiceDate),
      dueDate:     body.dueDate ? new Date(body.dueDate) : null,
      notes:       body.notes ?? null,
    })
    .where(eq(invoicesTable.id, id));

  // Replace all items.
  await db.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
  if (body.items.length > 0) {
    await db.insert(invoiceItemsTable).values(
      body.items.map((it) => ({
        invoiceId:   id,
        designation: it.designation,
        quantity:    it.quantity,
        unitPrice:   it.unitPrice,
        vatRate:     it.vatRate ?? vatRate,
        totalItemHt: it.quantity * it.unitPrice,
      })),
    );
  }

  const updated = await fetchFullInvoice(id);
  res.json(serializeInvoice(updated!));
});

// ---------------------------------------------------------------------------
// POST /invoices/:id/validate  — validate + PDF + accounting
// ---------------------------------------------------------------------------
router.post("/invoices/:id/validate", requirePermission("facturation.create"), async (req, res) => {
  const { id } = ValidateInvoiceParams.parse(req.params);

  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);
  if (inv.status !== "BROUILLON") {
    throw new HttpError(400, "Seule une facture en BROUILLON peut être validée.");
  }
  if (!inv.items.length) {
    throw new HttpError(400, "La facture doit contenir au moins une ligne.");
  }

  // 1. Assign chronological invoice number for this firm/client/year.
  const year = inv.invoiceDate.getFullYear();
  const invoiceNumber = await getNextInvoiceNumber(inv.firmId, inv.clientId, year, "FAC");

  // 2. Fetch firm for footer attribution.
  const firm = await db.query.firmsTable.findFirst({
    where: eq(firmsTable.id, inv.firmId),
    columns: { name: true },
  });

  // 3. Generate PDF receipt.
  const pdfBuffer = await generateInvoicePdf({
    invoiceNumber,
    invoiceDate:    inv.invoiceDate,
    dueDate:        inv.dueDate,
    sellerName:     inv.client?.name ?? "—",
    sellerAddress:  inv.client?.address ?? null,
    sellerRccm:     inv.client?.rccm ?? null,
    customerName:   inv.customerName,
    customerEmail:  inv.customerEmail,
    customerAddress: inv.customerAddress,
    subtotalHt:     inv.subtotalHt,
    vatRate:        inv.vatRate,
    vatAmount:      inv.vatAmount,
    totalTtc:       inv.totalTtc,
    notes:          inv.notes,
    items:          inv.items.map((it) => ({
      designation: it.designation,
      quantity:    it.quantity,
      unitPrice:   it.unitPrice,
      vatRate:     it.vatRate,
      totalItemHt: it.totalItemHt,
    })),
    footerFirmName: `M15-AUDIT — ${firm?.name ?? "Cabinet comptable"}`,
  });

  // 4. Persist PDF in the documents table.
  const pdfBase64 = pdfBuffer.toString("base64");
  const fileName  = `${invoiceNumber}.pdf`;
  const [pdfDoc] = await db
    .insert(documentsTable)
    .values({
      firmId:       inv.firmId,
      clientId:     inv.clientId,
      category:     "Factures",
      fileName,
      mimeType:     "application/pdf",
      fileSize:     pdfBuffer.length,
      fileData:     pdfBase64,
      uploadedById: req.user!.id,
    })
    .returning();

  // 5. Post SYSCOHADA accounting entry: 411 / 706 / 443xxx.
  //    The TVA collectée account (443100 by default) is resolved from the
  //    firm's vat_settings table so cabinet accountants can configure
  //    non-standard accounts without touching code.
  const vatSettingForRate = inv.vatAmount > 0
    ? await db.query.vatSettingsTable.findFirst({
        where: and(
          eq(vatSettingsTable.firmId, inv.firmId),
          eq(vatSettingsTable.ratePercentage, inv.vatRate),
          eq(vatSettingsTable.isActive, true),
        ),
      })
    : null;
  const tvaCollecteeAccount =
    vatSettingForRate?.salesAccount ?? ACCOUNT_TVA_COLLECTEE_18;

  const txLabel = `Facture ${invoiceNumber} — ${inv.customerName}`;
  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId:      inv.firmId,
      clientId:    inv.clientId,
      date:        inv.invoiceDate,
      label:       txLabel,
      amount:      inv.totalTtc,
      type:        "recette",
      category:    "Ventes / Prestations de services",
      paymentType: "credit",
      paymentMethod: null,
      dueDate:     inv.dueDate ?? null,
      status:      "valide",
      source:      "manual_cabinet",
      documentId:  pdfDoc.id,
      createdById: req.user!.id,
      validatedById: req.user!.id,
      validatedAt:   new Date(),
      anomalies:   [],
    })
    .returning();

  const journalLines = [
    // Débit 411100 — Clients (montant TTC)
    {
      transactionId: tx.id,
      accountNumber: "411100",
      debitAmount:   inv.totalTtc,
      creditAmount:  0,
      label:         txLabel,
    },
    // Crédit 706100 — Prestations de services (montant HT)
    {
      transactionId: tx.id,
      accountNumber: "706100",
      debitAmount:   0,
      creditAmount:  inv.subtotalHt,
      label:         txLabel,
    },
  ];

  // Only add the TVA line when there is actual VAT (exempt invoices have vatAmount = 0)
  if (inv.vatAmount > 0) {
    journalLines.push({
      transactionId: tx.id,
      accountNumber: tvaCollecteeAccount,
      debitAmount:   0,
      creditAmount:  inv.vatAmount,
      label:         `TVA ${inv.vatRate}% — ${invoiceNumber}`,
    });
  }

  await db.insert(journalLinesTable).values(journalLines);

  // 6. Mark invoice as VALIDE.
  await db
    .update(invoicesTable)
    .set({
      status:              "VALIDE",
      invoiceNumber,
      pdfDocumentId:       pdfDoc.id,
      postedTransactionId: tx.id,
    })
    .where(eq(invoicesTable.id, id));

  await logAudit({
    firmId:     req.user!.firmId,
    userId:     req.user!.id,
    userName:   req.user!.fullName,
    userRole:   req.user!.role,
    action:     AuditAction.INVOICE_VALIDATE,
    entityType: "invoice",
    entityId:   id,
    details:    `Facture validée : ${invoiceNumber} — TTC ${inv.totalTtc} FCFA`,
  });

  const updated = await fetchFullInvoice(id);
  res.json(serializeInvoice(updated!));
});

// ---------------------------------------------------------------------------
// POST /invoices/:id/mark-paid  — mark as PAYE
// ---------------------------------------------------------------------------
router.post("/invoices/:id/mark-paid", requirePermission("facturation.create"), async (req, res) => {
  const { id } = MarkInvoicePaidParams.parse(req.params);
  const body = MarkInvoicePaidBody.parse(req.body ?? {});

  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);
  if (inv.status !== "VALIDE" && inv.status !== "PARTIELLEMENT_PAYE") {
    throw new HttpError(400, "Seule une facture VALIDÉE ou PARTIELLEMENT PAYÉE peut être soldée.");
  }

  // Determine payment amount: default = full remaining balance.
  const remainingBalance = inv.totalTtc - inv.amountPaid;
  const paymentAmount = body.amount != null ? body.amount : remainingBalance;

  if (paymentAmount <= 0 || paymentAmount > remainingBalance) {
    throw new HttpError(
      400,
      `Montant invalide. Solde restant : ${remainingBalance.toLocaleString("fr-FR")} FCFA.`,
    );
  }

  // Mobile Money must always settle the full remaining balance.
  if (body.paymentMethod === "mobile_money" && paymentAmount < remainingBalance) {
    throw new HttpError(
      400,
      "Les paiements Mobile Money doivent couvrir la totalité du solde restant.",
    );
  }

  const newAmountPaid = inv.amountPaid + paymentAmount;
  const newStatus: "PAYE" | "PARTIELLEMENT_PAYE" =
    newAmountPaid >= inv.totalTtc ? "PAYE" : "PARTIELLEMENT_PAYE";

  // Module Trésorerie Mobile Money: when settled via Mobile Money, also post
  // the settlement leg (débit 552xxx net + débit 631700 frais / crédit 411)
  // and record a traceable Mobile Money movement linked to this invoice --
  // this never edits the original 411/706/443 entry posted at validation.
  if (body.paymentMethod === "mobile_money") {
    if (!body.mobileMoneyAccountId) {
      throw new HttpError(400, "Le compte Mobile Money est requis pour un règlement Mobile Money.");
    }
    const feeAmount = body.feeAmount ?? 0;

    const account = await db.query.mobileMoneyAccountsTable.findFirst({
      where: and(
        eq(mobileMoneyAccountsTable.id, body.mobileMoneyAccountId),
        eq(mobileMoneyAccountsTable.clientId, inv.clientId),
        eq(mobileMoneyAccountsTable.firmId, req.user!.firmId),
      ),
    });
    if (!account) throw new HttpError(404, "Compte Mobile Money introuvable pour ce client.");

    let journalLines;
    try {
      journalLines = computeMobileMoneyInflowJournalLines({
        provider: account.provider,
        totalAmount: paymentAmount,
        feeAmount,
        creditAccount: "411100",
        creditLabel: "Clients",
      });
    } catch (err) {
      if (err instanceof AccountingEngineError) throw new HttpError(400, err.message);
      throw err;
    }

    const providerLabel = MOBILE_MONEY_PROVIDER_LABELS[account.provider] ?? account.provider;
    const label = `Règlement Mobile Money (${providerLabel}) — Facture ${inv.invoiceNumber}`;

    const [settlement] = await db
      .insert(transactionsTable)
      .values({
        firmId: req.user!.firmId,
        clientId: inv.clientId,
        date: new Date(),
        label,
        amount: paymentAmount,
        type: "recette",
        category: "Ventes / Prestations de services",
        paymentType: "cash",
        paymentMethod: "mobile_money",
        status: "a_valider",
        source: "settlement",
        parentTransactionId: inv.postedTransactionId,
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

    const netAmount = paymentAmount - feeAmount;
    await db
      .update(mobileMoneyAccountsTable)
      .set({ balance: account.balance + netAmount })
      .where(eq(mobileMoneyAccountsTable.id, account.id));

    await db.insert(mobileMoneyTransactionsTable).values({
      firmId: req.user!.firmId,
      clientId: inv.clientId,
      mobileMoneyAccountId: account.id,
      invoiceId: inv.id,
      transactionId: settlement.id,
      type: "inflow",
      status: "completed",
      amount: paymentAmount,
      feeAmount,
      referenceCode: body.referenceCode ?? null,
      label,
      date: new Date(),
      createdById: req.user!.id,
    });
  }

  await db
    .update(invoicesTable)
    .set({ status: newStatus, amountPaid: newAmountPaid })
    .where(eq(invoicesTable.id, id));

  const isPartial = newStatus === "PARTIELLEMENT_PAYE";
  await logAudit({
    firmId:     req.user!.firmId,
    userId:     req.user!.id,
    userName:   req.user!.fullName,
    userRole:   req.user!.role,
    action:     AuditAction.INVOICE_MARK_PAID,
    entityType: "invoice",
    entityId:   id,
    details:    body.paymentMethod === "mobile_money"
      ? `Règlement Mobile Money — Facture ${inv.invoiceNumber} — ${paymentAmount.toLocaleString("fr-FR")} FCFA`
      : isPartial
        ? `Acompte enregistré — Facture ${inv.invoiceNumber} — ${paymentAmount.toLocaleString("fr-FR")} / ${inv.totalTtc.toLocaleString("fr-FR")} FCFA`
        : `Facture soldée — ${inv.invoiceNumber}`,
  });

  const updated = await fetchFullInvoice(id);
  res.json(serializeInvoice(updated!));
});

// ---------------------------------------------------------------------------
// POST /invoices/:id/cancel  — cancel (BROUILLON only)
// ---------------------------------------------------------------------------
router.post("/invoices/:id/cancel", requirePermission("facturation.create"), async (req, res) => {
  const { id } = CancelInvoiceParams.parse(req.params);

  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);
  if (inv.status !== "BROUILLON") {
    throw new HttpError(
      400,
      "Seule une facture en BROUILLON peut être annulée directement. Pour annuler une facture validée, émettez un avoir.",
    );
  }

  await db
    .update(invoicesTable)
    .set({ status: "ANNULE" })
    .where(eq(invoicesTable.id, id));

  await logAudit({
    firmId:     req.user!.firmId,
    userId:     req.user!.id,
    userName:   req.user!.fullName,
    userRole:   req.user!.role,
    action:     AuditAction.INVOICE_CANCEL,
    entityType: "invoice",
    entityId:   id,
    details:    `Brouillon annulé (ID ${id})`,
  });

  const updated = await fetchFullInvoice(id);
  res.json(serializeInvoice(updated!));
});

// ---------------------------------------------------------------------------
// GET /invoices/:id/pdf  — download PDF (base64)
// ---------------------------------------------------------------------------
router.get("/invoices/:id/pdf", requirePermission("facturation.view"), async (req, res) => {
  const { id } = DownloadInvoicePdfParams.parse(req.params);

  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);
  if (!inv.pdfDocumentId) {
    throw new HttpError(400, "Le PDF n'est disponible que pour les factures validées.");
  }

  const doc = await db.query.documentsTable.findFirst({
    where: and(
      eq(documentsTable.id, inv.pdfDocumentId),
      eq(documentsTable.firmId, inv.firmId),
    ),
  });
  if (!doc) throw new HttpError(404, "Document PDF introuvable.");

  res.json({
    invoiceId:     inv.id,
    invoiceNumber: inv.invoiceNumber!,
    fileName:      doc.fileName,
    mimeType:      doc.mimeType,
    fileData:      doc.fileData,
  });
});

// ---------------------------------------------------------------------------
// POST /invoices/:id/credit-note  — generate avoir (credit note)
// ---------------------------------------------------------------------------
router.post("/invoices/:id/credit-note", requirePermission("facturation.create"), async (req, res) => {
  const { id }  = CreateCreditNoteParams.parse(req.params);
  const body     = CreateCreditNoteBody.parse(req.body);

  const original = await fetchFullInvoice(id);
  if (!original) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(original, req);
  if (original.status !== "VALIDE" && original.status !== "PAYE") {
    throw new HttpError(
      400,
      "Un avoir ne peut être émis que pour une facture VALIDÉE ou PAYÉE.",
    );
  }

  const firm = await db.query.firmsTable.findFirst({
    where: eq(firmsTable.id, original.firmId),
    columns: { name: true },
  });

  const year            = new Date().getFullYear();
  const creditNoteNumber = await getNextInvoiceNumber(original.firmId, original.clientId, year, "AVO");

  // Create the credit note invoice record with mirrored (negative) totals.
  const creditLabel = `Avoir ${creditNoteNumber} — Ref. ${original.invoiceNumber} — ${body.reason}`;
  const [creditInv] = await db
    .insert(invoicesTable)
    .values({
      firmId:          original.firmId,
      clientId:        original.clientId,
      invoiceNumber:   creditNoteNumber,
      customerName:    original.customerName,
      customerEmail:   original.customerEmail,
      customerAddress: original.customerAddress,
      subtotalHt:      -original.subtotalHt,
      vatRate:         original.vatRate,
      vatAmount:       -original.vatAmount,
      totalTtc:        -original.totalTtc,
      invoiceDate:     new Date(),
      dueDate:         null,
      notes:           creditLabel,
      status:          "VALIDE",
      createdById:     req.user!.id,
    })
    .returning();

  // Duplicate items with negative unit price to mirror the original.
  if (original.items.length > 0) {
    await db.insert(invoiceItemsTable).values(
      original.items.map((it) => ({
        invoiceId:    creditInv.id,
        designation:  `[AVOIR] ${it.designation}`,
        quantity:     it.quantity,
        unitPrice:    -it.unitPrice,
        vatRate:      it.vatRate,
        totalItemHt:  -it.totalItemHt,
      })),
    );
  }

  // Generate PDF for the credit note.
  const pdfBuffer = await generateInvoicePdf({
    invoiceNumber:   creditNoteNumber,
    invoiceDate:     new Date(),
    sellerName:      original.client?.name ?? "—",
    sellerAddress:   original.client?.address ?? null,
    sellerRccm:      original.client?.rccm ?? null,
    customerName:    original.customerName,
    customerEmail:   original.customerEmail,
    customerAddress: original.customerAddress,
    subtotalHt:      -original.subtotalHt,
    vatRate:         original.vatRate,
    vatAmount:       -original.vatAmount,
    totalTtc:        -original.totalTtc,
    notes:           creditLabel,
    items:           original.items.map((it) => ({
      designation:  `[AVOIR] ${it.designation}`,
      quantity:     it.quantity,
      unitPrice:    -it.unitPrice,
      vatRate:      it.vatRate,
      totalItemHt:  -it.totalItemHt,
    })),
    footerFirmName: `M15-AUDIT — ${firm?.name ?? "Cabinet comptable"}`,
  });

  const [pdfDoc] = await db
    .insert(documentsTable)
    .values({
      firmId:       original.firmId,
      clientId:     original.clientId,
      category:     "Factures",
      fileName:     `${creditNoteNumber}.pdf`,
      mimeType:     "application/pdf",
      fileSize:     pdfBuffer.length,
      fileData:     pdfBuffer.toString("base64"),
      uploadedById: req.user!.id,
    })
    .returning();

  // Reversal accounting entry: mirror 706 / 443xxx → 411.
  // Resolve the TVA account from vat_settings (same logic as validate).
  const originalVatSetting = original.vatAmount > 0
    ? await db.query.vatSettingsTable.findFirst({
        where: and(
          eq(vatSettingsTable.firmId, original.firmId),
          eq(vatSettingsTable.ratePercentage, original.vatRate),
          eq(vatSettingsTable.isActive, true),
        ),
      })
    : null;
  const creditNoteTvaAccount =
    originalVatSetting?.salesAccount ?? ACCOUNT_TVA_COLLECTEE_18;

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId:      original.firmId,
      clientId:    original.clientId,
      date:        new Date(),
      label:       creditLabel,
      amount:      original.totalTtc,
      type:        "depense",
      category:    "Avoir — Annulation de facture",
      paymentType: "credit",
      paymentMethod: null,
      status:      "valide",
      source:      "manual_cabinet",
      documentId:  pdfDoc.id,
      createdById: req.user!.id,
      validatedById: req.user!.id,
      validatedAt:   new Date(),
      anomalies:   [],
    })
    .returning();

  const creditNoteLines: typeof journalLinesTable.$inferInsert[] = [
    { transactionId: tx.id, accountNumber: "706100", debitAmount: original.subtotalHt, creditAmount: 0,               label: creditLabel },
    { transactionId: tx.id, accountNumber: "411100", debitAmount: 0,                  creditAmount: original.totalTtc, label: creditLabel },
  ];
  if (original.vatAmount > 0) {
    creditNoteLines.push({
      transactionId: tx.id,
      accountNumber: creditNoteTvaAccount,
      debitAmount:   original.vatAmount,
      creditAmount:  0,
      label:         `TVA ${original.vatRate}% — ${creditNoteNumber}`,
    });
  }
  await db.insert(journalLinesTable).values(creditNoteLines);

  await db
    .update(invoicesTable)
    .set({ pdfDocumentId: pdfDoc.id, postedTransactionId: tx.id })
    .where(eq(invoicesTable.id, creditInv.id));

  await logAudit({
    firmId:     req.user!.firmId,
    userId:     req.user!.id,
    userName:   req.user!.fullName,
    userRole:   req.user!.role,
    action:     AuditAction.CREDIT_NOTE_CREATE,
    entityType: "invoice",
    entityId:   creditInv.id,
    details:    `Avoir émis : ${creditNoteNumber} — Réf. ${original.invoiceNumber} — Motif: ${body.reason}`,
  });

  const full = await fetchFullInvoice(creditInv.id);
  res.status(201).json(serializeInvoice(full!));
});

// ---------------------------------------------------------------------------
// GET /invoice-products — list active products in the firm's catalog
// ---------------------------------------------------------------------------
router.get("/invoice-products", requirePermission("facturation.view"), async (req, res) => {
  const products = await db.query.invoiceProductsTable.findMany({
    where: and(
      eq(invoiceProductsTable.firmId, req.user!.firmId),
      eq(invoiceProductsTable.isActive, true),
    ),
    orderBy: [asc(invoiceProductsTable.designation)],
  });
  res.json(
    products.map((p) => ({
      id: p.id,
      firmId: p.firmId,
      designation: p.designation,
      defaultUnitPrice: p.defaultUnitPrice,
      vatRate: p.vatRate,
      description: p.description ?? null,
      isActive: p.isActive,
      createdAt: p.createdAt,
    })),
  );
});

// ---------------------------------------------------------------------------
// POST /invoice-products — create a product in the catalog
// ---------------------------------------------------------------------------
router.post("/invoice-products", requirePermission("facturation.create"), async (req, res) => {
  const body = CreateInvoiceProductBody.parse(req.body);
  const [product] = await db
    .insert(invoiceProductsTable)
    .values({
      firmId: req.user!.firmId,
      designation: body.designation,
      defaultUnitPrice: body.defaultUnitPrice,
      vatRate: body.vatRate ?? 18,
      description: body.description ?? null,
    })
    .returning();
  res.status(201).json({
    id: product!.id,
    firmId: product!.firmId,
    designation: product!.designation,
    defaultUnitPrice: product!.defaultUnitPrice,
    vatRate: product!.vatRate,
    description: product!.description ?? null,
    isActive: product!.isActive,
    createdAt: product!.createdAt,
  });
});

// ---------------------------------------------------------------------------
// DELETE /invoice-products/:id — soft-delete (deactivate) a catalog product
// ---------------------------------------------------------------------------
router.delete("/invoice-products/:id", requirePermission("facturation.create"), async (req, res) => {
  const { id } = DeleteInvoiceProductParams.parse(req.params);
  const existing = await db.query.invoiceProductsTable.findFirst({
    where: and(
      eq(invoiceProductsTable.id, id),
      eq(invoiceProductsTable.firmId, req.user!.firmId),
    ),
  });
  if (!existing) throw new HttpError(404, "Article introuvable.");
  await db
    .update(invoiceProductsTable)
    .set({ isActive: false })
    .where(eq(invoiceProductsTable.id, id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /invoices/:id/remind — send a payment reminder for a validated invoice
// ---------------------------------------------------------------------------
router.post("/invoices/:id/remind", requirePermission("facturation.create"), async (req, res) => {
  const { id } = RemindInvoiceParams.parse(req.params);

  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);

  if (inv.status === "PAYE") {
    throw new HttpError(400, "Impossible d'envoyer une relance pour une facture déjà payée.");
  }
  if (inv.status === "ANNULE") {
    throw new HttpError(400, "Impossible d'envoyer une relance pour une facture annulée.");
  }
  if (inv.status === "BROUILLON") {
    throw new HttpError(400, "Validez la facture avant d'envoyer une relance.");
  }

  let emailSent = false;

  if (inv.customerEmail) {
    try {
      const duePart = inv.dueDate
        ? ` (échéance : ${new Date(inv.dueDate).toLocaleDateString("fr-FR")})`
        : "";
      const balanceDue = inv.totalTtc - inv.amountPaid;
      const balancePart =
        inv.amountPaid > 0
          ? `<p>Solde restant : <strong>${balanceDue.toLocaleString("fr-FR")} FCFA</strong> (acompte de ${inv.amountPaid.toLocaleString("fr-FR")} FCFA déjà reçu).</p>`
          : "";
      await sendMail({
        to: inv.customerEmail,
        subject: `Rappel de paiement — Facture ${inv.invoiceNumber}`,
        html: `<p>Bonjour,</p>
<p>Nous vous rappelons que la facture <strong>${inv.invoiceNumber}</strong> d'un montant de <strong>${inv.totalTtc.toLocaleString("fr-FR")} FCFA TTC</strong>${duePart} est en attente de règlement.</p>
${balancePart}
<p>Nous vous remercions de procéder au règlement dans les meilleurs délais.</p>
<p>Cordialement,<br>${inv.client?.name ?? "Votre prestataire"}</p>`,
      });
      emailSent = true;
    } catch (err) {
      // Non-blocking: log but don't fail the request
      console.error("[remind] Email failed:", err);
    }
  }

  await db
    .update(invoicesTable)
    .set({ lastRemindedAt: new Date() })
    .where(eq(invoicesTable.id, id));

  await logAudit({
    firmId:     req.user!.firmId,
    userId:     req.user!.id,
    userName:   req.user!.fullName,
    userRole:   req.user!.role,
    action:     AuditAction.INVOICE_MARK_PAID as string as typeof AuditAction.INVOICE_MARK_PAID,
    entityType: "invoice",
    entityId:   id,
    details:    `Relance envoyée — Facture ${inv.invoiceNumber}${emailSent ? ` — email → ${inv.customerEmail}` : " — sans email (aucune adresse)"}`,
  });

  res.json({ invoiceId: id, reminded: true, emailSent });
});

export default router;
