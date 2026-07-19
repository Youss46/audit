import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { db, auditLogsTable } from "@workspace/db";
import { runWithAuditContext, getAuditContext } from "../lib/audit-context";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Module M14 (Immutable Audit Trail & Activity Logging): safety-net
// interceptor for the three critical modules named in the spec
// (Transactions, Documents, Users). Every route in those modules already
// writes its own precisely-labeled AuditLogService entry (e.g.
// TRANSACTION_APPROVE, DOCUMENT_UPLOAD, USER_DELETE) -- this middleware
// does not duplicate those. Its job is to catch the case a developer
// forgets to: if a mutating request against a critical path completes
// successfully and no AuditLogService.record() call fired during it, this
// writes a generic fallback entry instead of letting the action go
// completely unlogged. This is the automatic, request-level guarantee the
// spec asks for; the granular calls remain the primary, richer signal.
export function auditInterceptor(entityType: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    const requestId = (req as { id?: string }).id ?? randomUUID();

    runWithAuditContext({ requestId, ipAddress: req.ip ?? null }, () => {
      res.on("finish", () => {
        void handleFinish(req, res, entityType);
      });
      next();
    });
  };
}

async function handleFinish(req: Request, res: Response, entityType: string) {
  if (!MUTATING_METHODS.has(req.method)) return;
  if (res.statusCode >= 400) return;

  const ctx = getAuditContext();
  if (ctx?.recorded) return; // A specific, richer entry already covered this request.

  const user = req.user;
  if (!user) return; // Unauthenticated mutations (e.g. failed login) have nothing to attribute.

  await db.insert(auditLogsTable).values({
    firmId: user.firmId,
    userId: user.id,
    userName: user.fullName,
    userRole: user.role,
    action: `${req.method}_${entityType.toUpperCase()}_UNLABELED`,
    entityType,
    entityId: typeof req.params?.id === "string" ? req.params.id : null,
    details: `Requête ${req.method} ${req.path} non couverte par un journal détaillé.`,
    ipAddress: req.ip ?? null,
    requestId: ctx?.requestId ?? null,
  });
}
