import { Router, type IRouter } from "express";
import { and, desc, eq, like, max } from "drizzle-orm";
import {
  db,
  clientsTable,
  firmsTable,
  documentsTable,
  transactionsTable,
  journalLinesTable,
  invoicesTable,
  invoiceItemsTable,
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
  CancelInvoiceParams,
  DownloadInvoicePdfParams,
  CreateCreditNoteParams,
  CreateCreditNoteBody,
} from "@workspace/api-zod";
import { requireAuth, requirePermission } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { generateInvoicePdf } from "../lib/export-engine";

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

  // 5. Post SYSCOHADA accounting entry: 411 / 706 / 443100.
  //    Directly inserted (bypasses PME validation flow, identical to how
  //    the closing engine and payroll engine write their entries).
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

  await db.insert(journalLinesTable).values([
    // Débit 411 — Clients (montant TTC)
    {
      transactionId: tx.id,
      accountNumber: "411",
      debitAmount:   inv.totalTtc,
      creditAmount:  0,
      label:         txLabel,
    },
    // Crédit 706 — Prestations de services (montant HT)
    {
      transactionId: tx.id,
      accountNumber: "706",
      debitAmount:   0,
      creditAmount:  inv.subtotalHt,
      label:         txLabel,
    },
    // Crédit 443100 — TVA Facturée
    {
      transactionId: tx.id,
      accountNumber: "443100",
      debitAmount:   0,
      creditAmount:  inv.vatAmount,
      label:         `TVA ${inv.vatRate}% — ${invoiceNumber}`,
    },
  ]);

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

  const inv = await fetchFullInvoice(id);
  if (!inv) throw new HttpError(404, "Facture introuvable.");
  assertOwnership(inv, req);
  if (inv.status !== "VALIDE") {
    throw new HttpError(400, "Seule une facture VALIDÉE peut être marquée comme payée.");
  }

  await db
    .update(invoicesTable)
    .set({ status: "PAYE" })
    .where(eq(invoicesTable.id, id));

  await logAudit({
    firmId:     req.user!.firmId,
    userId:     req.user!.id,
    userName:   req.user!.fullName,
    userRole:   req.user!.role,
    action:     AuditAction.INVOICE_MARK_PAID,
    entityType: "invoice",
    entityId:   id,
    details:    `Facture marquée PAYÉE : ${inv.invoiceNumber}`,
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

  // Reversal accounting entry: mirror 706 / 443100 → 411.
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

  await db.insert(journalLinesTable).values([
    { transactionId: tx.id, accountNumber: "706",    debitAmount: original.subtotalHt, creditAmount: 0,                     label: creditLabel },
    { transactionId: tx.id, accountNumber: "443100", debitAmount: original.vatAmount,  creditAmount: 0,                     label: `TVA ${original.vatRate}% — ${creditNoteNumber}` },
    { transactionId: tx.id, accountNumber: "411",    debitAmount: 0,                   creditAmount: original.totalTtc,     label: creditLabel },
  ]);

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

export default router;
