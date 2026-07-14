import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  transactionsTable,
  journalLinesTable,
  isPortalRole,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { computeMobileMoneyVirementJournalLines, MOBILE_MONEY_PROVIDER_LABELS } from "../lib/accounting-engine";
import { isPeriodLocked } from "../lib/closing-engine";
import { withJournalLines, HttpError } from "./accounting";
import {
  CreateMobileMoneyTransferBody,
  CreateMobileMoneyTransferResponse,
} from "@workspace/api-zod";

// Module P7 Mobile Money (Cabinet only): records a "Virement Mobile Money →
// Banque" withdrawal for a station-service client. The compound SYSCOHADA
// entry debits 52 (Banques) for the net amount, debits 631700 (Frais sur
// instruments monétaires électroniques) for the operator fee, and credits
// the relevant Classe 55 account (552100/552200/552300/552400).

const router: IRouter = Router();

router.use(requireAuth);

router.post("/mobile-money/transfers", async (req, res) => {
  // Cabinet-only: portal roles (POMPISTE, CLIENT_PME, etc.) cannot record
  // cross-account fund transfers -- only an accountant can.
  if (isPortalRole(req.user!.role)) {
    res.status(403).json({ error: "Accès réservé au cabinet comptable." });
    return;
  }

  const body = CreateMobileMoneyTransferBody.parse(req.body);

  // Prevent booking into a locked fiscal year.
  const txDate = new Date(body.date instanceof Date ? body.date : String(body.date));
  const txYear = txDate.getFullYear();
  if (await isPeriodLocked(req.user!.firmId, body.clientId, txYear)) {
    res.status(403).json({
      error: `L'exercice ${txYear} est définitivement clôturé. Aucune écriture ne peut y être ajoutée.`,
    });
    return;
  }

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  if (body.feeAmount >= body.totalAmount) {
    res
      .status(400)
      .json({ error: "Les frais de retrait ne peuvent pas être supérieurs ou égaux au montant total du virement." });
    return;
  }

  const providerLabel = MOBILE_MONEY_PROVIDER_LABELS[body.provider] ?? body.provider;

  const journalLines = computeMobileMoneyVirementJournalLines({
    provider: body.provider,
    totalAmount: body.totalAmount,
    feeAmount: body.feeAmount,
  });

  const txLabel =
    body.note?.trim() ||
    `Virement ${providerLabel} → Banque — ${client.name}`;

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: body.clientId,
      date: txDate,
      label: txLabel,
      amount: body.totalAmount,
      type: "depense",
      category: "frais_mobile_money",
      paymentType: "cash",
      paymentMethod: "mobile_money",
      status: "a_valider",
      source: "manual_cabinet",
      createdById: req.user!.id,
    })
    .returning();

  await db.insert(journalLinesTable).values(
    journalLines.map((line) => ({
      transactionId: tx.id,
      accountNumber: line.accountNumber,
      label: line.label,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
    })),
  );

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.TRANSACTION_CREATE,
    entityType: "mobile_money_transfer",
    entityId: tx.id,
    details: `Virement ${providerLabel} → Banque : ${body.totalAmount} FCFA (dont frais : ${body.feeAmount} FCFA) — ${client.name}`,
    ipAddress: req.ip,
  });

  const transaction = await withJournalLines(tx, {
    clientName: client.name,
    createdByName: req.user!.fullName,
  });

  res.status(201).json(CreateMobileMoneyTransferResponse.parse({ transaction }));
});

export default router;
