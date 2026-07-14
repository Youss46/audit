import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, vatSettingsTable, VAT_SETTING_DEFAULTS } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";

const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Validation helpers (plain JS — no external schema library needed here since
// vat-settings is not part of the OpenAPI/Orval generated contract).
// ---------------------------------------------------------------------------

// Account numbers must be 4–8 digit SYSCOHADA codes.
const ACCOUNT_RE = /^\d{4,8}$/;

interface UpdateVatSettingBodyParsed {
  ratePercentage?: number;
  salesAccount?: string | null;
  purchaseAccount?: string | null;
  isActive?: boolean;
}

function parseUpdateBody(
  raw: unknown,
): { ok: true; data: UpdateVatSettingBodyParsed } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Corps de requête invalide." };
  }
  const body = raw as Record<string, unknown>;

  const result: UpdateVatSettingBodyParsed = {};

  if ("ratePercentage" in body) {
    const v = body["ratePercentage"];
    if (typeof v !== "number" || isNaN(v) || v < 0 || v > 100) {
      return { ok: false, error: "Le taux doit être un nombre entre 0 et 100." };
    }
    result.ratePercentage = v;
  }

  for (const field of ["salesAccount", "purchaseAccount"] as const) {
    if (field in body) {
      const v = body[field];
      if (v === null) {
        result[field] = null;
      } else if (typeof v === "string") {
        if (!ACCOUNT_RE.test(v)) {
          return {
            ok: false,
            error: `Le compte ${field === "salesAccount" ? "TVA collectée" : "TVA déductible"} doit être un code SYSCOHADA de 4 à 8 chiffres.`,
          };
        }
        result[field] = v;
      } else {
        return { ok: false, error: `Champ ${field} invalide.` };
      }
    }
  }

  if ("isActive" in body) {
    if (typeof body["isActive"] !== "boolean") {
      return { ok: false, error: "Le champ isActive doit être un booléen." };
    }
    result.isActive = body["isActive"];
  }

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeSetting(
  row: typeof vatSettingsTable.$inferSelect,
  updatedByName?: string | null,
) {
  return {
    id: row.id,
    firmId: row.firmId,
    code: row.code,
    label: row.label,
    ratePercentage: row.ratePercentage,
    salesAccount: row.salesAccount ?? null,
    purchaseAccount: row.purchaseAccount ?? null,
    isActive: row.isActive,
    isEditable: row.isEditable,
    updatedById: row.updatedById ?? null,
    updatedByName: updatedByName ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Lazy-seed: ensure this firm has all canonical VAT setting rows.
// Called automatically on GET so the table is always populated without a
// manual migration step after each re-import or new-firm creation.
// ---------------------------------------------------------------------------
async function ensureFirmVatSettingsSeeded(firmId: number): Promise<void> {
  const existing = await db.query.vatSettingsTable.findFirst({
    where: eq(vatSettingsTable.firmId, firmId),
    columns: { id: true },
  });
  if (existing) return;

  await db
    .insert(vatSettingsTable)
    .values(
      VAT_SETTING_DEFAULTS.map((d) => ({
        ...d,
        firmId,
        updatedById: null,
      })),
    )
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// GET /cabinet/vat-settings
// Readable by all authenticated users (cabinet staff + PME portal roles).
// PME users need this to populate VAT-rate dropdown menus on their invoices.
// Returns rows ordered by ratePercentage descending (18%, 9%, 0%).
// ---------------------------------------------------------------------------
router.get("/cabinet/vat-settings", async (req, res) => {
  const firmId = req.user!.firmId;

  await ensureFirmVatSettingsSeeded(firmId);

  const rows = await db.query.vatSettingsTable.findMany({
    where: eq(vatSettingsTable.firmId, firmId),
    with: { updatedBy: true },
    orderBy: (t, { desc }) => [desc(t.ratePercentage)],
  });

  res.json(rows.map((r) => serializeSetting(r, r.updatedBy?.fullName)));
});

// ---------------------------------------------------------------------------
// PUT /cabinet/vat-settings/:id
// Restricted to expert_comptable and collaborateur.
// Only rows with isEditable = true may be modified.
// The stable `code` and `label` fields are never changed via this endpoint.
// ---------------------------------------------------------------------------
router.put(
  "/cabinet/vat-settings/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const idRaw = parseInt(String(req.params["id"]), 10);
    if (isNaN(idRaw) || idRaw <= 0) {
      res.status(400).json({ error: "Identifiant invalide." });
      return;
    }
    const id = idRaw;

    const parsed = parseUpdateBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const body = parsed.data;

    if (
      body.ratePercentage === undefined &&
      body.salesAccount === undefined &&
      body.purchaseAccount === undefined &&
      body.isActive === undefined
    ) {
      res.status(400).json({
        error: "Au moins un champ doit être fourni (taux, compte TVA ou statut actif).",
      });
      return;
    }

    const existing = await db.query.vatSettingsTable.findFirst({
      where: and(
        eq(vatSettingsTable.id, id),
        eq(vatSettingsTable.firmId, req.user!.firmId),
      ),
      with: { updatedBy: true },
    });

    if (!existing) {
      res.status(404).json({ error: "Paramètre TVA introuvable." });
      return;
    }

    if (!existing.isEditable) {
      res.status(403).json({
        error:
          "Ce code TVA est fixé par la législation fiscale ivoirienne et ne peut pas être modifié manuellement. Contactez l'administration fiscale (DGI) pour toute modification réglementaire.",
      });
      return;
    }

    // Guard: a TVA code with a sales account must have a sensible rate (> 0).
    // A zero-rate code (exonéré) should not be assigned VAT collection accounts.
    if (
      body.salesAccount !== undefined &&
      body.salesAccount !== null &&
      (body.ratePercentage ?? existing.ratePercentage) === 0
    ) {
      res.status(400).json({
        error:
          "Un code exonéré (taux 0 %) ne peut pas avoir de compte TVA collectée. Laissez le compte vide pour les opérations exonérées.",
      });
      return;
    }

    const [updated] = await db
      .update(vatSettingsTable)
      .set({
        ...(body.ratePercentage !== undefined ? { ratePercentage: body.ratePercentage } : {}),
        ...(body.salesAccount !== undefined ? { salesAccount: body.salesAccount } : {}),
        ...(body.purchaseAccount !== undefined ? { purchaseAccount: body.purchaseAccount } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedById: req.user!.id,
      })
      .where(eq(vatSettingsTable.id, id))
      .returning();

    // Build a human-readable change summary for the audit log.
    const changes: string[] = [];
    if (body.ratePercentage !== undefined)
      changes.push(`taux : ${body.ratePercentage} %`);
    if (body.salesAccount !== undefined)
      changes.push(`compte TVA collectée : ${body.salesAccount ?? "supprimé"}`);
    if (body.purchaseAccount !== undefined)
      changes.push(`compte TVA déductible : ${body.purchaseAccount ?? "supprimé"}`);
    if (body.isActive !== undefined)
      changes.push(`statut : ${body.isActive ? "Actif" : "Inactif"}`);

    await logAudit({
      firmId: req.user!.firmId,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userRole: req.user!.role,
      action: AuditAction.SETTINGS_UPDATE,
      entityType: "vat_setting",
      entityId: id,
      details: `Paramètre TVA "${existing.label}" (${existing.code}) mis à jour — ${changes.join("; ")}`,
      ipAddress: req.ip,
    });

    res.json(serializeSetting(updated, req.user!.fullName));
  },
);

export default router;
