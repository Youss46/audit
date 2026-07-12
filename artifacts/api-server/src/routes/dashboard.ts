import { Router, type IRouter } from "express";
import { count, eq } from "drizzle-orm";
import { db, clientsTable, missionsTable } from "@workspace/db";
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

  const summary = {
    totalClients: totalClients[0]?.count ?? 0,
    totalMissions: totalMissions[0]?.count ?? 0,
    enAttente: missions.filter((m) => m.status === "en_attente").length,
    enCours: missions.filter((m) => m.status === "en_cours").length,
    anomalie: missions.filter((m) => m.status === "anomalie").length,
    valide: missions.filter((m) => m.status === "valide").length,
    visaEmis: missions.filter((m) => m.status === "visa_emis").length,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

export default router;
