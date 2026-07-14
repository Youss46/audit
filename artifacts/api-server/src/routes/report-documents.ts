import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  accountsTable,
  documentTemplatesTable,
  generatedDocumentsTable,
  type DocumentTemplateType,
} from "@workspace/db";
import {
  ListDocumentTemplatesResponse,
  CompileReportDocumentParams,
  CompileReportDocumentResponse,
  ListGeneratedDocumentsQueryParams,
  ListGeneratedDocumentsResponse,
  GetGeneratedDocumentParams,
  GetGeneratedDocumentResponse,
  CreateGeneratedDocumentBody,
  UpdateGeneratedDocumentParams,
  UpdateGeneratedDocumentBody,
  FinalizeGeneratedDocumentParams,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import type { LedgerLine } from "../lib/reporting-engine";
import { computeDocumentPlaceholderValues, hydrateTemplate } from "../lib/document-hydrator";
import { generateReportDocumentPdf } from "../lib/export-engine";

const router: IRouter = Router();

router.use(requireAuth);

// Same minimal ledger fetcher used by dsf.ts/reporting.ts: only "valide"
// journal lines feed a client-facing figure.
async function fetchValidatedLedgerLines(clientId: number, firmId: number): Promise<LedgerLine[]> {
  const rows = await db
    .select({
      accountNumber: journalLinesTable.accountNumber,
      debitAmount: journalLinesTable.debitAmount,
      creditAmount: journalLinesTable.creditAmount,
      transactionDate: transactionsTable.date,
      transactionType: transactionsTable.type,
      category: transactionsTable.category,
      lineLabel: journalLinesTable.label,
      transactionLabel: transactionsTable.label,
      transactionPaymentType: transactionsTable.paymentType,
      transactionSettledAt: transactionsTable.settledAt,
    })
    .from(journalLinesTable)
    .innerJoin(transactionsTable, eq(journalLinesTable.transactionId, transactionsTable.id))
    .where(
      and(
        eq(transactionsTable.clientId, clientId),
        eq(transactionsTable.firmId, firmId),
        eq(transactionsTable.status, "valide"),
      ),
    );

  const accountNumbers = Array.from(new Set(rows.map((r) => r.accountNumber)));
  const accounts =
    accountNumbers.length > 0
      ? await db.query.accountsTable.findMany({
          where: (a, { inArray }) => inArray(a.accountNumber, accountNumbers),
        })
      : [];
  const accountsByNumber = new Map(accounts.map((a) => [a.accountNumber, a]));

  return rows.map((row) => {
    const account = accountsByNumber.get(row.accountNumber);
    return {
      accountNumber: row.accountNumber,
      accountName: account?.name ?? row.accountNumber,
      accountClass: account?.accountClass ?? (Number(row.accountNumber[0]) || 0),
      debitAmount: row.debitAmount,
      creditAmount: row.creditAmount,
      transactionDate: row.transactionDate,
      transactionType: row.transactionType,
      category: row.category,
      label: row.lineLabel ?? row.transactionLabel,
      transactionPaymentType: row.transactionPaymentType,
      transactionSettledAt: row.transactionSettledAt,
    };
  });
}

async function findAuthorizedClient(req: Parameters<typeof requireOwnClient>[0], clientId: number) {
  return db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
}

async function findOwnGeneratedDocument(firmId: number, id: number) {
  return db.query.generatedDocumentsTable.findFirst({
    where: and(eq(generatedDocumentsTable.id, id), eq(generatedDocumentsTable.firmId, firmId)),
  });
}

// ---------------------------------------------------------------------------
// GET /documents-synthesis/templates — dropdown source (global, all firms).
// ---------------------------------------------------------------------------

router.get("/documents-synthesis/templates", async (_req, res) => {
  const rows = await db.query.documentTemplatesTable.findMany({
    orderBy: (t, { asc }) => [asc(t.templateType), asc(t.title)],
  });
  res.json(
    ListDocumentTemplatesResponse.parse(
      rows.map((t) => ({ id: t.id, templateType: t.templateType, title: t.title })),
    ),
  );
});

// ---------------------------------------------------------------------------
// GET /documents-synthesis/compile/:clientId/:templateId/:year — hydrate a
// template with the client's real figures WITHOUT persisting anything. The
// frontend immediately POSTs the result to /generated to open an editable,
// saved draft.
// ---------------------------------------------------------------------------

router.get("/documents-synthesis/compile/:clientId/:templateId/:year", async (req, res) => {
  const { clientId, templateId, year } = CompileReportDocumentParams.parse(req.params);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const template = await db.query.documentTemplatesTable.findFirst({
    where: eq(documentTemplatesTable.id, templateId),
  });
  if (!template) {
    res.status(404).json({ error: "Modèle de document introuvable." });
    return;
  }

  const lines = await fetchValidatedLedgerLines(clientId, req.user!.firmId);
  const values = computeDocumentPlaceholderValues(client, year, lines);
  const { html, unresolvedKeys } = hydrateTemplate(template.contentHtml, values);

  res.json(
    CompileReportDocumentResponse.parse({
      templateId: template.id,
      templateType: template.templateType,
      title: `${template.title} — ${client.name} — ${year}`,
      contentHtml: html,
      unresolvedKeys,
    }),
  );
});

// ---------------------------------------------------------------------------
// GET /documents-synthesis/generated?clientId=&year= — history for a client.
// ---------------------------------------------------------------------------

router.get("/documents-synthesis/generated", async (req, res) => {
  const { clientId, year } = ListGeneratedDocumentsQueryParams.parse(req.query);
  if (!requireOwnClient(req, res, clientId)) return;

  const client = await findAuthorizedClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const rows = await db.query.generatedDocumentsTable.findMany({
    where: and(
      eq(generatedDocumentsTable.firmId, req.user!.firmId),
      eq(generatedDocumentsTable.clientId, clientId),
      year !== undefined ? eq(generatedDocumentsTable.year, year) : undefined,
    ),
    orderBy: (d, { desc: descOrder }) => [descOrder(d.updatedAt)],
  });

  res.json(
    ListGeneratedDocumentsResponse.parse(
      rows.map((d) => ({
        id: d.id,
        clientId: d.clientId,
        templateId: d.templateId,
        templateType: d.templateType,
        year: d.year,
        title: d.title,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
        finalizedAt: d.finalizedAt ? d.finalizedAt.toISOString() : null,
      })),
    ),
  );
});

// ---------------------------------------------------------------------------
// GET /documents-synthesis/generated/:id — full record (incl. contentHtml).
// ---------------------------------------------------------------------------

router.get("/documents-synthesis/generated/:id", async (req, res) => {
  const { id } = GetGeneratedDocumentParams.parse(req.params);
  const doc = await findOwnGeneratedDocument(req.user!.firmId, id);
  if (!doc) {
    res.status(404).json({ error: "Document introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, doc.clientId)) return;

  res.json(
    GetGeneratedDocumentResponse.parse({
      id: doc.id,
      clientId: doc.clientId,
      templateId: doc.templateId,
      templateType: doc.templateType,
      year: doc.year,
      title: doc.title,
      contentHtml: doc.contentHtml,
      status: doc.status,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      finalizedAt: doc.finalizedAt ? doc.finalizedAt.toISOString() : null,
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /documents-synthesis/generated — persist a compiled/edited document
// as a DRAFT (or, if the accountant skips editing, straight to FINAL).
// ---------------------------------------------------------------------------

router.post("/documents-synthesis/generated", async (req, res) => {
  const body = CreateGeneratedDocumentBody.parse(req.body);
  if (!requireOwnClient(req, res, body.clientId)) return;

  const client = await findAuthorizedClient(req, body.clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }
  const template = await db.query.documentTemplatesTable.findFirst({
    where: eq(documentTemplatesTable.id, body.templateId),
  });
  if (!template) {
    res.status(404).json({ error: "Modèle de document introuvable." });
    return;
  }

  const status = body.status ?? "DRAFT";
  const [created] = await db
    .insert(generatedDocumentsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: body.clientId,
      templateId: body.templateId,
      templateType: template.templateType as DocumentTemplateType,
      year: body.year,
      title: body.title,
      contentHtml: body.contentHtml,
      status,
      createdByUserId: req.user!.id,
      finalizedAt: status === "FINAL" ? new Date() : null,
    })
    .returning();

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.REPORT_DOCUMENT_CREATE,
    entityType: "generated_document",
    entityId: created.id,
    details: `Génération du document "${created.title}" (${created.templateType}, exercice ${created.year}, statut ${created.status}) pour "${client.name}"`,
    ipAddress: req.ip,
  });

  res.status(201).json(
    GetGeneratedDocumentResponse.parse({
      id: created.id,
      clientId: created.clientId,
      templateId: created.templateId,
      templateType: created.templateType,
      year: created.year,
      title: created.title,
      contentHtml: created.contentHtml,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      finalizedAt: created.finalizedAt ? created.finalizedAt.toISOString() : null,
    }),
  );
});

// ---------------------------------------------------------------------------
// PATCH /documents-synthesis/generated/:id — edit title/content while DRAFT.
// A FINAL document is immutable -- the whole point of "locking" it.
// ---------------------------------------------------------------------------

router.patch("/documents-synthesis/generated/:id", async (req, res) => {
  const { id } = UpdateGeneratedDocumentParams.parse(req.params);
  const body = UpdateGeneratedDocumentBody.parse(req.body);

  const doc = await findOwnGeneratedDocument(req.user!.firmId, id);
  if (!doc) {
    res.status(404).json({ error: "Document introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, doc.clientId)) return;
  if (doc.status === "FINAL") {
    res.status(409).json({ error: "Ce document est finalisé et ne peut plus être modifié." });
    return;
  }

  const [updated] = await db
    .update(generatedDocumentsTable)
    .set({
      title: body.title ?? doc.title,
      contentHtml: body.contentHtml ?? doc.contentHtml,
    })
    .where(eq(generatedDocumentsTable.id, id))
    .returning();

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.REPORT_DOCUMENT_UPDATE,
    entityType: "generated_document",
    entityId: id,
    details: `Mise à jour du brouillon "${updated.title}"`,
    ipAddress: req.ip,
  });

  res.json(
    GetGeneratedDocumentResponse.parse({
      id: updated.id,
      clientId: updated.clientId,
      templateId: updated.templateId,
      templateType: updated.templateType,
      year: updated.year,
      title: updated.title,
      contentHtml: updated.contentHtml,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      finalizedAt: updated.finalizedAt ? updated.finalizedAt.toISOString() : null,
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /documents-synthesis/generated/:id/finalize — lock a DRAFT to FINAL.
// ---------------------------------------------------------------------------

router.post("/documents-synthesis/generated/:id/finalize", async (req, res) => {
  const { id } = FinalizeGeneratedDocumentParams.parse(req.params);

  const doc = await findOwnGeneratedDocument(req.user!.firmId, id);
  if (!doc) {
    res.status(404).json({ error: "Document introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, doc.clientId)) return;
  if (doc.status === "FINAL") {
    res.status(409).json({ error: "Ce document est déjà finalisé." });
    return;
  }

  const [updated] = await db
    .update(generatedDocumentsTable)
    .set({ status: "FINAL", finalizedAt: new Date() })
    .where(eq(generatedDocumentsTable.id, id))
    .returning();

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.REPORT_DOCUMENT_FINALIZE,
    entityType: "generated_document",
    entityId: id,
    details: `Finalisation (verrouillage) du document "${updated.title}"`,
    ipAddress: req.ip,
  });

  res.json(
    GetGeneratedDocumentResponse.parse({
      id: updated.id,
      clientId: updated.clientId,
      templateId: updated.templateId,
      templateType: updated.templateType,
      year: updated.year,
      title: updated.title,
      contentHtml: updated.contentHtml,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      finalizedAt: updated.finalizedAt ? updated.finalizedAt.toISOString() : null,
    }),
  );
});

// ---------------------------------------------------------------------------
// GET /documents-synthesis/generated/:id/pdf — render the document's current
// HTML to PDF. Not part of the typed OpenAPI/Orval contract, same
// convention as /tax/exports/dsf (binary download route).
// ---------------------------------------------------------------------------

router.get("/documents-synthesis/generated/:id/pdf", async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const doc = await findOwnGeneratedDocument(req.user!.firmId, id);
  if (!doc) {
    res.status(404).json({ error: "Document introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, doc.clientId)) return;

  const client = await findAuthorizedClient(req, doc.clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const buffer = await generateReportDocumentPdf(doc.title, client.name, doc.year, doc.contentHtml);
  const slug = doc.title.replace(/[^a-zA-Z0-9]/g, "_");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer);

  logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.REPORT_DOCUMENT_PDF_EXPORT,
    entityType: "generated_document",
    entityId: id,
    details: `Export PDF du document "${doc.title}" (statut ${doc.status})`,
    ipAddress: req.ip,
  });
});

export default router;
