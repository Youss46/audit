import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, clientsTable, documentFoldersTable, documentsTable } from "@workspace/db";
import {
  ListClientDocumentFoldersParams,
  ListFolderDocumentsParams,
  ListFolderDocumentsResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth);

function serializeFolder(f: typeof documentFoldersTable.$inferSelect) {
  return {
    id: f.id,
    firmId: f.firmId,
    clientId: f.clientId,
    parentFolderId: f.parentFolderId ?? null,
    name: f.name,
    isArchived: f.isArchived,
    fiscalYear: f.fiscalYear ?? null,
    folderCategory: f.folderCategory ?? null,
    createdAt: f.createdAt,
  };
}

// ---------------------------------------------------------------------------
// GET /clients/:id/document-folders
// Returns the fiscal archive folder tree for a client: root "Exercice YYYY"
// folders (isArchived=true, parentFolderId=null) with their 4 sub-folders
// nested as `children`. Used by the "Archives Fiscales" GED tab.
// ---------------------------------------------------------------------------
router.get("/clients/:id/document-folders", async (req, res) => {
  const { id } = ListClientDocumentFoldersParams.parse(req.params);
  if (!requireOwnClient(req, res, id)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, id), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const rootFolders = await db.query.documentFoldersTable.findMany({
    where: and(
      eq(documentFoldersTable.firmId, req.user!.firmId),
      eq(documentFoldersTable.clientId, id),
      eq(documentFoldersTable.isArchived, true),
      isNull(documentFoldersTable.parentFolderId),
    ),
    with: { children: true },
    orderBy: (t, { desc }) => [desc(t.fiscalYear)],
  });

  res.json(
    rootFolders.map((f) => ({
      ...serializeFolder(f),
      children: (f.children ?? [])
        .map(serializeFolder)
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    })),
  );
});

// ---------------------------------------------------------------------------
// GET /document-folders/:folderId/documents
// Returns all documents filed inside a specific archive sub-folder.
// Archive documents are strictly read-only (view/download only).
// ---------------------------------------------------------------------------
router.get("/document-folders/:folderId/documents", async (req, res) => {
  const { folderId } = ListFolderDocumentsParams.parse(req.params);

  const folder = await db.query.documentFoldersTable.findFirst({
    where: and(
      eq(documentFoldersTable.id, folderId),
      eq(documentFoldersTable.firmId, req.user!.firmId),
    ),
  });
  if (!folder) {
    res.status(404).json({ error: "Dossier introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, folder.clientId)) return;

  const docs = await db.query.documentsTable.findMany({
    where: and(
      eq(documentsTable.folderId, folderId),
      eq(documentsTable.firmId, req.user!.firmId),
    ),
    orderBy: (t, { asc }) => [asc(t.fileName)],
    with: { uploadedBy: true, client: true },
  });

  res.json(
    ListFolderDocumentsResponse.parse(
      docs.map((d) => ({
        id: d.id,
        firmId: d.firmId,
        clientId: d.clientId,
        clientName: d.client?.name ?? null,
        missionId: d.missionId,
        folderId: d.folderId ?? null,
        folderCategory: d.folderCategory ?? null,
        category: d.category,
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
        isArchived: d.isArchived,
        fiscalYear: d.fiscalYear ?? null,
        uploadedByName: d.uploadedBy?.fullName ?? null,
        createdAt: d.createdAt,
      })),
    ),
  );
});

export default router;
