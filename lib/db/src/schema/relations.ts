import { relations } from "drizzle-orm";
import { firmsTable } from "./firms";
import { usersTable } from "./users";
import { clientsTable } from "./clients";
import { missionsTable } from "./missions";
import { checklistItemsTable } from "./checklist-items";
import { documentsTable } from "./documents";
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
}));

export const journalLinesRelations = relations(journalLinesTable, ({ one }) => ({
  transaction: one(transactionsTable, {
    fields: [journalLinesTable.transactionId],
    references: [transactionsTable.id],
  }),
}));

// Module P5 (Caisse Terrain).
export const cashRegistersRelations = relations(cashRegistersTable, ({ one, many }) => ({
  client: one(clientsTable, {
    fields: [cashRegistersTable.clientId],
    references: [clientsTable.id],
  }),
  closures: many(dailyClosuresTable),
  transactions: many(transactionsTable),
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
