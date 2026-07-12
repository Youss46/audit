import { db, auditLogsTable } from "@workspace/db";

export interface LogAuditInput {
  firmId: number;
  userId?: number | null;
  userName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  details?: string | null;
}

// Writes one audit trail entry (module M9). Called from every mutating route
// so the firm's activity log stays complete.
export async function logAudit(input: LogAuditInput): Promise<void> {
  await db.insert(auditLogsTable).values({
    firmId: input.firmId,
    userId: input.userId ?? null,
    userName: input.userName ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId != null ? String(input.entityId) : null,
    details: input.details ?? null,
  });
}
