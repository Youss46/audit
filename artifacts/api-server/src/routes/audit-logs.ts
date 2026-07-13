import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { ListAuditLogsQueryParams, ListAuditLogsResponse } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction } from "../lib/audit";

const router: IRouter = Router();

router.use(requireAuth);

// Module M14 (Espace Cabinet - Visual Compliance Log): the audit trail is
// read here only, never mutated -- see lib/audit.ts for why there is no
// PATCH/DELETE route for this resource at all, and the DB-level trigger
// that backs that up. Restricted to expert_comptable ("senior
// accountant"/firm owner in this codebase's RBAC model -- there is no
// separate collaborateur/stagiaire access to the compliance log).
router.get("/audit-logs", requireRole("expert_comptable"), async (req, res) => {
  const { entityType, action, userRole, aiOverrideOnly } = ListAuditLogsQueryParams.parse(
    req.query,
  );

  const conditions = [eq(auditLogsTable.firmId, req.user!.firmId)];
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (action) conditions.push(eq(auditLogsTable.action, action));
  if (userRole) conditions.push(eq(auditLogsTable.userRole, userRole));
  if (aiOverrideOnly) conditions.push(eq(auditLogsTable.action, AuditAction.AI_OVERRIDE));

  const logs = await db.query.auditLogsTable.findMany({
    where: and(...conditions),
    orderBy: desc(auditLogsTable.createdAt),
    limit: 200,
  });

  res.json(ListAuditLogsResponse.parse(logs));
});

export default router;
