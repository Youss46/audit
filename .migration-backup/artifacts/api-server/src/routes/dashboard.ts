import { Router, type IRouter } from "express";
import { count, eq, inArray } from "drizzle-orm";
import { db, checklistItemsTable, clientsTable, missionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/dashboard/summary", async (req, res) => {
  const firmId = req.user!.firmId;

  const [totalClients, totalMissions, missions] = await Promise.all([
    db.select({ count: count() }).from(clientsTable).where(eq(clientsTable.firmId, firmId)),
    db.select({ count: count() }).from(missionsTable).where(eq(missionsTable.firmId, firmId)),
    db.query.missionsTable.findMany({ where: eq(missionsTable.firmId, firmId) }),
  ]);

  const missionIds = missions.map((m) => m.id);
  // "Alertes Anomalies" counts individual flagged checklist items across all
  // of the firm's missions -- a finer-grained signal than the mission-level
  // "anomalie" status, since a mission can carry several open anomalies.
  const anomalyItems =
    missionIds.length > 0
      ? await db.query.checklistItemsTable.findMany({
          where: inArray(checklistItemsTable.missionId, missionIds),
        })
      : [];

  const enCours = missions.filter((m) => m.status === "en_cours").length;
  const anomalie = missions.filter((m) => m.status === "anomalie").length;

  const summary = {
    totalClients: totalClients[0]?.count ?? 0,
    totalMissions: totalMissions[0]?.count ?? 0,
    missionsEnCours: enCours + anomalie,
    enAttente: missions.filter((m) => m.status === "en_attente").length,
    enCours,
    anomalie,
    valide: missions.filter((m) => m.status === "valide").length,
    visaEmis: missions.filter((m) => m.status === "visa_emis").length,
    anomalyAlerts: anomalyItems.filter((i) => i.status === "anomalie").length,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

export default router;
