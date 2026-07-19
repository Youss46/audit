import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, payrollSettingsTable, PAYROLL_SETTING_DEFAULTS } from "@workspace/db";
import {
  ListPayrollSettingsResponse,
  UpdatePayrollSettingBody,
  UpdatePayrollSettingParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeSetting(
  row: typeof payrollSettingsTable.$inferSelect,
  updatedByName?: string | null,
) {
  return {
    id: row.id,
    firmId: row.firmId,
    category: row.category,
    ruleName: row.ruleName,
    ruleKey: row.ruleKey,
    ratePercentage: row.ratePercentage ?? null,
    ceilingAmount: row.ceilingAmount ?? null,
    isEditable: row.isEditable,
    updatedById: row.updatedById ?? null,
    updatedByName: updatedByName ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Lazy-seed helper: ensure the firm has all canonical settings rows.
// Called automatically on GET so the table is always populated without
// requiring a manual seed step after each re-import.
// ---------------------------------------------------------------------------
async function ensureFirmSettingsSeeded(firmId: number): Promise<void> {
  const existing = await db.query.payrollSettingsTable.findFirst({
    where: eq(payrollSettingsTable.firmId, firmId),
    columns: { id: true },
  });
  if (existing) return;

  // First access: seed all statutory defaults for this firm.
  await db
    .insert(payrollSettingsTable)
    .values(
      PAYROLL_SETTING_DEFAULTS.map((d) => ({
        ...d,
        firmId,
        updatedById: null,
      })),
    )
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// GET /cabinet/payroll-settings
// Read-only access for all cabinet roles.
// Returns rows ordered by category then by id (insert order = statutory order).
// ---------------------------------------------------------------------------
router.get(
  "/cabinet/payroll-settings",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
    const firmId = req.user!.firmId;

    await ensureFirmSettingsSeeded(firmId);

    const rows = await db.query.payrollSettingsTable.findMany({
      where: eq(payrollSettingsTable.firmId, firmId),
      with: { updatedBy: true },
      orderBy: (t, { asc }) => [asc(t.category), asc(t.id)],
    });

    res.json(
      ListPayrollSettingsResponse.parse(
        rows.map((r) => serializeSetting(r, r.updatedBy?.fullName)),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// PUT /cabinet/payroll-settings/:id
// Restricted to expert_comptable and collaborateur.
// Only rows with isEditable = true may be modified.
// ---------------------------------------------------------------------------
router.put(
  "/cabinet/payroll-settings/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const { id } = UpdatePayrollSettingParams.parse(req.params);
    const body = UpdatePayrollSettingBody.parse(req.body);

    if (body.ratePercentage === undefined && body.ceilingAmount === undefined) {
      res.status(400).json({
        error: "Au moins un champ doit être fourni (ratePercentage ou ceilingAmount).",
      });
      return;
    }

    const existing = await db.query.payrollSettingsTable.findFirst({
      where: and(
        eq(payrollSettingsTable.id, id),
        eq(payrollSettingsTable.firmId, req.user!.firmId),
      ),
      with: { updatedBy: true },
    });

    if (!existing) {
      res.status(404).json({ error: "Paramètre introuvable." });
      return;
    }

    if (!existing.isEditable) {
      res.status(403).json({
        error:
          "Ce paramètre est fixé par la législation et ne peut pas être modifié manuellement.",
      });
      return;
    }

    // Validate rate is a sensible percentage (0–100 expressed as a fraction
    // 0–1, or expressed as a percentage 1–100 — we store fractions).
    if (body.ratePercentage !== undefined && body.ratePercentage !== null) {
      if (body.ratePercentage < 0 || body.ratePercentage > 1) {
        res.status(400).json({
          error:
            "Le taux doit être exprimé en fraction décimale (ex: 0.077 pour 7,7 %). Valeur invalide.",
        });
        return;
      }
    }

    if (body.ceilingAmount !== undefined && body.ceilingAmount !== null && body.ceilingAmount < 0) {
      res.status(400).json({ error: "Le plafond ne peut pas être négatif." });
      return;
    }

    const [updated] = await db
      .update(payrollSettingsTable)
      .set({
        ...(body.ratePercentage !== undefined ? { ratePercentage: body.ratePercentage } : {}),
        ...(body.ceilingAmount !== undefined ? { ceilingAmount: body.ceilingAmount } : {}),
        updatedById: req.user!.id,
      })
      .where(eq(payrollSettingsTable.id, id))
      .returning();

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.SETTINGS_UPDATE,
      entityType: "payroll_setting",
      entityId: id,
      details: `Paramètre de paie "${existing.ruleName}" (${existing.ruleKey}) mis à jour${
        body.ratePercentage !== undefined
          ? ` — taux : ${(body.ratePercentage! * 100).toFixed(3)} %`
          : ""
      }${
        body.ceilingAmount !== undefined
          ? ` — plafond : ${body.ceilingAmount?.toLocaleString("fr-FR")} FCFA`
          : ""
      }`,
      ipAddress: req.ip,
    });

    res.json(serializeSetting(updated, req.user!.fullName));
  },
);

export default router;
