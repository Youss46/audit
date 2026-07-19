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

// Module M6 (GED) — Archive fiscale. A folder node in the client's document
// tree. Today this table only exists to model the *locked annual archive*
// created automatically at fiscal year closing (M19): one root folder
// ("Exercice 2025", isArchived=true) containing 4 fixed sub-folders. Regular,
// non-archived documents keep using the free-text `documents.category` field
// -- this table is not (yet) a general-purpose folder tree for active docs.
export const documentFoldersTable = pgTable(
  "document_folders",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // Self-reference: null = root folder (e.g. "Exercice 2025"), set = one
    // of the 4 fixed sub-folders underneath it.
    parentFolderId: integer("parent_folder_id"),
    name: text("name").notNull(),
    // Locked/frozen archive flag. Once true, the folder (and every document
    // filed under it) is strictly read-only for every role.
    isArchived: boolean("is_archived").notNull().default(false),
    // Fiscal year this folder belongs to (set on the root archive folder and
    // copied onto its children for easy filtering/grouping in the UI).
    fiscalYear: integer("fiscal_year"),
    // Stable machine-readable identifier for the 4 canonical archive
    // sub-folders (see ARCHIVE_SUBFOLDERS in closing-engine.ts). Null for the
    // year-root folder itself.
    folderCategory: text("folder_category"),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("document_folders_firm_id_idx").on(table.firmId),
    index("document_folders_client_id_idx").on(table.clientId),
    index("document_folders_parent_folder_id_idx").on(table.parentFolderId),
  ],
);

export const insertDocumentFolderSchema = createInsertSchema(documentFoldersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDocumentFolder = z.infer<typeof insertDocumentFolderSchema>;
export type DocumentFolder = typeof documentFoldersTable.$inferSelect;
