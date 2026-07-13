import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientsTable, fiscalYearClosingsTable } from "@workspace/db";
import {
  GetClosingStatusParams,
  GetClosingStatusResponse,
  ClosePeriodParams,
  ClosePeriodResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { closeFiscalYear, isPeriodLocked, PeriodLockedError } from "../lib/closing-engine";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /ledger/closing-status/:clientId/:year
// Returns the current closing state for a given client/year: whether the
// period is OPEN or LOCKED, its locked-at timestamp, and a balance summary
// (total debits vs credits from the validated general ledger).
// ---------------------------------------------------------------------------

router.get("/ledger/closing-status/:clientId/:year", async (req, res) => {
  const { clientId, year } = GetClosingStatusParams.parse(req.params);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const closing = await db.query.fiscalYearClosingsTable.findFirst({
    where: and(
      eq(fiscalYearClosingsTable.firmId, req.user!.firmId),
      eq(fiscalYearClosingsTable.clientId, clientId),
      eq(fiscalYearClosingsTable.year, year),
    ),
    with: { lockedBy: true },
  });

  res.json(
    GetClosingStatusResponse.parse({
      clientId,
      year,
      status: closing?.status ?? "OPEN",
      netResult: closing?.netResult ?? null,
      netResultAccount: closing?.netResultAccount ?? null,
      openingBalanceGenerated: closing?.openingBalanceGenerated ?? false,
      lockedAt: closing?.lockedAt?.toISOString() ?? null,
      lockedByName: closing?.lockedBy?.fullName ?? null,
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /ledger/close-period/:clientId/:year
// Triggers the official multi-step year-end closing routine (M19):
//   1. Run & validate pending depreciation + financial interest adjustments.
//   2. Compute net result (Class 6 vs 7), post clearing entry to 131/139.
//   3. Lock the period — all future ledger entries for this year are blocked.
//   4. Generate À-nouveaux: opening balances for Classes 1-5 in year+1.
// Restricted to expert_comptable only (the only role empowered to issue the
// final stamp/lock in the SYSCOHADA workflow hierarchy).
// ---------------------------------------------------------------------------

router.post(
  "/ledger/close-period/:clientId/:year",
  requireRole("expert_comptable"),
  async (req, res) => {
    const { clientId, year } = ClosePeriodParams.parse(req.params);

    if (year < 1900 || year > 2100) {
      res.status(400).json({ error: "Exercice invalide." });
      return;
    }

    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    try {
      const result = await closeFiscalYear(
        req.user!.firmId,
        clientId,
        year,
        req.user!.id,
      );

      await logAudit({
        firmId: req.user!.firmId,
        userId: req.user!.id,
        userName: req.user!.fullName,
        userRole: req.user!.role,
        action: AuditAction.PERIOD_CLOSE,
        entityType: "fiscal_year_closing",
        entityId: `${clientId}/${year}`,
        details: [
          `Clôture définitive de l'exercice ${year} pour "${client.name}".`,
          `Résultat net : ${result.step2.netResult.toLocaleString("fr")} FCFA (compte ${result.step2.resultAccount}).`,
          `Dotations : ${result.step1.depreciationEntriesGenerated} écriture(s). Échéances : ${result.step1.financeEntriesGenerated} écriture(s).`,
          `À-nouveaux : ${result.step4.accountsCarriedForward} compte(s) reporté(s) sur ${year + 1}.`,
        ].join(" "),
        ipAddress: req.ip,
      });

      res.json(ClosePeriodResponse.parse(result));
    } catch (err) {
      if (err instanceof PeriodLockedError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
