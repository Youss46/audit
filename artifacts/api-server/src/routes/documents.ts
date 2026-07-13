import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientsTable, documentsTable, missionsTable } from "@workspace/db";
import {
  ListClientDocumentsParams,
  ListClientDocumentsResponse,
  UploadClientDocumentParams,
  UploadClientDocumentBody,
  UploadClientDocumentResponse,
  GetDocumentParams,
  GetDocumentResponse,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requireRole } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.use(requireAuth);

// Module P2 (Espace PME): documents uploaded by a client_pme account always
// land in this fixed GED folder/category so the accounting firm can spot
// them at a glance in the client's document tree (module M6).
const PORTAL_UPLOAD_CATEGORY = "Procédure de Visa";
const PORTAL_ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];

function serializeMetadata(doc: typeof documentsTable.$inferSelect, uploadedByName: string | null) {
  return {
    id: doc.id,
    firmId: doc.firmId,
    clientId: doc.clientId,
    missionId: doc.missionId,
    category: doc.category,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    uploadedByName,
    createdAt: doc.createdAt,
  };
}

router.get("/clients/:id/documents", async (req, res) => {
  const { id } = ListClientDocumentsParams.parse(req.params);
  if (!requireOwnClient(req, res, id)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const docs = await db.query.documentsTable.findMany({
    where: eq(documentsTable.clientId, id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { uploadedBy: true },
  });

  res.json(
    ListClientDocumentsResponse.parse(
      docs.map((d) => serializeMetadata(d, d.uploadedBy?.fullName ?? null)),
    ),
  );
});

router.post("/clients/:id/documents", async (req, res) => {
  const { id } = UploadClientDocumentParams.parse(req.params);
  if (!requireOwnClient(req, res, id)) return;
  const body = UploadClientDocumentBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const isPortalUpload = req.user!.role === "client_pme";

  let missionId = body.missionId ?? null;
  let category = body.category;

  if (isPortalUpload) {
    // The PME can only ever deposit files onto the "Procédure de Visa"
    // folder of its own dossier, and only PDF/PNG/JPEG documents.
    if (!PORTAL_ALLOWED_MIME_TYPES.includes(body.mimeType)) {
      res.status(400).json({
        error: "Format de fichier non autorisé. Utilisez un PDF, PNG ou JPEG.",
      });
      return;
    }
    category = PORTAL_UPLOAD_CATEGORY;

    if (!missionId) {
      // Auto-attach to the client's currently active mission (the most
      // recent one not yet visa_emis) when the caller doesn't specify one.
      const activeMission = await db.query.missionsTable.findFirst({
        where: and(eq(missionsTable.clientId, id), eq(missionsTable.firmId, req.user!.firmId)),
        orderBy: (t, { desc }) => [desc(t.fiscalYear)],
      });
      missionId = activeMission?.id ?? null;
    } else {
      const mission = await db.query.missionsTable.findFirst({
        where: and(eq(missionsTable.id, missionId), eq(missionsTable.clientId, id)),
      });
      if (!mission) {
        res.status(404).json({ error: "Mission introuvable pour ce client." });
        return;
      }
    }
  }

  const fileSize = Buffer.byteLength(body.fileData, "base64");

  const [doc] = await db
    .insert(documentsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: id,
      missionId,
      category,
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize,
      fileData: body.fileData,
      uploadedById: req.user!.id,
    })
    .returning();

  // Uploading a document is the client's signal to the firm that the visa
  // procedure can start: bump a still-untouched mission from "en_attente"
  // to "en_cours" automatically (module P2 <-> M4 integration).
  if (missionId) {
    const mission = await db.query.missionsTable.findFirst({
      where: eq(missionsTable.id, missionId),
    });
    if (mission?.status === "en_attente") {
      await db
        .update(missionsTable)
        .set({ status: "en_cours" })
        .where(eq(missionsTable.id, missionId));
      await db
        .update(clientsTable)
        .set({ missionStatus: "en_cours" })
        .where(eq(clientsTable.id, id));
    }
  }

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    action: "upload",
    entityType: "document",
    entityId: doc.id,
    details: `Téléversement de "${doc.fileName}" (${doc.category})`,
  });

  res
    .status(201)
    .json(UploadClientDocumentResponse.parse(serializeMetadata(doc, req.user!.fullName)));
});

router.get("/documents/:id", async (req, res) => {
  const { id } = GetDocumentParams.parse(req.params);

  const doc = await db.query.documentsTable.findFirst({
    where: and(eq(documentsTable.id, id), eq(documentsTable.firmId, req.user!.firmId)),
    with: { uploadedBy: true },
  });
  if (!doc) {
    res.status(404).json({ error: "Document introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, doc.clientId)) return;

  res.json(
    GetDocumentResponse.parse({
      ...serializeMetadata(doc, doc.uploadedBy?.fullName ?? null),
      fileData: doc.fileData,
    }),
  );
});

router.delete(
  "/documents/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = DeleteDocumentParams.parse(req.params);

    const doc = await db.query.documentsTable.findFirst({
      where: and(eq(documentsTable.id, id), eq(documentsTable.firmId, req.user!.firmId)),
    });
    if (!doc) {
      res.status(404).json({ error: "Document introuvable." });
      return;
    }

    await db.delete(documentsTable).where(eq(documentsTable.id, id));

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      action: "delete",
      entityType: "document",
      entityId: id,
      details: `Suppression de "${doc.fileName}"`,
    });

    res.status(204).end();
  },
);

export default router;
