/**
 * Module Trésorerie — Prévisionnel de Trésorerie à 30/60 jours
 *
 * GET /cashflow/forecast?clientId=&days=30|60
 *
 * Aggregates:
 *  - Current balance: net of all validated recette/depense transactions
 *  - Expected inflows: unpaid customer invoices (VALIDE/PARTIELLEMENT_PAYE)
 *    grouped by dueDate
 *  - Expected outflows: pending credit purchases (status=pending) grouped
 *    by their recorded date + estimated monthly payroll posted on day 28
 *    (gross sum of active employees' baseSalary + allowances)
 *
 * Returns a day-by-day projection array ready for Recharts rendering.
 */
import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  invoicesTable,
  purchasesTable,
  employeesTable,
  transactionsTable,
} from "@workspace/db";
import { requireAuth, requireOwnClient } from "../middlewares/auth";
import { GetCashflowForecastQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth);

// ── GET /cashflow/forecast ───────────────────────────────────────────────────
router.get("/cashflow/forecast", async (req, res) => {
  const { clientId, days } = GetCashflowForecastQueryParams.parse(req.query);

  if (!requireOwnClient(req, res, clientId)) return;

  const client = await db.query.clientsTable.findFirst({
    where: and(
      eq(clientsTable.id, clientId),
      eq(clientsTable.firmId, req.user!.firmId),
    ),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  // ── 1. Current balance — net of all validated ledger entries ────────────
  const allTxs = await db.query.transactionsTable.findMany({
    where: and(
      eq(transactionsTable.clientId, clientId),
      eq(transactionsTable.firmId, req.user!.firmId),
      eq(transactionsTable.status, "valide"),
    ),
    columns: { type: true, amount: true },
  });

  const currentBalance = allTxs.reduce(
    (sum, t) => sum + (t.type === "recette" ? t.amount : -t.amount),
    0,
  );

  // ── 2. Pending inflows — unpaid invoices ────────────────────────────────
  const unpaidInvoices = await db.query.invoicesTable.findMany({
    where: and(
      eq(invoicesTable.clientId, clientId),
      eq(invoicesTable.firmId, req.user!.firmId),
      inArray(invoicesTable.status, ["VALIDE", "PARTIELLEMENT_PAYE"]),
    ),
    columns: { invoiceNumber: true, customerName: true, totalTtc: true, amountPaid: true, dueDate: true },
  });

  // ── 3. Pending outflows — unsettled credit purchases ────────────────────
  const pendingPurchases = await db.query.purchasesTable.findMany({
    where: and(
      eq(purchasesTable.clientId, clientId),
      eq(purchasesTable.firmId, req.user!.firmId),
      eq(purchasesTable.status, "pending"),
    ),
    columns: { supplierName: true, amountTtc: true, date: true },
  });

  // ── 4. Payroll estimate — active employees' gross monthly cost ──────────
  const activeEmployees = await db.query.employeesTable.findMany({
    where: and(
      eq(employeesTable.clientId, clientId),
      eq(employeesTable.firmId, req.user!.firmId),
      eq(employeesTable.status, "ACTIF"),
    ),
    columns: { baseSalary: true, transportAllowance: true, otherTaxablePrimes: true },
  });

  const monthlyPayroll = activeEmployees.reduce(
    (sum, e) => sum + e.baseSalary + e.transportAllowance + e.otherTaxablePrimes,
    0,
  );

  // ── 5. Build day-by-day projection ──────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Index inflows by date string (YYYY-MM-DD)
  const inflowsByDate = new Map<string, { amount: number; labels: string[] }>();
  for (const inv of unpaidInvoices) {
    const outstanding = inv.totalTtc - inv.amountPaid;
    if (outstanding <= 0) continue;

    // Use dueDate or fall back to today + 7 days if missing / past
    let d: Date;
    if (inv.dueDate) {
      d = new Date(inv.dueDate);
      d.setHours(0, 0, 0, 0);
      if (d < today) d = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      d = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    const key = d.toISOString().slice(0, 10);
    const entry = inflowsByDate.get(key) ?? { amount: 0, labels: [] };
    entry.amount += outstanding;
    const label = inv.invoiceNumber
      ? `Facture ${inv.invoiceNumber} — ${inv.customerName}`
      : `Créance client — ${inv.customerName}`;
    if (!entry.labels.includes(label)) entry.labels.push(label);
    inflowsByDate.set(key, entry);
  }

  // Index outflows by date string
  const outflowsByDate = new Map<string, { amount: number; labels: string[] }>();
  for (const p of pendingPurchases) {
    const d = new Date(p.date);
    d.setHours(0, 0, 0, 0);
    const effective = d < today ? new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000) : d;
    const key = effective.toISOString().slice(0, 10);
    const entry = outflowsByDate.get(key) ?? { amount: 0, labels: [] };
    entry.amount += p.amountTtc;
    const label = `Règlement fournisseur — ${p.supplierName}`;
    if (!entry.labels.includes(label)) entry.labels.push(label);
    outflowsByDate.set(key, entry);
  }

  // Add payroll on day 28 of each month within the window
  if (monthlyPayroll > 0) {
    const monthsSeen = new Set<string>();
    for (let i = 0; i <= days; i++) {
      const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      if (d.getDate() === 28) {
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!monthsSeen.has(monthKey)) {
          monthsSeen.add(monthKey);
          const key = d.toISOString().slice(0, 10);
          const entry = outflowsByDate.get(key) ?? { amount: 0, labels: [] };
          entry.amount += monthlyPayroll;
          entry.labels.push(`Masse salariale estimée (${activeEmployees.length} employé${activeEmployees.length > 1 ? "s" : ""})`);
          outflowsByDate.set(key, entry);
        }
      }
    }
    // If no day-28 falls in the window (e.g. 30-day window starting after 28th),
    // add payroll on day 7 of next month as a fallback.
    if (monthsSeen.size === 0 && monthlyPayroll > 0) {
      const firstPayrollDate = new Date(today.getFullYear(), today.getMonth() + 1, 28);
      if (firstPayrollDate <= new Date(today.getTime() + days * 24 * 60 * 60 * 1000)) {
        const key = firstPayrollDate.toISOString().slice(0, 10);
        const entry = outflowsByDate.get(key) ?? { amount: 0, labels: [] };
        entry.amount += monthlyPayroll;
        entry.labels.push(`Masse salariale estimée (${activeEmployees.length} employé${activeEmployees.length > 1 ? "s" : ""})`);
        outflowsByDate.set(key, entry);
      }
    }
  }

  // Build projections array
  let runningBalance = currentBalance;
  const projections = [];
  let totalExpectedInflows  = 0;
  let totalExpectedOutflows = 0;

  for (let i = 0; i <= days; i++) {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);

    const inflowEntry  = inflowsByDate.get(key);
    const outflowEntry = outflowsByDate.get(key);
    const dayInflows   = inflowEntry?.amount  ?? 0;
    const dayOutflows  = outflowEntry?.amount ?? 0;

    totalExpectedInflows  += dayInflows;
    totalExpectedOutflows += dayOutflows;

    const openingBalance  = runningBalance;
    runningBalance        = openingBalance + dayInflows - dayOutflows;

    projections.push({
      date:           key,
      openingBalance,
      inflows:        dayInflows,
      outflows:       dayOutflows,
      closingBalance: runningBalance,
      inflowLabels:   inflowEntry?.labels  ?? [],
      outflowLabels:  outflowEntry?.labels ?? [],
    });
  }

  res.json({
    clientId,
    currentBalance,
    days,
    totalExpectedInflows,
    totalExpectedOutflows,
    projections,
  });
});

export default router;
