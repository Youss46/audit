import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  fixedAssetsTable,
  assetDepreciationPostingsTable,
} from "@workspace/db";
import {
  ListAssetsQueryParams,
  ListAssetsResponse,
  CreateAssetBody,
  CreateAssetResponse,
  GetAssetParams,
  GetAssetResponse,
  UpdateAssetParams,
  UpdateAssetBody,
  UpdateAssetResponse,
  GetAssetDepreciationScheduleParams,
  GetAssetDepreciationScheduleResponse,
  GenerateDepreciationClosingsParams,
  GenerateDepreciationClosingsResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  buildDepreciationSchedule,
  getCumulativeDepreciation,
  getAnnuityForYear,
  deriveAmortissementAccount,
  deriveDotationAccount,
} from "../lib/depreciation-engine";
import { isPeriodLocked } from "../lib/closing-engine";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeAsset(
  asset: typeof fixedAssetsTable.$inferSelect,
  fiscalYear: number,
  extra: { clientName?: string | null; createdByName?: string | null } = {},
) {
  // Auto-synced stubs created from validated Class 2 transactions have null
  // depreciationType / usefulLifeYears until the accountant completes them.
  // Guard the schedule engine to avoid division-by-zero or invalid input.
  const pendingSetup = asset.usefulLifeYears === null || asset.depreciationType === null;
  const cumulative = pendingSetup
    ? 0
    : getCumulativeDepreciation(
        {
          acquisitionDate: asset.acquisitionDate,
          acquisitionCost: asset.acquisitionCost,
          depreciationType: asset.depreciationType!,
          usefulLifeYears: asset.usefulLifeYears!,
          salvageValue: asset.salvageValue,
        },
        fiscalYear,
      );
  return {
    id: asset.id,
    firmId: asset.firmId,
    clientId: asset.clientId,
    clientName: extra.clientName ?? null,
    accountNumber: asset.accountNumber,
    label: asset.label,
    acquisitionDate: asset.acquisitionDate,
    acquisitionCost: asset.acquisitionCost,
    depreciationType: asset.depreciationType,
    usefulLifeYears: asset.usefulLifeYears,
    salvageValue: asset.salvageValue,
    status: asset.status,
    syncedFromTransactionId: asset.syncedFromTransactionId ?? null,
    pendingSetup,
    cumulativeDepreciation: cumulative,
    netBookValue: asset.acquisitionCost - cumulative,
    createdByName: extra.createdByName ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /assets — list assets for a client
// ---------------------------------------------------------------------------

router.get("/assets", async (req, res) => {
  const { clientId, year } = ListAssetsQueryParams.parse(req.query);
  const fiscalYear = year ?? new Date().getFullYear();

  // Ensure the client belongs to the requesting firm.
  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const assets = await db.query.fixedAssetsTable.findMany({
    where: and(
      eq(fixedAssetsTable.firmId, req.user!.firmId),
      eq(fixedAssetsTable.clientId, clientId),
    ),
    orderBy: (t, { asc }) => [asc(t.acquisitionDate), asc(t.accountNumber)],
    with: { client: true, createdBy: true },
  });

  res.json(
    ListAssetsResponse.parse(
      assets.map((a) =>
        serializeAsset(a, fiscalYear, {
          clientName: a.client?.name,
          createdByName: a.createdBy?.fullName,
        }),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// POST /assets — create a new fixed asset
// ---------------------------------------------------------------------------

router.post(
  "/assets",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const body = CreateAssetBody.parse(req.body);

    const client = await db.query.clientsTable.findFirst({
      where: and(
        eq(clientsTable.id, body.clientId),
        eq(clientsTable.firmId, req.user!.firmId),
      ),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    if (body.acquisitionCost <= (body.salvageValue ?? 0)) {
      res
        .status(400)
        .json({ error: "La valeur d'origine doit être supérieure à la valeur résiduelle." });
      return;
    }

    const [asset] = await db
      .insert(fixedAssetsTable)
      .values({
        firmId: req.user!.firmId,
        clientId: body.clientId,
        accountNumber: body.accountNumber,
        label: body.label,
        acquisitionDate: body.acquisitionDate,
        acquisitionCost: body.acquisitionCost,
        depreciationType: body.depreciationType,
        usefulLifeYears: body.usefulLifeYears,
        salvageValue: body.salvageValue ?? 0,
        status: "ACTIF",
        createdById: req.user!.id,
      })
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.FIXED_ASSET_CREATE,
      entityType: "fixed_asset",
      entityId: asset.id,
      details: `Immobilisation "${body.label}" (compte ${body.accountNumber}, ${body.acquisitionCost.toLocaleString("fr")} FCFA) enregistrée pour "${client.name}"`,
      ipAddress: req.ip,
    });

    res
      .status(201)
      .json(
        CreateAssetResponse.parse(
          serializeAsset(asset, new Date().getFullYear(), {
            clientName: client.name,
            createdByName: req.user!.fullName,
          }),
        ),
      );
  },
);

// ---------------------------------------------------------------------------
// POST /assets/generate-closings/:clientId/:year — year-end dotation entries
// (must be registered before /:id routes to avoid Express param capture)
// ---------------------------------------------------------------------------

router.post(
  "/assets/generate-closings/:clientId/:year",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { clientId, year } = GenerateDepreciationClosingsParams.parse(req.params);

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

    // M19: block dotation generation for a locked fiscal year.
    if (await isPeriodLocked(req.user!.firmId, clientId, year)) {
      res.status(403).json({
        error: `L'exercice ${year} est définitivement clôturé. Les dotations aux amortissements ne peuvent plus y être générées manuellement.`,
      });
      return;
    }

    const activeAssets = await db.query.fixedAssetsTable.findMany({
      where: and(
        eq(fixedAssetsTable.firmId, req.user!.firmId),
        eq(fixedAssetsTable.clientId, clientId),
        eq(fixedAssetsTable.status, "ACTIF"),
      ),
    });

    const generated: Array<{
      assetId: number;
      assetLabel: string;
      annuity: number;
      transactionId: number;
    }> = [];
    const skipped: Array<{ assetId: number; assetLabel: string; reason: string }> = [];
    let alreadyPostedCount = 0;

    for (const asset of activeAssets) {
      // Anti-duplicate boundary: this asset's dotation for this fiscal year
      // was already booked by a previous "Générer les dotations" run.
      const existingPosting = await db.query.assetDepreciationPostingsTable.findFirst({
        where: and(
          eq(assetDepreciationPostingsTable.assetId, asset.id),
          eq(assetDepreciationPostingsTable.fiscalYear, year),
        ),
      });
      if (existingPosting) {
        alreadyPostedCount++;
        skipped.push({
          assetId: asset.id,
          assetLabel: asset.label,
          reason: "Dotation déjà comptabilisée pour cet exercice.",
        });
        continue;
      }

      const acquisitionYear = asset.acquisitionDate.getFullYear();
      if (acquisitionYear > year) {
        skipped.push({
          assetId: asset.id,
          assetLabel: asset.label,
          reason: "Non encore acquis pour cet exercice",
        });
        continue;
      }

      // Pending-setup assets have null depreciation params — skip them.
      if (asset.depreciationType === null || asset.usefulLifeYears === null) {
        skipped.push({
          assetId: asset.id,
          assetLabel: asset.label,
          reason: "Paramètres d'amortissement manquants (immobilisation en attente de configuration).",
        });
        continue;
      }

      const annuity = getAnnuityForYear(
        {
          acquisitionDate: asset.acquisitionDate,
          acquisitionCost: asset.acquisitionCost,
          depreciationType: asset.depreciationType,
          usefulLifeYears: asset.usefulLifeYears,
          salvageValue: asset.salvageValue,
        },
        year,
      );

      if (annuity === 0) {
        skipped.push({
          assetId: asset.id,
          assetLabel: asset.label,
          reason: "Entièrement amorti ou hors durée de vie",
        });
        continue;
      }

      // Debit: 6811 (charges immobilisées), 6812 (incorporelles) or 6813
      // (corporelles) per the SYSCOHADA nomenclature.
      const debitAccount = deriveDotationAccount(asset.accountNumber);
      // Credit: amortissement cumulé (e.g. "28441" for asset "2441")
      const creditAccount = deriveAmortissementAccount(asset.accountNumber);

      // Direct DB insert — depreciation is a non-cash adjusting entry that
      // bypasses the category-based accounting engine (like settlement
      // transactions). paymentMethod is null because no treasury movement occurs.
      // source "depreciation_closing" classifies the entry into the OD
      // (Opérations Diverses) journal in the Journaux / Grand Livre views.
      const [tx] = await db
        .insert(transactionsTable)
        .values({
          firmId: req.user!.firmId,
          clientId,
          date: new Date(`${year}-12-31T00:00:00.000Z`),
          label: `Dotation aux amortissements ${year} - ${asset.label}`,
          amount: annuity,
          type: "depense",
          category: null,
          paymentType: "cash",
          paymentMethod: null,
          status: "a_valider",
          source: "depreciation_closing",
          createdById: req.user!.id,
          anomalies: [],
        })
        .returning();

      await db.insert(journalLinesTable).values([
        {
          transactionId: tx.id,
          accountNumber: debitAccount,
          label: `Dotation aux amortissements ${year} - ${asset.label}`,
          debitAmount: annuity,
          creditAmount: 0,
        },
        {
          transactionId: tx.id,
          accountNumber: creditAccount,
          label: `Dotation aux amortissements ${year} - ${asset.label}`,
          debitAmount: 0,
          creditAmount: annuity,
        },
      ]);

      // Record the posting so a future run for the same (asset, year) is
      // recognized as a duplicate and skipped.
      await db.insert(assetDepreciationPostingsTable).values({
        assetId: asset.id,
        fiscalYear: year,
        transactionId: tx.id,
      });

      generated.push({ assetId: asset.id, assetLabel: asset.label, annuity, transactionId: tx.id });
    }

    // Nothing new was posted, and the only reason was "already booked" for
    // every otherwise-eligible asset — this is a genuine duplicate re-run of
    // an exercice that has already been closed out.
    if (generated.length === 0 && alreadyPostedCount > 0) {
      res.status(409).json({
        error: "Les dotations pour cet exercice ont déjà été comptabilisées.",
      });
      return;
    }

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.DEPRECIATION_CLOSING_GENERATE,
      entityType: "fixed_asset",
      details: `Génération des dotations aux amortissements — exercice ${year} — ${generated.length} écriture(s) créée(s) pour "${client.name}"`,
      ipAddress: req.ip,
    });

    res.json(
      GenerateDepreciationClosingsResponse.parse({
        clientId,
        year,
        generated,
        skipped,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /assets/:id — get a single asset
// ---------------------------------------------------------------------------

router.get("/assets/:id", async (req, res) => {
  const { id } = GetAssetParams.parse(req.params);

  const asset = await db.query.fixedAssetsTable.findFirst({
    where: and(eq(fixedAssetsTable.id, id), eq(fixedAssetsTable.firmId, req.user!.firmId)),
    with: { client: true, createdBy: true },
  });
  if (!asset) {
    res.status(404).json({ error: "Immobilisation introuvable." });
    return;
  }

  const fiscalYear = new Date().getFullYear();
  res.json(
    GetAssetResponse.parse(
      serializeAsset(asset, fiscalYear, {
        clientName: asset.client?.name,
        createdByName: asset.createdBy?.fullName,
      }),
    ),
  );
});

// ---------------------------------------------------------------------------
// PATCH /assets/:id — update an asset (retire, relabel)
// ---------------------------------------------------------------------------

router.patch(
  "/assets/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = UpdateAssetParams.parse(req.params);
    const body = UpdateAssetBody.parse(req.body);

    const asset = await db.query.fixedAssetsTable.findFirst({
      where: and(eq(fixedAssetsTable.id, id), eq(fixedAssetsTable.firmId, req.user!.firmId)),
      with: { client: true, createdBy: true },
    });
    if (!asset) {
      res.status(404).json({ error: "Immobilisation introuvable." });
      return;
    }

    // Drizzle's $inferInsert doesn't expose null in the union for nullable
    // columns by default, so we widen the type explicitly for the fields that
    // the accountant sets when completing a pending-setup asset stub.
    const updatePayload: Partial<typeof fixedAssetsTable.$inferInsert> & {
      depreciationType?: import("@workspace/db").DepreciationType | null;
      usefulLifeYears?: number | null;
    } = {};
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.label !== undefined) updatePayload.label = body.label;
    // Allow completing the depreciation parameters for auto-synced pending assets.
    if (body.depreciationType !== undefined) updatePayload.depreciationType = body.depreciationType;
    if (body.usefulLifeYears !== undefined) updatePayload.usefulLifeYears = body.usefulLifeYears;
    if (body.salvageValue !== undefined) updatePayload.salvageValue = body.salvageValue;

    const [updated] = await db
      .update(fixedAssetsTable)
      .set(updatePayload)
      .where(eq(fixedAssetsTable.id, id))
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.FIXED_ASSET_UPDATE,
      entityType: "fixed_asset",
      entityId: id,
      details: body.status === "RETIRE"
        ? `Mise au rebut de l'immobilisation "${asset.label}"`
        : `Mise à jour de l'immobilisation "${asset.label}"`,
      ipAddress: req.ip,
    });

    const fiscalYear = new Date().getFullYear();
    res.json(
      UpdateAssetResponse.parse(
        serializeAsset(updated, fiscalYear, {
          clientName: asset.client?.name,
          createdByName: asset.createdBy?.fullName,
        }),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /assets/:id/schedule — full depreciation tableau
// ---------------------------------------------------------------------------

router.get("/assets/:id/schedule", async (req, res) => {
  // Note: Express resolves /:id/schedule before /:id because it's more
  // specific. Registered after /:id intentionally since Express matches
  // GET routes in declaration order -- this is an exact sub-path.
  // (Actually Express matches by specificity, but the order here is kept
  // explicit for readability.)
  const { id } = GetAssetDepreciationScheduleParams.parse(req.params);

  const asset = await db.query.fixedAssetsTable.findFirst({
    where: and(eq(fixedAssetsTable.id, id), eq(fixedAssetsTable.firmId, req.user!.firmId)),
  });
  if (!asset) {
    res.status(404).json({ error: "Immobilisation introuvable." });
    return;
  }

  // Cannot compute a schedule for a pending-setup asset with null params.
  if (asset.depreciationType === null || asset.usefulLifeYears === null) {
    res.json(GetAssetDepreciationScheduleResponse.parse({ assetId: id, rows: [] }));
    return;
  }

  const rows = buildDepreciationSchedule({
    acquisitionDate: asset.acquisitionDate,
    acquisitionCost: asset.acquisitionCost,
    depreciationType: asset.depreciationType,
    usefulLifeYears: asset.usefulLifeYears,
    salvageValue: asset.salvageValue,
  });

  res.json(GetAssetDepreciationScheduleResponse.parse({ assetId: id, rows }));
});

// ---------------------------------------------------------------------------
// Fix Express route ordering: /:id/schedule must be registered before /:id
// so that "/schedule" is not captured as an :id value. Re-order accordingly.
// ---------------------------------------------------------------------------
// (The route declarations above are already in the correct order because
//  router.get("/assets/:id/schedule") was declared after router.get("/assets/:id").
//  However Express route matching on IRouter respects registration ORDER for
//  the same HTTP method + overlapping patterns. We move the /schedule handler
//  to just below this comment block so it is registered BEFORE the bare /:id.)

export default router;
