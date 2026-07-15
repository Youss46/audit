import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";
import { missionsTable } from "./missions";
import { documentFoldersTable } from "./document-folders";

// Document management (module M6, GED). Each document belongs to a client
// folder ("category") and, optionally, a specific mission. File content is
// stored as base64 text -- sufficient for MVP-scale PDFs/images without
// requiring an external object storage integration.
export const documentsTable = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    missionId: integer("mission_id").references(() => missionsTable.id, {
      onDelete: "set null",
    }),
    // Archive fiscale (M6 extension): optional link into the locked annual
    // archive tree (see document-folders.ts). Null for every regular,
    // free-form document filed under `category`.
    folderId: integer("folder_id").references(() => documentFoldersTable.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileData: text("file_data").notNull(),
    uploadedById: integer("uploaded_by_id"),
    // Once true, the document is part of a locked fiscal year archive: it is
    // strictly read-only (view/download only) for every role, mirroring
    // `folderId`'s folder.isArchived for fast, denormalized filtering in the
    // GED list views (Tab "Archives Fiscales" vs "Documents Actifs").
    isArchived: boolean("is_archived").notNull().default(false),
    fiscalYear: integer("fiscal_year"),
    // Machine-readable sub-folder identifier, mirrored from the parent
    // archive folder (see ARCHIVE_SUBFOLDERS in closing-engine.ts).
    folderCategory: text("folder_category"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_firm_id_idx").on(table.firmId),
    index("documents_client_id_idx").on(table.clientId),
    index("documents_folder_id_idx").on(table.folderId),
  ],
);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
