import { relations } from "drizzle-orm";
import { firmsTable } from "./firms";
import { usersTable } from "./users";
import { rolesTable } from "./roles";
import { clientsTable } from "./clients";
import { missionsTable } from "./missions";
import { checklistItemsTable } from "./checklist-items";
import { documentsTable } from "./documents";
import { documentFoldersTable } from "./document-folders";
import { auditLogsTable } from "./audit-logs";
import { transactionsTable, journalLinesTable } from "./accounting";
import { cashRegistersTable, dailyClosuresTable } from "./caisse";
import { fixedAssetsTable } from "./fixed-assets";
import { financialAssetsLoansTable } from "./financial-assets-loans";
import { fiscalYearClosingsTable } from "./closing";
import { employeesTable, payslipsTable } from "./payroll";
import { vatDeclarationsTable } from "./vat";
import { cabinetUserRatesTable, clientContractsTable, timesheetEntriesTable } from "./cabinet-ops";
import { analyticalAxesTable, analyticalCodesTable, analyticalAllocationsTable } from "./analytical";
import { documentTemplatesTable, generatedDocumentsTable } from "./report-documents";
import { collaborationThreadsTable, contextualCommentsTable, notificationsTable } from "./collaboration";
import { financialScoringResultsTable, businessValuationsTable } from "./scoring";
import { invoicesTable, invoiceItemsTable } from "./invoicing";
import { chatChannelsTable, chatChannelMembersTable, chatChannelMessagesTable, chatDirectMessagesTable } from "./chat";
import { payrollSettingsTable } from "./payroll-settings";
import { vatSettingsTable } from "./vat-settings";
import { stationsTable } from "./stations";
import { pumpsTable, pumpShiftsTable, pumpAssignmentsTable, fuelPricesTable } from "./station-service";

export const firmsRelations = relations(firmsTable, ({ many }) => ({
  users: many(usersTable),
  clients: many(clientsTable),
}));

export const usersRelations = relations(usersTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [usersTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [usersTable.clientId], references: [clientsTable.id] }),
  // Module M29: only set for "client_staff" accounts.
  role: one(rolesTable, { fields: [usersTable.roleId], references: [rolesTable.id] }),
  // Multi-station (P8): only set for site-restricted staff (POMPISTE etc.).
  station: one(stationsTable, { fields: [usersTable.stationId], references: [stationsTable.id] }),
}));

// Module M29 (RBAC & Gestion du Personnel PME).
export const rolesRelations = relations(rolesTable, ({ many }) => ({
  staff: many(usersTable),
}));

export const clientsRelations = relations(clientsTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [clientsTable.firmId], references: [firmsTable.id] }),
  missions: many(missionsTable),
  documents: many(documentsTable),
  portalUsers: many(usersTable),
  transactions: many(transactionsTable),
  cashRegisters: many(cashRegistersTable),
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
  folder: one(documentFoldersTable, {
    fields: [documentsTable.folderId],
    references: [documentFoldersTable.id],
  }),
}));

// Module M6 (GED) — Archive fiscale: self-referencing folder tree (root
// "Exercice YYYY" folders and their 4 fixed sub-folders).
export const documentFoldersRelations = relations(documentFoldersTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [documentFoldersTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [documentFoldersTable.clientId], references: [clientsTable.id] }),
  parentFolder: one(documentFoldersTable, {
    fields: [documentFoldersTable.parentFolderId],
    references: [documentFoldersTable.id],
    relationName: "folderChildren",
  }),
  children: many(documentFoldersTable, { relationName: "folderChildren" }),
  documents: many(documentsTable),
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
  cashRegister: one(cashRegistersTable, {
    fields: [transactionsTable.cashRegisterId],
    references: [cashRegistersTable.id],
  }),
  station: one(stationsTable, {
    fields: [transactionsTable.stationId],
    references: [stationsTable.id],
  }),
}));

export const journalLinesRelations = relations(journalLinesTable, ({ one }) => ({
  transaction: one(transactionsTable, {
    fields: [journalLinesTable.transactionId],
    references: [transactionsTable.id],
  }),
}));

// Module P5 (Caisse Terrain) / P6 (Un Pompiste = Une Caisse).
export const cashRegistersRelations = relations(cashRegistersTable, ({ one, many }) => ({
  client: one(clientsTable, {
    fields: [cashRegistersTable.clientId],
    references: [clientsTable.id],
  }),
  closures: many(dailyClosuresTable),
  transactions: many(transactionsTable),
  ownerUser: one(usersTable, {
    fields: [cashRegistersTable.ownerUserId],
    references: [usersTable.id],
  }),
}));

export const dailyClosuresRelations = relations(dailyClosuresTable, ({ one }) => ({
  cashRegister: one(cashRegistersTable, {
    fields: [dailyClosuresTable.cashRegisterId],
    references: [cashRegistersTable.id],
  }),
  closedBy: one(usersTable, {
    fields: [dailyClosuresTable.closedById],
    references: [usersTable.id],
  }),
}));

// Module M17 (Gestion des Immobilisations & Amortissements).
export const fixedAssetsRelations = relations(fixedAssetsTable, ({ one }) => ({
  firm: one(firmsTable, {
    fields: [fixedAssetsTable.firmId],
    references: [firmsTable.id],
  }),
  client: one(clientsTable, {
    fields: [fixedAssetsTable.clientId],
    references: [clientsTable.id],
  }),
  createdBy: one(usersTable, {
    fields: [fixedAssetsTable.createdById],
    references: [usersTable.id],
  }),
}));

// Module M18 (Immobilisations Financières & Emprunts).
export const financialAssetsLoansRelations = relations(financialAssetsLoansTable, ({ one }) => ({
  firm: one(firmsTable, {
    fields: [financialAssetsLoansTable.firmId],
    references: [firmsTable.id],
  }),
  client: one(clientsTable, {
    fields: [financialAssetsLoansTable.clientId],
    references: [clientsTable.id],
  }),
  createdBy: one(usersTable, {
    fields: [financialAssetsLoansTable.createdById],
    references: [usersTable.id],
  }),
}));

// Module M19 (Clôture d'Exercice Comptable).
export const fiscalYearClosingsRelations = relations(fiscalYearClosingsTable, ({ one }) => ({
  firm: one(firmsTable, {
    fields: [fiscalYearClosingsTable.firmId],
    references: [firmsTable.id],
  }),
  client: one(clientsTable, {
    fields: [fiscalYearClosingsTable.clientId],
    references: [clientsTable.id],
  }),
  lockedBy: one(usersTable, {
    fields: [fiscalYearClosingsTable.lockedById],
    references: [usersTable.id],
  }),
}));

// Module M20 (Gestion de la Paie, ITS & CNPS).
export const employeesRelations = relations(employeesTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [employeesTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [employeesTable.clientId], references: [clientsTable.id] }),
  createdBy: one(usersTable, {
    fields: [employeesTable.createdById],
    references: [usersTable.id],
  }),
  payslips: many(payslipsTable),
}));

export const payslipsRelations = relations(payslipsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [payslipsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [payslipsTable.clientId], references: [clientsTable.id] }),
  employee: one(employeesTable, {
    fields: [payslipsTable.employeeId],
    references: [employeesTable.id],
  }),
  postedTransaction: one(transactionsTable, {
    fields: [payslipsTable.postedTransactionId],
    references: [transactionsTable.id],
  }),
  createdBy: one(usersTable, {
    fields: [payslipsTable.createdById],
    references: [usersTable.id],
  }),
}));

// Module M21 (Télédéclaration TVA - Formulaire D-201/VA).
export const vatDeclarationsRelations = relations(vatDeclarationsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [vatDeclarationsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, {
    fields: [vatDeclarationsTable.clientId],
    references: [clientsTable.id],
  }),
  postedTransaction: one(transactionsTable, {
    fields: [vatDeclarationsTable.postedTransactionId],
    references: [transactionsTable.id],
  }),
  createdBy: one(usersTable, {
    fields: [vatDeclarationsTable.createdById],
    references: [usersTable.id],
  }),
}));

// Module M22 (Cabinet Internal Operations, Timesheet & Client Profitability).
export const cabinetUserRatesRelations = relations(cabinetUserRatesTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [cabinetUserRatesTable.firmId], references: [firmsTable.id] }),
  user: one(usersTable, { fields: [cabinetUserRatesTable.userId], references: [usersTable.id] }),
}));

export const clientContractsRelations = relations(clientContractsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [clientContractsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, {
    fields: [clientContractsTable.clientId],
    references: [clientsTable.id],
  }),
}));

export const timesheetEntriesRelations = relations(timesheetEntriesTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [timesheetEntriesTable.firmId], references: [firmsTable.id] }),
  user: one(usersTable, { fields: [timesheetEntriesTable.userId], references: [usersTable.id] }),
  client: one(clientsTable, {
    fields: [timesheetEntriesTable.clientId],
    references: [clientsTable.id],
  }),
}));

// Module M23 (Analytical Accounting — Comptabilité Analytique).
export const analyticalAxesRelations = relations(analyticalAxesTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [analyticalAxesTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [analyticalAxesTable.clientId], references: [clientsTable.id] }),
  codes: many(analyticalCodesTable),
}));

export const analyticalCodesRelations = relations(analyticalCodesTable, ({ one, many }) => ({
  axis: one(analyticalAxesTable, { fields: [analyticalCodesTable.axisId], references: [analyticalAxesTable.id] }),
  firm: one(firmsTable, { fields: [analyticalCodesTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [analyticalCodesTable.clientId], references: [clientsTable.id] }),
  allocations: many(analyticalAllocationsTable),
}));

export const analyticalAllocationsRelations = relations(analyticalAllocationsTable, ({ one }) => ({
  journalLine: one(journalLinesTable, { fields: [analyticalAllocationsTable.journalLineId], references: [journalLinesTable.id] }),
  analyticalCode: one(analyticalCodesTable, { fields: [analyticalAllocationsTable.analyticalCodeId], references: [analyticalCodesTable.id] }),
  firm: one(firmsTable, { fields: [analyticalAllocationsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [analyticalAllocationsTable.clientId], references: [clientsTable.id] }),
}));

// Extend existing journal-line relations to include analytical allocations
// and the parent transaction (needed for firm-level authorization checks in M23).
export const journalLinesAnalyticalRelations = relations(journalLinesTable, ({ many, one }) => ({
  analyticalAllocations: many(analyticalAllocationsTable),
  transaction: one(transactionsTable, {
    fields: [journalLinesTable.transactionId],
    references: [transactionsTable.id],
  }),
}));

// Module M25 (Générateur de Synthèses & Documents Juridiques).
export const generatedDocumentsRelations = relations(generatedDocumentsTable, ({ one }) => ({
  client: one(clientsTable, { fields: [generatedDocumentsTable.clientId], references: [clientsTable.id] }),
  firm: one(firmsTable, { fields: [generatedDocumentsTable.firmId], references: [firmsTable.id] }),
  template: one(documentTemplatesTable, { fields: [generatedDocumentsTable.templateId], references: [documentTemplatesTable.id] }),
  createdBy: one(usersTable, { fields: [generatedDocumentsTable.createdByUserId], references: [usersTable.id] }),
}));

// Module M26 (Révision Collaborative & Chat Contextuel).
export const collaborationThreadsRelations = relations(collaborationThreadsTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [collaborationThreadsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [collaborationThreadsTable.clientId], references: [clientsTable.id] }),
  resolvedBy: one(usersTable, {
    fields: [collaborationThreadsTable.resolvedById],
    references: [usersTable.id],
  }),
  comments: many(contextualCommentsTable),
}));

export const contextualCommentsRelations = relations(contextualCommentsTable, ({ one }) => ({
  thread: one(collaborationThreadsTable, {
    fields: [contextualCommentsTable.threadId],
    references: [collaborationThreadsTable.id],
  }),
  firm: one(firmsTable, { fields: [contextualCommentsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [contextualCommentsTable.clientId], references: [clientsTable.id] }),
  user: one(usersTable, { fields: [contextualCommentsTable.userId], references: [usersTable.id] }),
}));

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [notificationsTable.firmId], references: [firmsTable.id] }),
  recipient: one(usersTable, { fields: [notificationsTable.recipientId], references: [usersTable.id] }),
}));

// Module M27 (Scoring Financier & Évaluation d'Entreprise).
export const financialScoringResultsRelations = relations(financialScoringResultsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [financialScoringResultsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, {
    fields: [financialScoringResultsTable.clientId],
    references: [clientsTable.id],
  }),
}));

export const businessValuationsRelations = relations(businessValuationsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [businessValuationsTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, {
    fields: [businessValuationsTable.clientId],
    references: [clientsTable.id],
  }),
}));

// Module M28 (Facturier Client & Auto-Génération de Pièces).
export const invoicesRelations = relations(invoicesTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [invoicesTable.firmId], references: [firmsTable.id] }),
  client: one(clientsTable, { fields: [invoicesTable.clientId], references: [clientsTable.id] }),
  createdBy: one(usersTable, { fields: [invoicesTable.createdById], references: [usersTable.id] }),
  pdfDocument: one(documentsTable, {
    fields: [invoicesTable.pdfDocumentId],
    references: [documentsTable.id],
  }),
  items: many(invoiceItemsTable),
}));

export const invoiceItemsRelations = relations(invoiceItemsTable, ({ one }) => ({
  invoice: one(invoicesTable, {
    fields: [invoiceItemsTable.invoiceId],
    references: [invoicesTable.id],
  }),
}));

// Module M31 (Messagerie Interne du Cabinet).
export const chatChannelsRelations = relations(chatChannelsTable, ({ one, many }) => ({
  firm: one(firmsTable, { fields: [chatChannelsTable.firmId], references: [firmsTable.id] }),
  createdBy: one(usersTable, { fields: [chatChannelsTable.createdById], references: [usersTable.id] }),
  members: many(chatChannelMembersTable),
  messages: many(chatChannelMessagesTable),
}));

export const chatChannelMembersRelations = relations(chatChannelMembersTable, ({ one }) => ({
  channel: one(chatChannelsTable, {
    fields: [chatChannelMembersTable.channelId],
    references: [chatChannelsTable.id],
  }),
  user: one(usersTable, { fields: [chatChannelMembersTable.userId], references: [usersTable.id] }),
}));

export const chatChannelMessagesRelations = relations(chatChannelMessagesTable, ({ one }) => ({
  channel: one(chatChannelsTable, {
    fields: [chatChannelMessagesTable.channelId],
    references: [chatChannelsTable.id],
  }),
  firm: one(firmsTable, { fields: [chatChannelMessagesTable.firmId], references: [firmsTable.id] }),
  sender: one(usersTable, { fields: [chatChannelMessagesTable.senderId], references: [usersTable.id] }),
}));

export const chatDirectMessagesRelations = relations(chatDirectMessagesTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [chatDirectMessagesTable.firmId], references: [firmsTable.id] }),
  sender: one(usersTable, {
    fields: [chatDirectMessagesTable.senderId],
    references: [usersTable.id],
    relationName: "sentDirectMessages",
  }),
  recipient: one(usersTable, {
    fields: [chatDirectMessagesTable.recipientId],
    references: [usersTable.id],
    relationName: "receivedDirectMessages",
  }),
}));

// Module M20-Settings (Payroll Tax & Social Contribution Settings).
export const payrollSettingsRelations = relations(payrollSettingsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [payrollSettingsTable.firmId], references: [firmsTable.id] }),
  updatedBy: one(usersTable, {
    fields: [payrollSettingsTable.updatedById],
    references: [usersTable.id],
  }),
}));

// Module M21-Settings (VAT Rate & SYSCOHADA Account Configuration).
export const vatSettingsRelations = relations(vatSettingsTable, ({ one }) => ({
  firm: one(firmsTable, { fields: [vatSettingsTable.firmId], references: [firmsTable.id] }),
  updatedBy: one(usersTable, {
    fields: [vatSettingsTable.updatedById],
    references: [usersTable.id],
  }),
}));

// Multi-station (P8): stations belong to a client; many pumps / staff per station.
export const stationsRelations = relations(stationsTable, ({ one, many }) => ({
  client: one(clientsTable, { fields: [stationsTable.clientId], references: [clientsTable.id] }),
  pumps: many(pumpsTable),
  staff: many(usersTable),
  shifts: many(pumpShiftsTable),
}));

// Module P7 (Calibration initiale): pump registration with initial index.
export const pumpsRelations = relations(pumpsTable, ({ one, many }) => ({
  client: one(clientsTable, { fields: [pumpsTable.clientId], references: [clientsTable.id] }),
  station: one(stationsTable, { fields: [pumpsTable.stationId], references: [stationsTable.id] }),
  assignments: many(pumpAssignmentsTable),
}));

// Module P7 (Attributions de pompes): links a pompiste to a pump for one day.
export const pumpAssignmentsRelations = relations(pumpAssignmentsTable, ({ one }) => ({
  client: one(clientsTable, { fields: [pumpAssignmentsTable.clientId], references: [clientsTable.id] }),
  pump: one(pumpsTable, { fields: [pumpAssignmentsTable.pumpId], references: [pumpsTable.id] }),
  staffUser: one(usersTable, { fields: [pumpAssignmentsTable.staffUserId], references: [usersTable.id] }),
}));

// Module P7 (Sécurisation du prix carburant): active per-litre selling
// price per client + fuel type, managed exclusively by the PME owner.
export const fuelPricesRelations = relations(fuelPricesTable, ({ one }) => ({
  client: one(clientsTable, { fields: [fuelPricesTable.clientId], references: [clientsTable.id] }),
  updatedBy: one(usersTable, {
    fields: [fuelPricesTable.updatedById],
    references: [usersTable.id],
  }),
}));

// Module P7 (Un Pompiste = Un Shift — Relevé d'Index & Ventes de Carburant).
export const pumpShiftsRelations = relations(pumpShiftsTable, ({ one }) => ({
  client: one(clientsTable, { fields: [pumpShiftsTable.clientId], references: [clientsTable.id] }),
  station: one(stationsTable, { fields: [pumpShiftsTable.stationId], references: [stationsTable.id] }),
  cashRegister: one(cashRegistersTable, {
    fields: [pumpShiftsTable.cashRegisterId],
    references: [cashRegistersTable.id],
  }),
  openedBy: one(usersTable, { fields: [pumpShiftsTable.openedById], references: [usersTable.id] }),
  validatedBy: one(usersTable, {
    fields: [pumpShiftsTable.validatedById],
    references: [usersTable.id],
  }),
  transaction: one(transactionsTable, {
    fields: [pumpShiftsTable.transactionId],
    references: [transactionsTable.id],
    relationName: "pumpShiftSale",
  }),
  discrepancyTransaction: one(transactionsTable, {
    fields: [pumpShiftsTable.discrepancyTransactionId],
    references: [transactionsTable.id],
    relationName: "pumpShiftDiscrepancy",
  }),
}));
