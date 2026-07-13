import { Router, type IRouter } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  vatDeclarationsTable,
} from "@workspace/db";
import {
  GetVatDeclarationParams,
  GetVatDeclarationResponse,
  GetVatAnnexParams,
  GetVatAnnexResponse,
  UpdateVatSupplierInfoParams,
  UpdateVatSupplierInfoBody,
  UpdateVatSupplierInfoResponse,
  PostVatLiquidationParams,
  PostVatLiquidationResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole, requireOwnClient } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { isPeriodLocked } from "../lib/closing-engine";
import {
  computeVatDeclaration,
  computeVatAnnex,
  buildVatLiquidationLines,
  VatPeriodAlreadyPostedError,
  NoVatActivityError,
  type VatTransactionGroup,
} from "../lib/vat-engine";

const router: IRouter = Router();

router.use(requireAuth);

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function periodBounds(period: string): { start: Date; endExclusive: Date; year: number } {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const start = new Date(Date.UTC(year, month - 1, 1));
  const endExclusive = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return { start, endExclusive, year };
}

/**
 * Fetches every validated transaction (with its journal lines) dated within
 * the given period, grouped per transaction -- the shape vat-engine.ts
 * consumes. Only "valide" entries are ever declared to the DGI.
 */
async function fetchVatTransactionGroups(
  clientId: number,
  firmId: number,
  period: string,
): Promise<VatTransactionGroup[]> {
  const { start, endExclusive } = periodBounds(period);

  const transactions = await db.query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.clientId, clientId),
      eq(transactionsTable.firmId, firmId),
      eq(transactionsTable.status, "valide"),
    ),
    with: { journalLines: true },
  });

  return transactions
    .filter((t) => t.date >= start && t.date < endExclusive)
    .map((t) => ({
      transactionId: t.id,
      date: t.date,
      label: t.label,
      category: t.category,
      supplierName: t.supplierName ?? null,
      supplierNcc: t.supplierNcc ?? null,
      invoiceNumber: t.invoiceNumber ?? null,
      lines: t.journalLines.map((l) => ({
        accountNumber: l.accountNumber,
        debitAmount: l.debitAmount,
        creditAmount: l.creditAmount,
      })),
    }));
}

/** The most recent posted declaration strictly before `period`, used to carry its crédit forward. */
async function fetchPriorCredit(firmId: number, clientId: number, period: string): Promise<number> {
  const prior = await db.query.vatDeclarationsTable.findFirst({
    where: and(
      eq(vatDeclarationsTable.firmId, firmId),
      eq(vatDeclarationsTable.clientId, clientId),
      lt(vatDeclarationsTable.period, period),
    ),
    orderBy: [desc(vatDeclarationsTable.period)],
  });
  return prior?.creditATNouveauReporter ?? 0;
}

async function findClient(req: Parameters<typeof requireOwnClient>[0], clientId: number) {
  return db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
}

// ---------------------------------------------------------------------------
// GET /tax/vat-declaration/:clientId/:period — Formulaire D-201/VA, Sections A/B/C
// ---------------------------------------------------------------------------

router.get("/tax/vat-declaration/:clientId/:period", async (req, res) => {
  const { clientId, period } = GetVatDeclarationParams.parse(req.params);
  if (!requireOwnClient(req, res, clientId)) return;

  if (!PERIOD_RE.test(period)) {
    res.status(400).json({ error: "Période invalide (format attendu : AAAA-MM)." });
    return;
  }

  const client = await findClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const groups = await fetchVatTransactionGroups(clientId, req.user!.firmId, period);
  const priorCredit = await fetchPriorCredit(req.user!.firmId, clientId, period);
  const result = computeVatDeclaration(clientId, period, groups, priorCredit);

  res.json(GetVatDeclarationResponse.parse(result));
});

// ---------------------------------------------------------------------------
// GET /tax/vat-annex/:clientId/:period — État Annexé (détail TVA déductible)
// ---------------------------------------------------------------------------

router.get("/tax/vat-annex/:clientId/:period", async (req, res) => {
  const { clientId, period } = GetVatAnnexParams.parse(req.params);
  if (!requireOwnClient(req, res, clientId)) return;

  if (!PERIOD_RE.test(period)) {
    res.status(400).json({ error: "Période invalide (format attendu : AAAA-MM)." });
    return;
  }

  const client = await findClient(req, clientId);
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const groups = await fetchVatTransactionGroups(clientId, req.user!.firmId, period);
  const rows = computeVatAnnex(groups);

  res.json(GetVatAnnexResponse.parse(rows.map((r) => ({ ...r, date: r.date.toISOString() }))));
});

// ---------------------------------------------------------------------------
// PATCH /tax/transactions/:id/supplier-info — fix a missing/incorrect NCC
// ---------------------------------------------------------------------------

router.patch(
  "/tax/transactions/:id/supplier-info",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = UpdateVatSupplierInfoParams.parse(req.params);
    const body = UpdateVatSupplierInfoBody.parse(req.body);

    const existing = await db.query.transactionsTable.findFirst({
      where: and(eq(transactionsTable.id, id), eq(transactionsTable.firmId, req.user!.firmId)),
      with: { journalLines: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Transaction introuvable." });
      return;
    }

    const hasDeductibleVat = existing.journalLines.some(
      (l) => l.accountNumber === "445100" || l.accountNumber === "445200",
    );
    if (!hasDeductibleVat) {
      res.status(400).json({
        error: "Cette opération ne comporte pas de ligne de TVA déductible (445100/445200).",
      });
      return;
    }

    const [updated] = await db
      .update(transactionsTable)
      .set({
        supplierName: body.supplierName !== undefined ? body.supplierName : existing.supplierName,
        supplierNcc: body.supplierNcc !== undefined ? body.supplierNcc : existing.supplierNcc,
        invoiceNumber:
          body.invoiceNumber !== undefined ? body.invoiceNumber : existing.invoiceNumber,
      })
      .where(eq(transactionsTable.id, id))
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.VAT_SUPPLIER_INFO_UPDATE,
      entityType: "transaction",
      entityId: id,
      details: `Informations fournisseur mises à jour pour l'opération #${id} (${updated.label}).`,
      ipAddress: req.ip,
    });

    const tvaDeductible = existing.journalLines
      .filter((l) => l.accountNumber === "445100" || l.accountNumber === "445200")
      .reduce((s, l) => s + l.debitAmount - l.creditAmount, 0);
    const baseHt = existing.journalLines
      .filter((l) => l.accountNumber !== "445100" && l.accountNumber !== "445200")
      .reduce((s, l) => s + l.debitAmount - l.creditAmount, 0);
    const rawRate = baseHt > 0 ? (tvaDeductible / baseHt) * 100 : 0;
    const tauxTva = [0, 9, 18].reduce((closest, c) =>
      Math.abs(c - rawRate) < Math.abs(closest - rawRate) ? c : closest,
    );

    res.json(
      UpdateVatSupplierInfoResponse.parse({
        transactionId: updated.id,
        date: updated.date.toISOString(),
        label: updated.label,
        supplierName: updated.supplierName,
        supplierNcc: updated.supplierNcc,
        invoiceNumber: updated.invoiceNumber,
        baseHt,
        tvaDeductible,
        tauxTva,
        missingNcc: !updated.supplierNcc || updated.supplierNcc.trim() === "",
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// POST /tax/vat-liquidation/:clientId/:period — posts the balanced OD entry
// ---------------------------------------------------------------------------

router.post(
  "/tax/vat-liquidation/:clientId/:period",
  requireRole("expert_comptable"),
  async (req, res) => {
    const { clientId, period } = PostVatLiquidationParams.parse(req.params);

    if (!PERIOD_RE.test(period)) {
      res.status(400).json({ error: "Période invalide (format attendu : AAAA-MM)." });
      return;
    }

    const client = await findClient(req, clientId);
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    const { year } = periodBounds(period);
    if (await isPeriodLocked(req.user!.firmId, clientId, year)) {
      res.status(403).json({
        error: `L'exercice ${year} est définitivement clôturé. La TVA ne peut plus être comptabilisée pour cette période.`,
      });
      return;
    }

    const existingDeclaration = await db.query.vatDeclarationsTable.findFirst({
      where: and(
        eq(vatDeclarationsTable.firmId, req.user!.firmId),
        eq(vatDeclarationsTable.clientId, clientId),
        eq(vatDeclarationsTable.period, period),
      ),
    });
    if (existingDeclaration?.postedTransactionId) {
      const err = new VatPeriodAlreadyPostedError(period);
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    const groups = await fetchVatTransactionGroups(clientId, req.user!.firmId, period);
    const priorCredit = await fetchPriorCredit(req.user!.firmId, clientId, period);
    const { sectionA, sectionB, sectionC } = computeVatDeclaration(
      clientId,
      period,
      groups,
      priorCredit,
    );

    const lines = buildVatLiquidationLines(sectionA, sectionB, sectionC, period);
    if (lines.length === 0) {
      const err = new NoVatActivityError(period);
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    const totalAmount = lines.reduce((s, l) => s + l.debitAmount, 0);

    const [tx] = await db
      .insert(transactionsTable)
      .values({
        firmId: req.user!.firmId,
        clientId,
        date: periodBounds(period).endExclusive,
        label: `Liquidation TVA — Déclaration D-201/VA — ${period}`,
        amount: totalAmount,
        type: "depense",
        category: null,
        paymentType: "cash",
        paymentMethod: null,
        status: "valide",
        source: "vat_liquidation",
        createdById: req.user!.id,
        anomalies: [],
        validatedAt: new Date(),
        validatedById: req.user!.id,
      })
      .returning();

    await db.insert(journalLinesTable).values(
      lines.map((l) => ({
        transactionId: tx.id,
        accountNumber: l.accountNumber,
        label: l.label,
        debitAmount: l.debitAmount,
        creditAmount: l.creditAmount,
      })),
    );

    const [declaration] = existingDeclaration
      ? await db
          .update(vatDeclarationsTable)
          .set({
            caHt18: sectionA.caHt18,
            caHt9: sectionA.caHt9,
            caExoneree: sectionA.caExoneree,
            caExport: sectionA.caExport,
            tvaCollectee18: sectionA.tvaCollectee18,
            tvaCollectee9: sectionA.tvaCollectee9,
            tvaDeductibleImmo: sectionB.tvaDeductibleImmo,
            tvaDeductibleBiensServices: sectionB.tvaDeductibleBiensServices,
            creditAnterieurReporte: sectionC.creditAnterieurReporte,
            tvaNetteAPayer: sectionC.tvaNetteAPayer,
            creditATNouveauReporter: sectionC.creditATNouveauReporter,
            postedTransactionId: tx.id,
          })
          .where(eq(vatDeclarationsTable.id, existingDeclaration.id))
          .returning()
      : await db
          .insert(vatDeclarationsTable)
          .values({
            firmId: req.user!.firmId,
            clientId,
            period,
            caHt18: sectionA.caHt18,
            caHt9: sectionA.caHt9,
            caExoneree: sectionA.caExoneree,
            caExport: sectionA.caExport,
            tvaCollectee18: sectionA.tvaCollectee18,
            tvaCollectee9: sectionA.tvaCollectee9,
            tvaDeductibleImmo: sectionB.tvaDeductibleImmo,
            tvaDeductibleBiensServices: sectionB.tvaDeductibleBiensServices,
            creditAnterieurReporte: sectionC.creditAnterieurReporte,
            tvaNetteAPayer: sectionC.tvaNetteAPayer,
            creditATNouveauReporter: sectionC.creditATNouveauReporter,
            postedTransactionId: tx.id,
            createdById: req.user!.id,
          })
          .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.VAT_LIQUIDATION_POST,
      entityType: "vat_declaration",
      entityId: declaration.id,
      details: `Liquidation TVA de ${period} comptabilisée pour "${client.name}" — écriture #${tx.id}, TVA nette ${sectionC.tvaNetteAPayer > 0 ? `à payer ${sectionC.tvaNetteAPayer} FCFA` : `crédit reporté ${sectionC.creditATNouveauReporter} FCFA`}.`,
      ipAddress: req.ip,
    });

    res.json(
      PostVatLiquidationResponse.parse({
        transactionId: tx.id,
        clientId,
        period,
        sectionC,
      }),
    );
  },
);

export default router;
