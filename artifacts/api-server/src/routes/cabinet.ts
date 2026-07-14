import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  GetCabinetPendingCountsParams,
  GetCabinetPendingCountsResponse,
  GetFirmPendingCountsResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { computePendingCounts, computeFirmPendingCounts } from "../lib/pending-counts";

// Module M32 (Notification Instantanée & Compteurs Dynamiques): read-side
// endpoints for the "à valider" review-queue counters. Cabinet staff only --
// an Espace PME account has no navigation that needs these badges, and the
// counts themselves are meaningless to it (it only ever sees its own
// dossier, and already has its own submission history).
const router: IRouter = Router();

router.use(requireAuth);
router.use(requireRole("expert_comptable", "collaborateur", "stagiaire"));

router.get("/cabinet/pending-counts/:clientId", async (req, res) => {
  const { clientId } = GetCabinetPendingCountsParams.parse(req.params);

  const client = await db.query.clientsTable.findFirst({
    where: (t, { and, eq }) => and(eq(t.id, clientId), eq(t.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const counts = await computePendingCounts(req.user!.firmId, clientId);
  res.json(GetCabinetPendingCountsResponse.parse(counts));
});

router.get("/cabinet/pending-counts", async (req, res) => {
  const counts = await computeFirmPendingCounts(req.user!.firmId);
  res.json(GetFirmPendingCountsResponse.parse(counts));
});

export default router;
