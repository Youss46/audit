import {
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
    category: text("category").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileData: text("file_data").notNull(),
    uploadedById: integer("uploaded_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_firm_id_idx").on(table.firmId),
    index("documents_client_id_idx").on(table.clientId),
  ],
);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
