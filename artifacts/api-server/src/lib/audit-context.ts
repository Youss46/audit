import { AsyncLocalStorage } from "node:async_hooks";

// Module M14 (Immutable Audit Trail & Activity Logging): per-request
// context so the safety-net interceptor (see middlewares/audit-interceptor.ts)
// can tell, once a request finishes, whether the route already wrote its
// own granular AuditLogService entry -- without threading a flag through
// every existing `logAudit(...)` call site. AuditLogService.record() calls
// `markRecorded()` on the active context as a side effect.
interface AuditRequestContext {
  requestId: string;
  ipAddress: string | null;
  recorded: boolean;
}

const storage = new AsyncLocalStorage<AuditRequestContext>();

export function runWithAuditContext<T>(
  context: { requestId: string; ipAddress: string | null },
  fn: () => T,
): T {
  return storage.run({ ...context, recorded: false }, fn);
}

export function markAuditRecorded(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.recorded = true;
}

export function getAuditContext(): AuditRequestContext | undefined {
  return storage.getStore();
}
