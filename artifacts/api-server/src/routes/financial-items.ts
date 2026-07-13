import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  financialAssetsLoansTable,
} from "@workspace/db";
import {
  ListFinancialItemsQueryParams,
  ListFinancialItemsResponse,
  CreateFinancialItemBody,
  CreateFinancialItemResponse,
  GetFinancialItemParams,
  GetFinancialItemResponse,
  UpdateFinancialItemParams,
  UpdateFinancialItemBody,
  UpdateFinancialItemResponse,
  GetFinancialItemScheduleParams,
  GetFinancialItemScheduleResponse,
  GenerateFinanceJournalEntriesParams,
  GenerateFinanceJournalEntriesResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  buildLoanAmortizationSchedule,
  getDueUnpostedInstallments,
  buildInstallmentJournalLines,
} from "../lib/loan-amortization-engine";
import { isPeriodLocked } from "../lib/closing-engine";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeItem(
  item: typeof financialAssetsLoansTable.$inferSelect,
  extra: { clientName?: string | null; createdByName?: string | null } = {},
) {
  const schedule = buildLoanAmortizationSchedule(
    {
      principalAmount: item.principalAmount,
      annualInterestRate: item.annualInterestRate,
      startDate: item.startDate,
      termMonths: item.termMonths,
      paymentFrequency: item.paymentFrequency,
    },
    item.installmentsPosted,
  );
  const lastPosted = [...schedule].reverse().find((r) => r.posted) ?? null;
  const nextDue = schedule.find((r) => !r.posted) ?? null;
  const totalInterest = schedule.reduce((s, r) => s + r.interestAmount, 0);

  return {
    id: item.id,
    firmId: item.firmId,
    clientId: item.clientId,
    clientName: extra.clientName ?? null,
    type: item.type,
    accountNumber: item.accountNumber,
    label: item.label,
    principalAmount: item.principalAmount,
    annualInterestRate: item.annualInterestRate,
    startDate: item.startDate,
    termMonths: item.termMonths,
    paymentFrequency: item.paymentFrequency,
    status: item.status,
    installmentsPosted: item.installmentsPosted,
    totalInstallments: schedule.length,
    remainingCapital: lastPosted ? lastPosted.remainingCapital : item.principalAmount,
    totalInterest,
    nextDueDate: nextDue ? nextDue.dueDate : null,
    nextInstallmentNumber: nextDue ? nextDue.installmentNumber : null,
    createdByName: extra.createdByName ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /financial-items — list loans & financial assets for a client
// ---------------------------------------------------------------------------

router.get("/financial-items", async (req, res) => {
  const { clientId, type } = ListFinancialItemsQueryParams.parse(req.query);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const items = await db.query.financialAssetsLoansTable.findMany({
    where: and(
      eq(financialAssetsLoansTable.firmId, req.user!.firmId),
      eq(financialAssetsLoansTable.clientId, clientId),
      ...(type ? [eq(financialAssetsLoansTable.type, type)] : []),
    ),
    orderBy: (t, { desc }) => [desc(t.startDate)],
    with: { client: true, createdBy: true },
  });

  res.json(
    ListFinancialItemsResponse.parse(
      items.map((i) =>
        serializeItem(i, { clientName: i.client?.name, createdByName: i.createdBy?.fullName }),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// POST /financial-items — register a new loan or financial asset
// ---------------------------------------------------------------------------

router.post(
  "/financial-items",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const body = CreateFinancialItemBody.parse(req.body);

    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    if (body.principalAmount <= 0) {
      res.status(400).json({ error: "Le montant nominal doit être strictement positif." });
      return;
    }
    if (body.termMonths <= 0) {
      res.status(400).json({ error: "La durée doit être d'au moins 1 mois." });
      return;
    }
    if ((body.annualInterestRate ?? 0) < 0) {
      res.status(400).json({ error: "Le taux d'intérêt ne peut pas être négatif." });
      return;
    }

    const [item] = await db
      .insert(financialAssetsLoansTable)
      .values({
        firmId: req.user!.firmId,
        clientId: body.clientId,
        type: body.type,
        accountNumber: body.accountNumber,
        label: body.label,
        principalAmount: body.principalAmount,
        annualInterestRate: body.annualInterestRate ?? 0,
        startDate: body.startDate,
        termMonths: body.termMonths,
        paymentFrequency: body.paymentFrequency,
        status: "ACTIF",
        installmentsPosted: 0,
        createdById: req.user!.id,
      })
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.FINANCIAL_ITEM_CREATE,
      entityType: "financial_item",
      entityId: item.id,
      details: `${body.type === "EMPRUNT_BANCAIRE" ? "Emprunt" : "Immobilisation financière"} "${body.label}" (compte ${body.accountNumber}, ${body.principalAmount.toLocaleString("fr")} FCFA) enregistré(e) pour "${client.name}"`,
      ipAddress: req.ip,
    });

    res
      .status(201)
      .json(
        CreateFinancialItemResponse.parse(
          serializeItem(item, { clientName: client.name, createdByName: req.user!.fullName }),
        ),
      );
  },
);

// ---------------------------------------------------------------------------
// POST /finance/generate-journal-entries/:clientId — book all due, unposted
// installments for every active loan/financial asset of this client
// (must be registered before /financial-items/:id to avoid ambiguity, but
// it lives on a distinct path prefix so there is no actual overlap).
// ---------------------------------------------------------------------------

router.post(
  "/finance/generate-journal-entries/:clientId",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { clientId } = GenerateFinanceJournalEntriesParams.parse(req.params);

    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    const activeItems = await db.query.financialAssetsLoansTable.findMany({
      where: and(
        eq(financialAssetsLoansTable.firmId, req.user!.firmId),
        eq(financialAssetsLoansTable.clientId, clientId),
        eq(financialAssetsLoansTable.status, "ACTIF"),
      ),
    });

    const now = new Date();
    const generated: Array<{
      itemId: number;
      itemLabel: string;
      installmentsGenerated: number;
      transactionIds: number[];
    }> = [];
    const skipped: Array<{ itemId: number; itemLabel: string; reason: string }> = [];

    for (const item of activeItems) {
      const dueRows = getDueUnpostedInstallments(
        {
          principalAmount: item.principalAmount,
          annualInterestRate: item.annualInterestRate,
          startDate: item.startDate,
          termMonths: item.termMonths,
          paymentFrequency: item.paymentFrequency,
        },
        item.installmentsPosted,
        now,
      );

      if (dueRows.length === 0) {
        skipped.push({
          itemId: item.id,
          itemLabel: item.label,
          reason: "Aucune échéance due à ce jour",
        });
        continue;
      }

      const transactionIds: number[] = [];
      let lastInstallmentNumber = item.installmentsPosted;

      for (const row of dueRows) {
        const lines = buildInstallmentJournalLines({
          type: item.type,
          accountNumber: item.accountNumber,
          principalAmount: row.principalAmount,
          interestAmount: row.interestAmount,
        });
        const total = row.principalAmount + row.interestAmount;

        // Direct DB insert — like M17's depreciation closings, this is a
        // pre-computed treasury movement derived from a stored schedule
        // rather than the category-based accounting engine.
        const [tx] = await db
          .insert(transactionsTable)
          .values({
            firmId: req.user!.firmId,
            clientId,
            date: row.dueDate,
            label: `${item.type === "EMPRUNT_BANCAIRE" ? "Échéance emprunt" : "Échéance prêt"} — ${item.label} — Échéance n°${row.installmentNumber}`,
            amount: total,
            type: item.type === "EMPRUNT_BANCAIRE" ? "depense" : "recette",
            category: null,
            paymentType: "cash",
            paymentMethod: "virement",
            status: "a_valider",
            source: "manual_cabinet",
            createdById: req.user!.id,
            anomalies: [],
          })
          .returning();

        await db.insert(journalLinesTable).values(
          lines.map((l) => ({
            transactionId: tx.id,
            accountNumber: l.accountNumber,
            label: `${l.label} — ${item.label} n°${row.installmentNumber}`,
            debitAmount: l.debitAmount,
            creditAmount: l.creditAmount,
          })),
        );

        transactionIds.push(tx.id);
        lastInstallmentNumber = row.installmentNumber;
      }

      await db
        .update(financialAssetsLoansTable)
        .set({ installmentsPosted: lastInstallmentNumber })
        .where(eq(financialAssetsLoansTable.id, item.id));

      generated.push({
        itemId: item.id,
        itemLabel: item.label,
        installmentsGenerated: dueRows.length,
        transactionIds,
      });
    }

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.FINANCIAL_ENTRY_GENERATE,
      entityType: "financial_item",
      details: `Génération des écritures d'échéances financières — ${generated.length} élément(s) traité(s) pour "${client.name}"`,
      ipAddress: req.ip,
    });

    res.json(
      GenerateFinanceJournalEntriesResponse.parse({
        clientId,
        generated,
        skipped,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /financial-items/:id — get a single item
// ---------------------------------------------------------------------------

router.get("/financial-items/:id", async (req, res) => {
  const { id } = GetFinancialItemParams.parse(req.params);

  const item = await db.query.financialAssetsLoansTable.findFirst({
    where: and(eq(financialAssetsLoansTable.id, id), eq(financialAssetsLoansTable.firmId, req.user!.firmId)),
    with: { client: true, createdBy: true },
  });
  if (!item) {
    res.status(404).json({ error: "Élément introuvable." });
    return;
  }

  res.json(
    GetFinancialItemResponse.parse(
      serializeItem(item, { clientName: item.client?.name, createdByName: item.createdBy?.fullName }),
    ),
  );
});

// ---------------------------------------------------------------------------
// PATCH /financial-items/:id — update (retire/solde, relabel)
// ---------------------------------------------------------------------------

router.patch(
  "/financial-items/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = UpdateFinancialItemParams.parse(req.params);
    const body = UpdateFinancialItemBody.parse(req.body);

    const item = await db.query.financialAssetsLoansTable.findFirst({
      where: and(eq(financialAssetsLoansTable.id, id), eq(financialAssetsLoansTable.firmId, req.user!.firmId)),
      with: { client: true, createdBy: true },
    });
    if (!item) {
      res.status(404).json({ error: "Élément introuvable." });
      return;
    }

    const updatePayload: Partial<typeof financialAssetsLoansTable.$inferInsert> = {};
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.label !== undefined) updatePayload.label = body.label;

    const [updated] = await db
      .update(financialAssetsLoansTable)
      .set(updatePayload)
      .where(eq(financialAssetsLoansTable.id, id))
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.FINANCIAL_ITEM_UPDATE,
      entityType: "financial_item",
      entityId: id,
      details: body.status === "SOLDE"
        ? `Clôture de l'élément financier "${item.label}"`
        : `Mise à jour de l'élément financier "${item.label}"`,
      ipAddress: req.ip,
    });

    res.json(
      UpdateFinancialItemResponse.parse(
        serializeItem(updated, { clientName: item.client?.name, createdByName: item.createdBy?.fullName }),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /financial-items/:id/schedule — full amortization tableau
// ---------------------------------------------------------------------------

router.get("/financial-items/:id/schedule", async (req, res) => {
  const { id } = GetFinancialItemScheduleParams.parse(req.params);

  const item = await db.query.financialAssetsLoansTable.findFirst({
    where: and(eq(financialAssetsLoansTable.id, id), eq(financialAssetsLoansTable.firmId, req.user!.firmId)),
  });
  if (!item) {
    res.status(404).json({ error: "Élément introuvable." });
    return;
  }

  const rows = buildLoanAmortizationSchedule(
    {
      principalAmount: item.principalAmount,
      annualInterestRate: item.annualInterestRate,
      startDate: item.startDate,
      termMonths: item.termMonths,
      paymentFrequency: item.paymentFrequency,
    },
    item.installmentsPosted,
  );

  res.json(GetFinancialItemScheduleResponse.parse({ itemId: id, rows }));
});

export default router;
