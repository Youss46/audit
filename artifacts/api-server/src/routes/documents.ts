import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientsTable, documentsTable } from "@workspace/db";
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
import { requireAuth } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.use(requireAuth);

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

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ message: "Client introuvable." });
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
  const body = UploadClientDocumentBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ message: "Client introuvable." });
    return;
  }

  const fileSize = Buffer.byteLength(body.fileData, "base64");

  const [doc] = await db
    .insert(documentsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: id,
      missionId: body.missionId ?? null,
      category: body.category,
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize,
      fileData: body.fileData,
      uploadedById: req.user!.id,
    })
    .returning();

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
    res.status(404).json({ message: "Document introuvable." });
    return;
  }

  res.json(
    GetDocumentResponse.parse({
      ...serializeMetadata(doc, doc.uploadedBy?.fullName ?? null),
      fileData: doc.fileData,
    }),
  );
});

router.delete("/documents/:id", async (req, res) => {
  const { id } = DeleteDocumentParams.parse(req.params);

  const doc = await db.query.documentsTable.findFirst({
    where: and(eq(documentsTable.id, id), eq(documentsTable.firmId, req.user!.firmId)),
  });
  if (!doc) {
    res.status(404).json({ message: "Document introuvable." });
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
});

export default router;
