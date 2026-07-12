import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { ListAuditLogsQueryParams, ListAuditLogsResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/audit-logs", async (req, res) => {
  const { entityType } = ListAuditLogsQueryParams.parse(req.query);

  const logs = await db.query.auditLogsTable.findMany({
    where: entityType
      ? and(
          eq(auditLogsTable.firmId, req.user!.firmId),
          eq(auditLogsTable.entityType, entityType),
        )
      : eq(auditLogsTable.firmId, req.user!.firmId),
    orderBy: desc(auditLogsTable.createdAt),
    limit: 200,
  });

  res.json(ListAuditLogsResponse.parse(logs));
});

export default router;
