import { db, auditLogsTable } from "@workspace/db";
import { markAuditRecorded, getAuditContext } from "./audit-context";

// Standardized action-type identifiers for the audit trail (modules
// M9/M14), used for SYSCOHADA/ISA compliance review. Keep these
// upper-snake-case and English so the log is unambiguous regardless of the
// UI's display locale.
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
  CASH_REGISTER_CREATE: "CASH_REGISTER_CREATE",
  DAILY_CLOSURE_CLOSE: "DAILY_CLOSURE_CLOSE",
  CASH_ENTRIES_SYNC: "CASH_ENTRIES_SYNC",
  LIASSE_FISCALE_EXPORT: "LIASSE_FISCALE_EXPORT",
  TRANSACTION_FORCE_VALIDATE: "TRANSACTION_FORCE_VALIDATE",
  // Module M14: an accountant manually overwrote a value that had been
  // pre-filled by the AI extraction pipeline (module M13/OCR "Scan & Go").
  // Not yet emitted anywhere -- that AI pipeline was descoped pending the
  // Anthropic API key -- but the action type, schema support
  // (changesPayload), and compliance-UI highlighting are wired up now so
  // wiring in the emitter later is a one-line change at the override site.
  AI_OVERRIDE: "AI_OVERRIDE",
  // Module M17 (Gestion des Immobilisations & Amortissements).
  FIXED_ASSET_CREATE: "FIXED_ASSET_CREATE",
  FIXED_ASSET_UPDATE: "FIXED_ASSET_UPDATE",
  DEPRECIATION_CLOSING_GENERATE: "DEPRECIATION_CLOSING_GENERATE",
  // Module M18 (Immobilisations Financières & Emprunts).
  FINANCIAL_ITEM_CREATE: "FINANCIAL_ITEM_CREATE",
  FINANCIAL_ITEM_UPDATE: "FINANCIAL_ITEM_UPDATE",
  FINANCIAL_ENTRY_GENERATE: "FINANCIAL_ENTRY_GENERATE",
  // Module M19 (Clôture d'Exercice Comptable): official year-end closing.
  // The LOCKED status is permanent and cannot be reversed through the UI.
  PERIOD_CLOSE: "PERIOD_CLOSE",
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditChangesPayload {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

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
  changesPayload?: AuditChangesPayload | null;
}

/**
 * Module M14 (Immutable Audit Trail & Activity Logging).
 *
 * The ONLY supported operation on the audit trail is `record` (INSERT).
 * There is intentionally no `update`/`delete` method on this service --
 * the audit_logs table is legally required to be append-only, so the API
 * surface simply does not offer a way to mutate a past entry. As a second,
 * independent layer of defense (in case a future route or a direct SQL
 * client tries anyway), a Postgres trigger
 * (`audit_logs_prevent_mutation`, see
 * lib/db/src/enforce-audit-immutability.ts) rejects any UPDATE/DELETE
 * against this table at the database level. `assertAppendOnlyOperation`
 * below is what an admin-facing route must call before doing anything to
 * an audit log row other than reading it, so the rejection surfaces as a
 * clean 403 instead of a raw Postgres error.
 */
export const AuditLogService = {
  async record(input: LogAuditInput): Promise<void> {
    const ctx = getAuditContext();
    await db.insert(auditLogsTable).values({
      firmId: input.firmId,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      userRole: input.userRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId != null ? String(input.entityId) : null,
      details: input.details ?? null,
      ipAddress: input.ipAddress ?? ctx?.ipAddress ?? null,
      changesPayload: input.changesPayload ?? null,
      requestId: ctx?.requestId ?? null,
    });
    // Signals the safety-net interceptor that this request already
    // produced a granular log entry, so it should not also write a
    // generic fallback one.
    markAuditRecorded();
  },
};

/**
 * Class of error thrown by `assertAppendOnlyOperation`. Route error
 * handlers should map this to HTTP 403.
 */
export class AuditTrailImmutableError extends Error {
  readonly statusCode = 403;
  constructor(operation: "UPDATE" | "DELETE") {
    super(
      `Le journal d'audit est en lecture/ajout uniquement : l'opération ${operation} est interdite.`,
    );
    this.name = "AuditTrailImmutableError";
  }
}

/**
 * Call this at the top of any route that would UPDATE or DELETE an audit
 * log row. It always throws -- there is no legitimate case where that
 * should succeed -- turning the attempt into a strict, explicit 403
 * instead of relying solely on the underlying Postgres trigger to fail
 * the query.
 */
export function assertAppendOnlyOperation(operation: "UPDATE" | "DELETE"): never {
  throw new AuditTrailImmutableError(operation);
}

// Backward-compatible alias -- existing call sites across the codebase use
// `logAudit(...)`. Keep this thin wrapper so none of them need to change.
export const logAudit = AuditLogService.record;
