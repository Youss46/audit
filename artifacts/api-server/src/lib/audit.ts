import { db, auditLogsTable } from "@workspace/db";

// Standardized action-type identifiers for the audit trail (module M9),
// used for SYSCOHADA/ISA compliance review. Keep these upper-snake-case and
// English so the log is unambiguous regardless of the UI's display locale.
export const AuditAction = {
  AUTH_REGISTER: "AUTH_REGISTER",
  AUTH_LOGIN: "AUTH_LOGIN",
  CLIENT_CREATE: "CLIENT_CREATE",
  CLIENT_UPDATE: "CLIENT_UPDATE",
  CLIENT_DELETE: "CLIENT_DELETE",
  MISSION_CREATE: "MISSION_CREATE",
  MISSION_UPDATE: "MISSION_UPDATE",
  CHECKLIST_VALIDATE: "CHECKLIST_VALIDATE",
  CHECKLIST_NOTE: "CHECKLIST_NOTE",
  VISA_ISSUED: "VISA_ISSUED",
  DOCUMENT_UPLOAD: "DOCUMENT_UPLOAD",
  DOCUMENT_DELETE: "DOCUMENT_DELETE",
  USER_CREATE: "USER_CREATE",
  USER_UPDATE: "USER_UPDATE",
  USER_DELETE: "USER_DELETE",
  TRANSACTION_CREATE: "TRANSACTION_CREATE",
  TRANSACTION_APPROVE: "TRANSACTION_APPROVE",
  TRANSACTION_REJECT: "TRANSACTION_REJECT",
  TRANSACTION_SETTLE: "TRANSACTION_SETTLE",
  TRANSACTION_JOURNAL_LINES_UPDATE: "TRANSACTION_JOURNAL_LINES_UPDATE",
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

export interface LogAuditInput {
  firmId: number;
  userId?: number | null;
  userName?: string | null;
  userRole?: string | null;
  action: AuditActionType;
  entityType: string;
  entityId?: string | number | null;
  details?: string | null;
  ipAddress?: string | null;
}

// Writes one audit trail entry (module M9). Called from every mutating route
// (and on login) so the firm's activity log stays complete for legal /
// compliance review. `userRole` and `ipAddress` are captured at the time of
// the action, since a user's role can change later.
export async function logAudit(input: LogAuditInput): Promise<void> {
  await db.insert(auditLogsTable).values({
    firmId: input.firmId,
    userId: input.userId ?? null,
    userName: input.userName ?? null,
    userRole: input.userRole ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId != null ? String(input.entityId) : null,
    details: input.details ?? null,
    ipAddress: input.ipAddress ?? null,
  });
}
