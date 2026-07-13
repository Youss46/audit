import { relations } from "drizzle-orm";
import { firmsTable } from "./firms";
import { usersTable } from "./users";
import { clientsTable } from "./clients";
import { missionsTable } from "./missions";
import { checklistItemsTable } from "./checklist-items";
import { documentsTable } from "./documents";
import { auditLogsTable } from "./audit-logs";
import { transactionsTable, journalLinesTable } from "./accounting";

export const firmsRelations = relations(firmsTable, ({ many }) => ({
  users: many(usersTable),
  clients: many(clientsTable),
}));

export const usersRelations = relations(usersTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [usersTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [usersTable.clientId], references: [clientsTable.id] }),
}));

export const clientsRelations = relations(clientsTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [clientsTable.firmId], references: [firmsTable.id] }),
  missions: many(missionsTable),
  documents: many(documentsTable),
  portalUsers: many(usersTable),
  transactions: many(transactionsTable),
}));

export const missionsRelations = relations(missionsTable, ({ one, many }) => ({
  client: one(clientsTable, { fields: [missionsTable.clientId], references: [clientsTable.id] }),
  checklistItems: many(checklistItemsTable),
  assignedTo: one(usersTable, {
    fields: [missionsTable.assignedToId],
    references: [usersTable.id],
  }),
}));

export const checklistItemsRelations = relations(checklistItemsTable, ({ one }) => ({
  mission: one(missionsTable, {
    fields: [checklistItemsTable.missionId],
    references: [missionsTable.id],
  }),
}));

export const documentsRelations = relations(documentsTable, ({ one }) => ({
  client: one(clientsTable, { fields: [documentsTable.clientId], references: [clientsTable.id] }),
  mission: one(missionsTable, {
    fields: [documentsTable.missionId],
    references: [missionsTable.id],
  }),
  uploadedBy: one(usersTable, {
    fields: [documentsTable.uploadedById],
    references: [usersTable.id],
  }),
}));

export const auditLogsRelations = relations(auditLogsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [auditLogsTable.firmId], references: [firmsTable.id] }),
}));

export const transactionsRelations = relations(transactionsTable, ({ one, many }) => ({
  client: one(clientsTable, {
    fields: [transactionsTable.clientId],
    references: [clientsTable.id],
  }),
  document: one(documentsTable, {
    fields: [transactionsTable.documentId],
    references: [documentsTable.id],
  }),
  createdBy: one(usersTable, {
    fields: [transactionsTable.createdById],
    references: [usersTable.id],
  }),
  validatedBy: one(usersTable, {
    fields: [transactionsTable.validatedById],
    references: [usersTable.id],
  }),
  journalLines: many(journalLinesTable),
  // Self-relation for credit (accrual) operations: a "settlement"
  // transaction points back to the original operation it settles.
  parentTransaction: one(transactionsTable, {
    fields: [transactionsTable.parentTransactionId],
    references: [transactionsTable.id],
    relationName: "settlement",
  }),
  settlementTransaction: many(transactionsTable, {
    relationName: "settlement",
  }),
}));

export const journalLinesRelations = relations(journalLinesTable, ({ one }) => ({
  transaction: one(transactionsTable, {
    fields: [journalLinesTable.transactionId],
    references: [transactionsTable.id],
  }),
}));
