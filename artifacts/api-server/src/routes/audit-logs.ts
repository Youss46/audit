import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, auditLogsTable, firmsTable } from "@workspace/db";
import { ListAuditLogsQueryParams, ListAuditLogsResponse } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction } from "../lib/audit";
import { generateAuditLogPdf } from "../lib/export-engine";

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
    limit: 1000,
  });

  res.json(ListAuditLogsResponse.parse(logs));
});

// ---------------------------------------------------------------------------
// GET /audit-logs/export-pdf — PDF du registre de conformité (binaire)
// Mêmes filtres que GET /audit-logs ; retourne application/pdf.
// ---------------------------------------------------------------------------
router.get("/audit-logs/export-pdf", requireRole("expert_comptable"), async (req, res) => {
  const { userRole, aiOverrideOnly } = ListAuditLogsQueryParams.parse(req.query);

  const conditions = [eq(auditLogsTable.firmId, req.user!.firmId)];
  if (userRole) conditions.push(eq(auditLogsTable.userRole, userRole));
  if (aiOverrideOnly) conditions.push(eq(auditLogsTable.action, AuditAction.AI_OVERRIDE));

  const [logs, firm] = await Promise.all([
    db.query.auditLogsTable.findMany({
      where: and(...conditions),
      orderBy: desc(auditLogsTable.createdAt),
      limit: 5000,
    }),
    db.query.firmsTable.findFirst({
      where: eq(firmsTable.id, req.user!.firmId),
      columns: { name: true },
    }),
  ]);

  const pdfBuffer = await generateAuditLogPdf({
    firmName: firm?.name ?? "Cabinet",
    generatedAt: new Date(),
    filters: { userRole: userRole ?? undefined, aiOverrideOnly: aiOverrideOnly ?? undefined },
    rows: logs.map((l) => ({
      createdAt: l.createdAt,
      userName: l.userName ?? null,
      userRole: l.userRole ?? null,
      action: l.action,
      details: l.details ?? null,
      entityType: l.entityType,
      entityId: l.entityId ?? null,
      ipAddress: l.ipAddress ?? null,
    })),
  });

  const date = new Date().toISOString().slice(0, 10);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="journal-conformite-${date}.pdf"`,
    "Content-Length": String(pdfBuffer.length),
    "Cache-Control": "no-store",
  });
  res.end(pdfBuffer);
});

export default router;
