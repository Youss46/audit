import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientsTable, employeesTable, payslipsTable, firmsTable } from "@workspace/db";
import {
  ListEmployeesQueryParams,
  ListEmployeesResponse,
  CreateEmployeeBody,
  CreateEmployeeResponse,
  GetEmployeeParams,
  GetEmployeeResponse,
  UpdateEmployeeParams,
  UpdateEmployeeBody,
  UpdateEmployeeResponse,
  CalculatePayrollParams,
  CalculatePayrollResponse,
  ListPayslipsQueryParams,
  ListPayslipsResponse,
  PostPayrollLedgerParams,
  PostPayrollLedgerResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import { calculatePayroll, computePrimeAnciennete, loadFirmPayrollRates, postPayrollLedger, PayrollAlreadyPostedError, NoPayslipsToPostError } from "../lib/payroll-engine";
import { generateCnpsBordereau } from "../lib/export-engine";
import { isPeriodLocked } from "../lib/closing-engine";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function serializeEmployee(
  employee: typeof employeesTable.$inferSelect,
  extra: { clientName?: string | null; createdByName?: string | null } = {},
) {
  return {
    id: employee.id,
    firmId: employee.firmId,
    clientId: employee.clientId,
    clientName: extra.clientName ?? null,
    firstName: employee.firstName,
    lastName: employee.lastName,
    cnpsNumber: employee.cnpsNumber ?? null,
    hireDate: employee.hireDate ?? null,
    maritalStatus: employee.maritalStatus,
    dependentChildren: employee.dependentChildren,
    baseSalary: employee.baseSalary,
    transportAllowance: employee.transportAllowance,
    otherTaxablePrimes: employee.otherTaxablePrimes,
    workAccidentRate: employee.workAccidentRate,
    status: employee.status,
    createdByName: extra.createdByName ?? null,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

function serializePayslip(
  payslip: typeof payslipsTable.$inferSelect,
  extra: { employeeName?: string } = {},
) {
  return {
    id: payslip.id,
    firmId: payslip.firmId,
    clientId: payslip.clientId,
    employeeId: payslip.employeeId,
    employeeName: extra.employeeName ?? null,
    period: payslip.period,
    grossSalary: payslip.grossSalary,
    grossTaxable: payslip.grossTaxable,
    primeAnciennete: payslip.primeAnciennete,
    cnpsEmployeeAmount: payslip.cnpsEmployeeAmount,
    isAmount: payslip.isAmount,
    cnAmount: payslip.cnAmount,
    itsAmount: payslip.itsAmount,
    netSalary: payslip.netSalary,
    cnpsEmployerRetraite: payslip.cnpsEmployerRetraite,
    cnpsEmployerPrestationsFamiliales: payslip.cnpsEmployerPrestationsFamiliales,
    cnpsEmployerAccidentTravail: payslip.cnpsEmployerAccidentTravail,
    taxeApprentissage: payslip.taxeApprentissage,
    taxeFormationContinue: payslip.taxeFormationContinue,
    totalEmployerCost: payslip.totalEmployerCost,
    fiscalParts: payslip.fiscalParts,
    postedTransactionId: payslip.postedTransactionId ?? null,
    createdAt: payslip.createdAt,
  };
}

// ---------------------------------------------------------------------------
// GET /employees — list employees for a client
// ---------------------------------------------------------------------------

router.get("/employees", async (req, res) => {
  const { clientId } = ListEmployeesQueryParams.parse(req.query);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const employees = await db.query.employeesTable.findMany({
    where: and(eq(employeesTable.firmId, req.user!.firmId), eq(employeesTable.clientId, clientId)),
    orderBy: (t, { asc }) => [asc(t.lastName), asc(t.firstName)],
    with: { createdBy: true },
  });

  res.json(
    ListEmployeesResponse.parse(
      employees.map((e) =>
        serializeEmployee(e, { clientName: client.name, createdByName: e.createdBy?.fullName }),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// POST /employees — register a new employee
// ---------------------------------------------------------------------------

router.post("/employees", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const body = CreateEmployeeBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  if (body.baseSalary <= 0) {
    res.status(400).json({ error: "Le salaire de base doit être strictement positif." });
    return;
  }

  const [employee] = await db
    .insert(employeesTable)
    .values({
      firmId: req.user!.firmId,
      clientId: body.clientId,
      firstName: body.firstName,
      lastName: body.lastName,
      cnpsNumber: body.cnpsNumber ?? null,
      hireDate: body.hireDate,
      maritalStatus: body.maritalStatus ?? "CELIBATAIRE",
      dependentChildren: body.dependentChildren ?? 0,
      baseSalary: body.baseSalary,
      transportAllowance: body.transportAllowance ?? 0,
      otherTaxablePrimes: body.otherTaxablePrimes ?? 0,
      workAccidentRate: body.workAccidentRate ?? 2,
      status: "ACTIF",
      createdById: req.user!.id,
    })
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.EMPLOYEE_CREATE,
    entityType: "employee",
    entityId: employee.id,
    details: `Employé "${body.firstName} ${body.lastName}" ajouté pour "${client.name}"`,
    ipAddress: req.ip,
  });

  res
    .status(201)
    .json(
      CreateEmployeeResponse.parse(
        serializeEmployee(employee, { clientName: client.name, createdByName: req.user!.fullName }),
      ),
    );
});

// ---------------------------------------------------------------------------
// GET /employees/:id
// ---------------------------------------------------------------------------

router.get("/employees/:id", async (req, res) => {
  const { id } = GetEmployeeParams.parse(req.params);

  const employee = await db.query.employeesTable.findFirst({
    where: and(eq(employeesTable.id, id), eq(employeesTable.firmId, req.user!.firmId)),
    with: { client: true, createdBy: true },
  });
  if (!employee) {
    res.status(404).json({ error: "Employé introuvable." });
    return;
  }

  res.json(
    GetEmployeeResponse.parse(
      serializeEmployee(employee, {
        clientName: employee.client?.name,
        createdByName: employee.createdBy?.fullName,
      }),
    ),
  );
});

// ---------------------------------------------------------------------------
// PATCH /employees/:id — update profile, salary components, or status
// (used both for edits and to (dés)activer an employee — no hard delete,
// so payslip history always keeps a valid employee reference).
// ---------------------------------------------------------------------------

router.patch("/employees/:id", requireRole("expert_comptable", "collaborateur"), async (req, res) => {
  const { id } = UpdateEmployeeParams.parse(req.params);
  const body = UpdateEmployeeBody.parse(req.body);

  const existing = await db.query.employeesTable.findFirst({
    where: and(eq(employeesTable.id, id), eq(employeesTable.firmId, req.user!.firmId)),
    with: { client: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Employé introuvable." });
    return;
  }

  if (body.baseSalary !== undefined && body.baseSalary <= 0) {
    res.status(400).json({ error: "Le salaire de base doit être strictement positif." });
    return;
  }

  const [updated] = await db
    .update(employeesTable)
    .set({
      firstName: body.firstName ?? existing.firstName,
      lastName: body.lastName ?? existing.lastName,
      cnpsNumber: body.cnpsNumber !== undefined ? body.cnpsNumber : existing.cnpsNumber,
      hireDate: body.hireDate !== undefined ? body.hireDate : existing.hireDate,
      maritalStatus: body.maritalStatus ?? existing.maritalStatus,
      dependentChildren: body.dependentChildren ?? existing.dependentChildren,
      baseSalary: body.baseSalary ?? existing.baseSalary,
      transportAllowance: body.transportAllowance ?? existing.transportAllowance,
      otherTaxablePrimes: body.otherTaxablePrimes ?? existing.otherTaxablePrimes,
      workAccidentRate: body.workAccidentRate ?? existing.workAccidentRate,
      status: body.status ?? existing.status,
    })
    .where(eq(employeesTable.id, id))
    .returning();

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.EMPLOYEE_UPDATE,
    entityType: "employee",
    entityId: id,
    details: `Employé "${updated.firstName} ${updated.lastName}" mis à jour`,
    ipAddress: req.ip,
  });

  res.json(
    UpdateEmployeeResponse.parse(
      serializeEmployee(updated, { clientName: existing.client?.name, createdByName: req.user!.fullName }),
    ),
  );
});

// ---------------------------------------------------------------------------
// GET /payslips — list calculated payslips for a client/period
// ---------------------------------------------------------------------------

router.get("/payslips", async (req, res) => {
  const { clientId, period } = ListPayslipsQueryParams.parse(req.query);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  const payslips = await db.query.payslipsTable.findMany({
    where: and(
      eq(payslipsTable.firmId, req.user!.firmId),
      eq(payslipsTable.clientId, clientId),
      ...(period ? [eq(payslipsTable.period, period)] : []),
    ),
    orderBy: (t, { desc }) => [desc(t.period)],
    with: { employee: true },
  });

  res.json(
    ListPayslipsResponse.parse(
      payslips.map((p) =>
        serializePayslip(p, { employeeName: `${p.employee?.firstName} ${p.employee?.lastName}` }),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// POST /payroll/calculate/:clientId/:period — bulk payroll processing:
// runs the CNPS/ITS engine for every active employee of the client
// and upserts one payslip per employee for that period. Recalculating an
// un-posted period simply replaces the previous figures (e.g. after
// editing an employee's salary) — already-posted payslips are frozen and
// skipped so a validated ledger entry never silently drifts from its source.
// ---------------------------------------------------------------------------

router.post(
  "/payroll/calculate/:clientId/:period",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { clientId, period } = CalculatePayrollParams.parse(req.params);

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      res.status(400).json({ error: "Période invalide (format attendu : AAAA-MM)." });
      return;
    }

    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    const periodYear = Number(period.slice(0, 4));
    if (await isPeriodLocked(req.user!.firmId, clientId, periodYear)) {
      res.status(403).json({
        error: `L'exercice ${periodYear} est définitivement clôturé. La paie ne peut plus être calculée pour cette période.`,
      });
      return;
    }

    const [activeEmployees, firmRates] = await Promise.all([
      db.query.employeesTable.findMany({
        where: and(
          eq(employeesTable.firmId, req.user!.firmId),
          eq(employeesTable.clientId, clientId),
          eq(employeesTable.status, "ACTIF"),
        ),
      }),
      // Load firm-specific payroll rates from DB (falls back to statutory defaults)
      loadFirmPayrollRates(req.user!.firmId),
    ]);

    const results: ReturnType<typeof serializePayslip>[] = [];
    const skipped: Array<{ employeeId: number; employeeName: string; reason: string }> = [];

    for (const employee of activeEmployees) {
      const existingPayslip = await db.query.payslipsTable.findFirst({
        where: and(eq(payslipsTable.employeeId, employee.id), eq(payslipsTable.period, period)),
      });
      if (existingPayslip?.postedTransactionId) {
        skipped.push({
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          reason: "Bulletin déjà comptabilisé pour cette période — non recalculé.",
        });
        continue;
      }

      const calc = calculatePayroll(
        {
          baseSalary: employee.baseSalary,
          transportAllowance: employee.transportAllowance,
          otherTaxablePrimes: employee.otherTaxablePrimes,
          primeAnciennete: computePrimeAnciennete(employee.baseSalary, employee.hireDate ?? null, period),
          maritalStatus: employee.maritalStatus,
          dependentChildren: employee.dependentChildren,
          workAccidentRate: employee.workAccidentRate,
        },
        firmRates,
      );

      const values = {
        firmId: req.user!.firmId,
        clientId,
        employeeId: employee.id,
        period,
        ...calc,
        createdById: req.user!.id,
      };

      const [payslip] = existingPayslip
        ? await db
            .update(payslipsTable)
            .set(values)
            .where(eq(payslipsTable.id, existingPayslip.id))
            .returning()
        : await db.insert(payslipsTable).values(values).returning();

      results.push(
        serializePayslip(payslip, { employeeName: `${employee.firstName} ${employee.lastName}` }),
      );
    }

    res.json(
      CalculatePayrollResponse.parse({
        clientId,
        period,
        payslips: results,
        skipped,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// POST /payroll/post-ledger/:clientId/:period — validate & post the
// aggregated OD journal entry for every calculated payslip of the period.
// ---------------------------------------------------------------------------

router.post(
  "/payroll/post-ledger/:clientId/:period",
  requireRole("expert_comptable"),
  async (req, res) => {
    const { clientId, period } = PostPayrollLedgerParams.parse(req.params);

    const client = await db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
    });
    if (!client) {
      res.status(404).json({ error: "Client introuvable." });
      return;
    }

    const periodYear = Number(period.slice(0, 4));
    if (await isPeriodLocked(req.user!.firmId, clientId, periodYear)) {
      res.status(403).json({
        error: `L'exercice ${periodYear} est définitivement clôturé. La paie ne peut plus être comptabilisée pour cette période.`,
      });
      return;
    }

    try {
      const result = await postPayrollLedger(req.user!.firmId, clientId, period, req.user!.id);

      await logAudit({
        firmId: req.user!.firmId,
        userId: req.user!.id,
        userName: req.user!.fullName,
        userRole: req.user!.role,
        action: AuditAction.PAYROLL_POST,
        entityType: "payroll",
        entityId: `${clientId}/${period}`,
        details: `Paie du mois ${period} comptabilisée pour "${client.name}" — ${result.payslipsPosted} bulletin(s), écriture #${result.transactionId}.`,
        ipAddress: req.ip,
      });

      res.json(PostPayrollLedgerResponse.parse(result));
    } catch (err) {
      if (err instanceof PayrollAlreadyPostedError || err instanceof NoPayslipsToPostError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// GET /payroll/cnps-bordereau/:clientId/:period
// Génère et télécharge le bordereau CNPS mensuel au format PDF.
// ---------------------------------------------------------------------------

router.get("/payroll/cnps-bordereau/:clientId/:period", async (req, res) => {
  const clientId = Number(req.params.clientId);
  const period = req.params.period; // YYYY-MM

  if (!clientId || !/^\d{4}-\d{2}$/.test(period)) {
    res.status(400).json({ error: "Paramètres invalides (clientId ou période)." });
    return;
  }

  const [client, firm] = await Promise.all([
    db.query.clientsTable.findFirst({
      where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, req.user!.firmId)),
    }),
    db.query.firmsTable.findFirst({
      where: eq(firmsTable.id, req.user!.firmId),
    }),
  ]);

  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }

  // Récupérer les bulletins du mois + les employés du client
  const [payslips, employees] = await Promise.all([
    db.query.payslipsTable.findMany({
      where: and(
        eq(payslipsTable.firmId, req.user!.firmId),
        eq(payslipsTable.clientId, clientId),
        eq(payslipsTable.period, period),
      ),
    }),
    db.query.employeesTable.findMany({
      where: and(
        eq(employeesTable.firmId, req.user!.firmId),
        eq(employeesTable.clientId, clientId),
      ),
    }),
  ]);

  if (payslips.length === 0) {
    res.status(404).json({
      error: `Aucun bulletin de paie trouvé pour la période ${period}. Calculez d'abord la paie du mois.`,
    });
    return;
  }

  const empMap = new Map(employees.map((e) => [e.id, e]));

  const rows = payslips.map((p) => {
    const emp = empMap.get(p.employeeId);
    const totalEmployer =
      p.cnpsEmployerRetraite +
      p.cnpsEmployerPrestationsFamiliales +
      p.cnpsEmployerAccidentTravail;
    return {
      employeeName: emp
        ? `${emp.lastName.toUpperCase()} ${emp.firstName}`
        : `Employé #${p.employeeId}`,
      cnpsNumber: emp?.cnpsNumber ?? null,
      grossCapped: p.grossTaxable,
      cnpsEmployee: p.cnpsEmployeeAmount,
      cnpsEmployerRetraite: p.cnpsEmployerRetraite,
      cnpsEmployerPf: p.cnpsEmployerPrestationsFamiliales,
      cnpsEmployerAt: p.cnpsEmployerAccidentTravail,
      totalEmployer,
      totalCnps: p.cnpsEmployeeAmount + totalEmployer,
    };
  });

  // Trier par nom
  rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const pdfBuffer = await generateCnpsBordereau({
    firmName: firm?.name ?? "Cabinet",
    clientName: client.name,
    period,
    rows,
  });

  const safeName = client.name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="bordereau-cnps-${safeName}-${period}.pdf"`,
    "Content-Length": String(pdfBuffer.length),
    "Cache-Control": "no-store",
  });
  res.end(pdfBuffer);
});

export default router;
