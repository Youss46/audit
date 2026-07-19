/**
 * Module M23 — Analytical Accounting (Comptabilité Analytique par Projet /
 * Département).
 *
 * RBAC rules:
 *   - Axes and codes:    expert_comptable + collaborateur (write), stagiaire (read)
 *   - Allocations:       expert_comptable + collaborateur
 *   - Analytical report: expert_comptable + collaborateur + stagiaire
 */

import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  journalLinesTable,
  transactionsTable,
  analyticalAxesTable,
  analyticalCodesTable,
  analyticalAllocationsTable,
} from "@workspace/db";
import {
  ListAnalyticalAxesQueryParams,
  CreateAnalyticalAxisBody,
  UpdateAnalyticalAxisParams,
  UpdateAnalyticalAxisBody,
  DeleteAnalyticalAxisParams,
  ListAnalyticalCodesQueryParams,
  CreateAnalyticalCodeBody,
  UpdateAnalyticalCodeParams,
  UpdateAnalyticalCodeBody,
  DeleteAnalyticalCodeParams,
  ListAnalyticalAllocationsQueryParams,
  SetJournalLineAllocationsParams,
  SetJournalLineAllocationsBody,
  GetAnalyticalReportQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeAxis(axis: typeof analyticalAxesTable.$inferSelect) {
  return {
    id: axis.id,
    firmId: axis.firmId,
    clientId: axis.clientId,
    name: axis.name,
    isActive: axis.isActive,
    createdAt: axis.createdAt,
  };
}

function serializeCode(
  code: typeof analyticalCodesTable.$inferSelect,
  axisName?: string,
) {
  return {
    id: code.id,
    axisId: code.axisId,
    axisName: axisName ?? "",
    firmId: code.firmId,
    clientId: code.clientId,
    code: code.code,
    label: code.label,
    isActive: code.isActive,
    createdAt: code.createdAt,
  };
}

function serializeAllocation(
  alloc: typeof analyticalAllocationsTable.$inferSelect,
  extra: {
    analyticalCode?: string;
    analyticalCodeLabel?: string;
    axisId?: number;
    axisName?: string;
  } = {},
) {
  return {
    id: alloc.id,
    journalLineId: alloc.journalLineId,
    analyticalCodeId: alloc.analyticalCodeId,
    analyticalCode: extra.analyticalCode ?? "",
    analyticalCodeLabel: extra.analyticalCodeLabel ?? "",
    axisId: extra.axisId ?? null,
    axisName: extra.axisName ?? null,
    firmId: alloc.firmId,
    clientId: alloc.clientId,
    percentage: alloc.percentage,
    allocatedAmount: alloc.allocatedAmount,
    createdAt: alloc.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Helper: verify clientId belongs to firm
// ---------------------------------------------------------------------------

async function findAuthorizedClient(firmId: number, clientId: number) {
  return db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)),
  });
}

// ===========================================================================
// ANALYTICAL AXES
// ===========================================================================

// GET /analytical/axes?clientId=X&includeInactive=false
router.get(
  "/analytical/axes",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
    const { clientId, includeInactive } = ListAnalyticalAxesQueryParams.parse(req.query);

    const client = await findAuthorizedClient(req.user!.firmId, clientId);
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    const axes = await db.query.analyticalAxesTable.findMany({
      where: and(
        eq(analyticalAxesTable.firmId, req.user!.firmId),
        eq(analyticalAxesTable.clientId, clientId),
        includeInactive ? undefined : eq(analyticalAxesTable.isActive, true),
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    });

    res.json(axes.map(serializeAxis));
  },
);

// POST /analytical/axes
router.post(
  "/analytical/axes",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const body = CreateAnalyticalAxisBody.parse(req.body);

    const client = await findAuthorizedClient(req.user!.firmId, body.clientId);
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    const [axis] = await db
      .insert(analyticalAxesTable)
      .values({
        firmId: req.user!.firmId,
        clientId: body.clientId,
        name: body.name,
        isActive: body.isActive ?? true,
      })
      .returning();

    res.status(201).json(serializeAxis(axis));
  },
);

// PATCH /analytical/axes/:id
router.patch(
  "/analytical/axes/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = UpdateAnalyticalAxisParams.parse(req.params);
    const body = UpdateAnalyticalAxisBody.parse(req.body);

    const existing = await db.query.analyticalAxesTable.findFirst({
      where: and(
        eq(analyticalAxesTable.id, id),
        eq(analyticalAxesTable.firmId, req.user!.firmId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Axe analytique introuvable." });
      return;
    }

    const updates: Partial<typeof analyticalAxesTable.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    const [updated] = await db
      .update(analyticalAxesTable)
      .set(updates)
      .where(eq(analyticalAxesTable.id, id))
      .returning();

    res.json(serializeAxis(updated));
  },
);

// DELETE /analytical/axes/:id
router.delete(
  "/analytical/axes/:id",
  requireRole("expert_comptable"),
  async (req, res) => {
    const { id } = DeleteAnalyticalAxisParams.parse(req.params);

    const existing = await db.query.analyticalAxesTable.findFirst({
      where: and(
        eq(analyticalAxesTable.id, id),
        eq(analyticalAxesTable.firmId, req.user!.firmId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Axe analytique introuvable." });
      return;
    }

    // Block deletion if any code under this axis has allocations.
    const codes = await db.query.analyticalCodesTable.findMany({
      where: eq(analyticalCodesTable.axisId, id),
    });
    if (codes.length > 0) {
      const codeIds = codes.map((c) => c.id);
      const allocCount = await db.query.analyticalAllocationsTable.findMany({
        where: inArray(analyticalAllocationsTable.analyticalCodeId, codeIds),
      });
      if (allocCount.length > 0) {
        res.status(409).json({
          error: "Impossible de supprimer cet axe : des ventilations analytiques existent sur ses sections. Supprimez d'abord les ventilations.",
        });
        return;
      }
    }

    await db.delete(analyticalAxesTable).where(eq(analyticalAxesTable.id, id));
    res.status(204).send();
  },
);

// ===========================================================================
// ANALYTICAL CODES
// ===========================================================================

// GET /analytical/codes?axisId=X&clientId=Y&includeInactive=false
router.get(
  "/analytical/codes",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
    const { axisId, clientId, includeInactive } =
      ListAnalyticalCodesQueryParams.parse(req.query);

    const codes = await db.query.analyticalCodesTable.findMany({
      where: and(
        eq(analyticalCodesTable.firmId, req.user!.firmId),
        axisId ? eq(analyticalCodesTable.axisId, axisId) : undefined,
        clientId ? eq(analyticalCodesTable.clientId, clientId) : undefined,
        includeInactive ? undefined : eq(analyticalCodesTable.isActive, true),
      ),
      with: { axis: true },
      orderBy: (t, { asc }) => [asc(t.code)],
    });

    res.json(codes.map((c) => serializeCode(c, c.axis?.name)));
  },
);

// POST /analytical/codes
router.post(
  "/analytical/codes",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const body = CreateAnalyticalCodeBody.parse(req.body);

    const axis = await db.query.analyticalAxesTable.findFirst({
      where: and(
        eq(analyticalAxesTable.id, body.axisId),
        eq(analyticalAxesTable.firmId, req.user!.firmId),
      ),
    });
    if (!axis) {
      res.status(404).json({ error: "Axe analytique introuvable." });
      return;
    }

    // Enforce unique code within axis.
    const duplicate = await db.query.analyticalCodesTable.findFirst({
      where: and(
        eq(analyticalCodesTable.axisId, body.axisId),
        eq(analyticalCodesTable.code, body.code),
      ),
    });
    if (duplicate) {
      res.status(409).json({ error: `Le code "${body.code}" existe déjà sur cet axe.` });
      return;
    }

    const [code] = await db
      .insert(analyticalCodesTable)
      .values({
        axisId: body.axisId,
        firmId: req.user!.firmId,
        clientId: axis.clientId,
        code: body.code.toUpperCase(),
        label: body.label,
        isActive: body.isActive ?? true,
      })
      .returning();

    res.status(201).json(serializeCode(code, axis.name));
  },
);

// PATCH /analytical/codes/:id
router.patch(
  "/analytical/codes/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = UpdateAnalyticalCodeParams.parse(req.params);
    const body = UpdateAnalyticalCodeBody.parse(req.body);

    const existing = await db.query.analyticalCodesTable.findFirst({
      where: and(
        eq(analyticalCodesTable.id, id),
        eq(analyticalCodesTable.firmId, req.user!.firmId),
      ),
      with: { axis: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Section analytique introuvable." });
      return;
    }

    const updates: Partial<typeof analyticalCodesTable.$inferInsert> = {};
    if (body.code !== undefined) updates.code = body.code.toUpperCase();
    if (body.label !== undefined) updates.label = body.label;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    const [updated] = await db
      .update(analyticalCodesTable)
      .set(updates)
      .where(eq(analyticalCodesTable.id, id))
      .returning();

    res.json(serializeCode(updated, existing.axis?.name));
  },
);

// DELETE /analytical/codes/:id
router.delete(
  "/analytical/codes/:id",
  requireRole("expert_comptable"),
  async (req, res) => {
    const { id } = DeleteAnalyticalCodeParams.parse(req.params);

    const existing = await db.query.analyticalCodesTable.findFirst({
      where: and(
        eq(analyticalCodesTable.id, id),
        eq(analyticalCodesTable.firmId, req.user!.firmId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Section analytique introuvable." });
      return;
    }

    const allocCount = await db.query.analyticalAllocationsTable.findMany({
      where: eq(analyticalAllocationsTable.analyticalCodeId, id),
    });
    if (allocCount.length > 0) {
      res.status(409).json({
        error: "Impossible de supprimer cette section : des ventilations analytiques y sont attachées.",
      });
      return;
    }

    await db.delete(analyticalCodesTable).where(eq(analyticalCodesTable.id, id));
    res.status(204).send();
  },
);

// ===========================================================================
// ANALYTICAL ALLOCATIONS
// ===========================================================================

// GET /analytical/allocations?journalLineId=X
router.get(
  "/analytical/allocations",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
    const { journalLineId } = ListAnalyticalAllocationsQueryParams.parse(req.query);

    // Verify the line belongs to this firm.
    const line = await db.query.journalLinesTable.findFirst({
      where: eq(journalLinesTable.id, journalLineId),
    });
    if (!line) {
      res.status(404).json({ error: "Ligne de journal introuvable." });
      return;
    }
    const lineTx = await db.query.transactionsTable.findFirst({
      where: eq(transactionsTable.id, line.transactionId),
    });
    if (!lineTx || lineTx.firmId !== req.user!.firmId) {
      res.status(404).json({ error: "Ligne de journal introuvable." });
      return;
    }

    const allocs = await db.query.analyticalAllocationsTable.findMany({
      where: eq(analyticalAllocationsTable.journalLineId, journalLineId),
      with: { analyticalCode: { with: { axis: true } } },
      orderBy: (t, { desc }) => [desc(t.percentage)],
    });

    res.json(
      allocs.map((a) =>
        serializeAllocation(a, {
          analyticalCode: a.analyticalCode?.code,
          analyticalCodeLabel: a.analyticalCode?.label,
          axisId: a.analyticalCode?.axisId,
          axisName: a.analyticalCode?.axis?.name,
        }),
      ),
    );
  },
);

// PUT /analytical/allocations/journal-line/:lineId
// Replaces all allocations for a given journal line atomically.
router.put(
  "/analytical/allocations/journal-line/:lineId",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { lineId } = SetJournalLineAllocationsParams.parse(req.params);
    const body = SetJournalLineAllocationsBody.parse(req.body);

    // Find and authorize the journal line.
    const line = await db.query.journalLinesTable.findFirst({
      where: eq(journalLinesTable.id, lineId),
    });
    if (!line) {
      res.status(404).json({ error: "Ligne de journal introuvable." });
      return;
    }
    const lineTx = await db.query.transactionsTable.findFirst({
      where: eq(transactionsTable.id, line.transactionId),
    });
    if (!lineTx || lineTx.firmId !== req.user!.firmId) {
      res.status(404).json({ error: "Ligne de journal introuvable." });
      return;
    }

    const { allocations } = body;

    // Validate: sum of percentages must not exceed 100.
    const totalPct = allocations.reduce((s, a) => s + a.percentage, 0);
    if (totalPct > 100.001) {
      res.status(400).json({
        error: `La somme des pourcentages de ventilation (${totalPct.toFixed(2)} %) dépasse 100 %.`,
      });
      return;
    }

    // Validate: all analytical codes belong to this firm and are active.
    if (allocations.length > 0) {
      const codeIds = allocations.map((a) => a.analyticalCodeId);
      const codes = await db.query.analyticalCodesTable.findMany({
        where: and(
          inArray(analyticalCodesTable.id, codeIds),
          eq(analyticalCodesTable.firmId, req.user!.firmId),
        ),
      });
      if (codes.length !== codeIds.length) {
        res.status(404).json({ error: "Une ou plusieurs sections analytiques sont introuvables." });
        return;
      }
    }

    // The gross amount of the line (debit or credit, whichever is non-zero).
    const lineAmount =
      (line.debitAmount ?? 0) > 0 ? line.debitAmount : (line.creditAmount ?? 0);

    // Atomic replace: delete all existing allocations, insert new ones.
    await db.transaction(async (trx) => {
      await trx
        .delete(analyticalAllocationsTable)
        .where(eq(analyticalAllocationsTable.journalLineId, lineId));

      if (allocations.length > 0) {
        await trx.insert(analyticalAllocationsTable).values(
          allocations.map((a) => ({
            journalLineId: lineId,
            analyticalCodeId: a.analyticalCodeId,
            firmId: req.user!.firmId,
            clientId: lineTx.clientId,
            percentage: a.percentage,
            allocatedAmount: Math.round((lineAmount * a.percentage) / 100),
          })),
        );
      }
    });

    // Return the freshly saved allocations.
    const saved = await db.query.analyticalAllocationsTable.findMany({
      where: eq(analyticalAllocationsTable.journalLineId, lineId),
      with: { analyticalCode: { with: { axis: true } } },
      orderBy: (t, { desc }) => [desc(t.percentage)],
    });

    res.json(
      saved.map((a) =>
        serializeAllocation(a, {
          analyticalCode: a.analyticalCode?.code,
          analyticalCodeLabel: a.analyticalCode?.label,
          axisId: a.analyticalCode?.axisId,
          axisName: a.analyticalCode?.axis?.name,
        }),
      ),
    );
  },
);

// ===========================================================================
// ANALYTICAL REPORT  (Compte de résultat analytique)
// ===========================================================================

// GET /analytical/report?clientId=X&axisId=Y&year=Z
router.get(
  "/analytical/report",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
    const { clientId, axisId, year } = GetAnalyticalReportQueryParams.parse(req.query);

    const client = await findAuthorizedClient(req.user!.firmId, clientId);
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    const axis = await db.query.analyticalAxesTable.findFirst({
      where: and(
        eq(analyticalAxesTable.id, axisId),
        eq(analyticalAxesTable.firmId, req.user!.firmId),
        eq(analyticalAxesTable.clientId, clientId),
      ),
    });
    if (!axis) {
      res.status(404).json({ error: "Axe analytique introuvable." });
      return;
    }

    // Fetch all codes for this axis.
    const codes = await db.query.analyticalCodesTable.findMany({
      where: and(
        eq(analyticalCodesTable.axisId, axisId),
        eq(analyticalCodesTable.firmId, req.user!.firmId),
      ),
      orderBy: (t, { asc }) => [asc(t.code)],
    });

    if (codes.length === 0) {
      res.json({ clientId, axisId, axisName: axis.name, year, rows: [] });
      return;
    }

    const codeIds = codes.map((c) => c.id);

    // Fetch all allocations for codes in this axis, then join transactions
    // separately to avoid the relation typing constraint.
    const allocs = await db.query.analyticalAllocationsTable.findMany({
      where: and(
        inArray(analyticalAllocationsTable.analyticalCodeId, codeIds),
        eq(analyticalAllocationsTable.firmId, req.user!.firmId),
        eq(analyticalAllocationsTable.clientId, clientId),
      ),
      with: {
        journalLine: true,
        analyticalCode: true,
      },
    });

    // Collect unique transaction IDs, then load them in one query.
    const txIds = [...new Set(allocs.map((a) => a.journalLine?.transactionId).filter((id): id is number => id !== undefined))];
    const txMap = new Map<number, typeof transactionsTable.$inferSelect>();
    if (txIds.length > 0) {
      const txRows = await db.query.transactionsTable.findMany({
        where: inArray(transactionsTable.id, txIds),
      });
      for (const tx of txRows) txMap.set(tx.id, tx);
    }

    // Filter to the requested year and only validated transactions.
    const yearAllocations = allocs.filter((a) => {
      const tx = a.journalLine ? txMap.get(a.journalLine.transactionId) : undefined;
      return (
        tx &&
        tx.status === "valide" &&
        new Date(tx.date).getFullYear() === year
      );
    });

    // Aggregate by code.
    type CodeAgg = {
      codeId: number;
      code: string;
      label: string;
      totalRevenue: number;
      totalExpense: number;
      revenueByAccount: Map<string, { accountName: string; amount: number }>;
      expenseByAccount: Map<string, { accountName: string; amount: number }>;
    };
    const byCode = new Map<number, CodeAgg>();
    for (const code of codes) {
      byCode.set(code.id, {
        codeId: code.id,
        code: code.code,
        label: code.label,
        totalRevenue: 0,
        totalExpense: 0,
        revenueByAccount: new Map(),
        expenseByAccount: new Map(),
      });
    }

    for (const alloc of yearAllocations) {
      const agg = byCode.get(alloc.analyticalCodeId);
      if (!agg) continue;
      const line = alloc.journalLine;
      if (!line) continue;
      const acct = line.accountNumber;
      const cls = Number(acct[0]);
      const amount = alloc.allocatedAmount;

      if (cls === 7) {
        // Revenue: typically a credit on a Class 7 account.
        agg.totalRevenue += amount;
        const existing = agg.revenueByAccount.get(acct) ?? {
          accountName: line.label ?? acct,
          amount: 0,
        };
        existing.amount += amount;
        agg.revenueByAccount.set(acct, existing);
      } else if (cls === 6) {
        // Expense: typically a debit on a Class 6 account.
        agg.totalExpense += amount;
        const existing = agg.expenseByAccount.get(acct) ?? {
          accountName: line.label ?? acct,
          amount: 0,
        };
        existing.amount += amount;
        agg.expenseByAccount.set(acct, existing);
      }
    }

    const rows = codes
      .map((code) => {
        const agg = byCode.get(code.id)!;
        const netMargin = agg.totalRevenue - agg.totalExpense;
        const marginPct =
          agg.totalRevenue > 0 ? (netMargin / agg.totalRevenue) * 100 : null;

        return {
          codeId: agg.codeId,
          code: agg.code,
          label: agg.label,
          totalRevenue: agg.totalRevenue,
          totalExpense: agg.totalExpense,
          netMargin,
          marginPct: marginPct !== null ? Math.round(marginPct * 10) / 10 : null,
          revenueByAccount: Array.from(agg.revenueByAccount.entries()).map(
            ([accountNumber, v]) => ({ accountNumber, accountName: v.accountName, amount: v.amount }),
          ),
          expenseByAccount: Array.from(agg.expenseByAccount.entries()).map(
            ([accountNumber, v]) => ({ accountNumber, accountName: v.accountName, amount: v.amount }),
          ),
        };
      })
      .sort((a, b) => b.netMargin - a.netMargin);

    res.json({ clientId, axisId, axisName: axis.name, year, rows });
  },
);

export default router;
