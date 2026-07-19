import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import {
  checklistItemsTable,
  clientsTable,
  db,
  missionsTable,
  usersTable,
  isPortalRole,
} from "@workspace/db";
import {
  ListMissionsQueryParams,
  ListMissionsResponse,
  CreateMissionBody,
  CreateMissionResponse,
  GetMissionParams,
  GetMissionResponse,
  UpdateMissionParams,
  UpdateMissionBody,
  UpdateMissionResponse,
  ListMissionChecklistItemsParams,
  ListMissionChecklistItemsResponse,
  UpdateMissionChecklistItemParams,
  UpdateMissionChecklistItemBody,
  UpdateMissionChecklistItemResponse,
} from "@workspace/api-zod";
import { requireAuth, requireOwnClient, requireRole } from "../middlewares/auth";
import { AuditAction, logAudit } from "../lib/audit";
import {
  assertValidMissionTransition,
  determineAccountingSystem,
  generateChecklistLabels,
  generateVisaStampCode,
  VisaWorkflowError,
} from "../lib/visa-engine";
import { fetchValidatedLedgerLines, fetchAnomalyTransactions } from "../lib/ledger";
import { computeBalanceDesComptes } from "../lib/reporting-engine";

// ---------------------------------------------------------------------------
// AI checklist analysis — shape of each item returned to the frontend
// ---------------------------------------------------------------------------
interface AIChecklistResult {
  checklist_item_id: number;
  label: string;
  status: "CONFORME" | "ALERTE" | "NON_APPLICABLE";
  justification: string;
}

// SYSCOHADA auditor system prompt — all data in English, all output in French
const CHECKLIST_SYSTEM_PROMPT = `You are a senior SYSCOHADA-certified auditor with 20 years of experience in West African accounting, operating under OHADA Uniform Acts.

You will receive:
1. A client profile (name, sector, annual turnover, accounting system, fiscal year)
2. A Balance des Comptes (trial balance) for the fiscal year
3. Key financial metrics
4. A list of anomalous transactions flagged by the system
5. A numbered list of SYSCOHADA control checklist items, each with an "id" and a "label"

YOUR TASK: For each checklist item, analyze the trial balance and metrics to determine if the requirement is satisfied.

CLASSIFICATION RULES:
- "CONFORME": The ledger evidence clearly satisfies this control point. There is a positive finding supported by specific account data.
- "ALERTE": Evidence is missing, contradictory, or raises a significant audit concern. Flag specific account numbers and amounts.
- "NON_APPLICABLE": The control point is structurally inapplicable to this client (e.g., no foreign operations for an FX check, no subsidiaries for a consolidation check). Only use this when it is truly irrelevant — never as a shortcut.

RESPONSE FORMAT: Return ONLY a valid JSON array with exactly one object per checklist item. No markdown, no prose outside the array.

Schema:
[
  {
    "checklist_item_id": <integer — the id field from the input item>,
    "status": "CONFORME" | "ALERTE" | "NON_APPLICABLE",
    "justification": "<2-4 sentences in pristine professional French. For CONFORME: cite the specific accounts and amounts that confirm compliance. For ALERTE: name the exact accounts, amounts, and the specific irregularity. For NON_APPLICABLE: one concise sentence stating why it does not apply.>"
  }
]

LANGUAGE RULE: The "justification" field must always be written in formal, professional French suitable for an audit dossier. Account numbers must be cited when relevant (e.g., "Le compte 521100 présente un solde débiteur de 4 250 000 FCFA").`;

function buildChecklistPrompt(
  client: { name: string; sector: string; annualTurnover: number; accountingSystem: string },
  fiscalYear: number,
  balance: ReturnType<typeof computeBalanceDesComptes>,
  anomalyCount: number,
  checklistItems: { id: number; label: string }[],
): string {
  const totalRevenue  = balance.filter((r) => r.accountNumber.startsWith("7")).reduce((s, r) => s + r.finalBalance, 0);
  const totalExpenses = balance.filter((r) => r.accountNumber.startsWith("6")).reduce((s, r) => s + r.finalBalance, 0);
  const expenseRatio  = totalRevenue > 0 ? ((totalExpenses / totalRevenue) * 100).toFixed(1) : "N/A";

  const negativeCash = balance
    .filter((r) => r.accountNumber.startsWith("5") && r.finalBalanceSide === "crediteur")
    .map((r) => `${r.accountNumber} (${r.accountName}): solde créditeur = ${r.finalBalance.toLocaleString("fr-FR")} FCFA`);

  const balanceSummary = balance
    .map((r) =>
      `${r.accountNumber} | ${r.accountName} | D=${r.totalDebit.toLocaleString("fr-FR")} | C=${r.totalCredit.toLocaleString("fr-FR")} | ${r.finalBalanceSide === "crediteur" ? "SC" : "SD"}=${r.finalBalance.toLocaleString("fr-FR")}`,
    )
    .join("\n");

  return `=== CLIENT PROFILE ===
Name: ${client.name}
Sector: ${client.sector}
Annual Turnover: ${client.annualTurnover.toLocaleString("fr-FR")} XOF
SYSCOHADA Accounting System: ${client.accountingSystem}
Fiscal Year Under Review: ${fiscalYear}

=== BALANCE DES COMPTES — ${balance.length} accounts ===
Account | Name | Total Debit | Total Credit | Balance (SD=debiteur, SC=crediteur)
${balanceSummary}

=== KEY FINANCIAL METRICS ===
Total Revenue (Class 7): ${totalRevenue.toLocaleString("fr-FR")} XOF
Total Expenses (Class 6): ${totalExpenses.toLocaleString("fr-FR")} XOF
Expense-to-Revenue Ratio: ${expenseRatio}%
Anomaly-flagged Transactions: ${anomalyCount}
Cash Violations (negative Class 5 balances): ${negativeCash.length > 0 ? negativeCash.join("; ") : "None detected"}

=== CONTROL CHECKLIST TO EVALUATE ===
${JSON.stringify(checklistItems.map((i) => ({ id: i.id, label: i.label })), null, 2)}

Now evaluate every checklist item and return the JSON array.`;
}

const router: IRouter = Router();

router.use(requireAuth);

async function withCounts(
  mission: typeof missionsTable.$inferSelect,
  client?: typeof clientsTable.$inferSelect | null,
  assignedToName?: string | null,
) {
  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, mission.id),
  });
  return {
    id: mission.id,
    firmId: mission.firmId,
    clientId: mission.clientId,
    clientName: client?.name ?? null,
    clientLegalForm: client?.legalForm ?? null,
    clientSector: client?.sector ?? null,
    clientAnnualTurnover: client?.annualTurnover ?? null,
    fiscalYear: mission.fiscalYear,
    accountingSystem: mission.accountingSystem,
    status: mission.status,
    checklistTotal: items.length,
    checklistCompleted: items.filter((i) => i.status === "conforme").length,
    assignedToId: mission.assignedToId ?? null,
    assignedToName: assignedToName ?? null,
    visaStampCode: mission.visaStampCode ?? null,
    visaIssuedAt: mission.visaIssuedAt ?? null,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  };
}

// Applies the checklist's current anomaly state to the mission (and its
// client) automatically: entering "anomalie" as soon as any item is flagged,
// and returning to "en_cours" once every anomaly has been resolved. This is
// the system-driven half of the visa status state machine.
async function syncMissionAnomalyState(mission: typeof missionsTable.$inferSelect) {
  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, mission.id),
  });
  const hasAnomalies = items.some((i) => i.status === "anomalie");

  let nextStatus = mission.status;
  if (hasAnomalies && mission.status === "en_cours") {
    nextStatus = "anomalie";
  } else if (!hasAnomalies && mission.status === "anomalie") {
    nextStatus = "en_cours";
  }

  if (nextStatus === mission.status) return mission;

  const [updated] = await db
    .update(missionsTable)
    .set({ status: nextStatus })
    .where(eq(missionsTable.id, mission.id))
    .returning();
  await db
    .update(clientsTable)
    .set({ missionStatus: nextStatus })
    .where(eq(clientsTable.id, mission.clientId));

  return updated;
}

router.get("/missions", async (req, res) => {
  const { clientId, status } = ListMissionsQueryParams.parse(req.query);

  // Espace PME (client_pme) accounts only ever see missions for their own
  // client dossier, regardless of what clientId was requested.
  if (isPortalRole(req.user!.role)) {
    if (!req.user!.clientId || (clientId && clientId !== req.user!.clientId)) {
      res.json(ListMissionsResponse.parse([]));
      return;
    }
  }
  const effectiveClientId = isPortalRole(req.user!.role) ? req.user!.clientId! : clientId;

  const conditions = [eq(missionsTable.firmId, req.user!.firmId)];
  if (effectiveClientId) conditions.push(eq(missionsTable.clientId, effectiveClientId));
  if (status) conditions.push(eq(missionsTable.status, status));

  const missions = await db.query.missionsTable.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { client: true, assignedTo: true },
  });

  const results = await Promise.all(
    missions.map((m) => withCounts(m, m.client, m.assignedTo?.fullName)),
  );

  res.json(ListMissionsResponse.parse(results));
});

// Opens a new visa mission: auto-determines the SYSCOHADA accounting system
// from the client's sector/turnover and generates the matching control
// checklist (module M4/P2).
router.post(
  "/missions",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
  const body = CreateMissionBody.parse(req.body);

  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, body.clientId), eq(clientsTable.firmId, req.user!.firmId)),
  });
  if (!client) {
    res.status(404).json({ error: "Client introuvable." });
    return;
  }
  if (client.annualTurnover == null) {
    res.status(422).json({
      error:
        "Le chiffre d'affaires annuel du client doit être renseigné avant d'ouvrir une mission.",
    });
    return;
  }

  let assignedTo: typeof usersTable.$inferSelect | null = null;
  if (body.assignedToId != null) {
    assignedTo =
      (await db.query.usersTable.findFirst({
        where: and(eq(usersTable.id, body.assignedToId), eq(usersTable.firmId, req.user!.firmId)),
      })) ?? null;
    if (!assignedTo) {
      res.status(404).json({ error: "Collaborateur assigné introuvable." });
      return;
    }
  }

  const accountingSystem = determineAccountingSystem(client.sector, client.annualTurnover);

  const [mission] = await db
    .insert(missionsTable)
    .values({
      firmId: req.user!.firmId,
      clientId: client.id,
      fiscalYear: body.fiscalYear,
      accountingSystem,
      status: "en_attente",
      createdById: req.user!.id,
      assignedToId: assignedTo?.id ?? null,
    })
    .returning();

  const labels = generateChecklistLabels(accountingSystem);
  await db.insert(checklistItemsTable).values(
    labels.map((label, index) => ({
      missionId: mission.id,
      orderIndex: index,
      label,
      status: "a_verifier" as const,
    })),
  );

  await db
    .update(clientsTable)
    .set({ accountingSystem, missionStatus: "en_attente" })
    .where(eq(clientsTable.id, client.id));

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: AuditAction.MISSION_CREATE,
    entityType: "mission",
    entityId: mission.id,
    details: `Ouverture de la mission ${body.fiscalYear} pour "${client.name}" (système ${accountingSystem})`,
    ipAddress: req.ip,
  });

  res
    .status(201)
    .json(CreateMissionResponse.parse(await withCounts(mission, client, assignedTo?.fullName)));
});

router.get("/missions/:id", async (req, res) => {
  const { id } = GetMissionParams.parse(req.params);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
    with: { client: true, assignedTo: true },
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, mission.clientId)) return;

  const checklist = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, id),
    orderBy: (t, { asc }) => [asc(t.orderIndex)],
  });

  const counts = await withCounts(mission, mission.client, mission.assignedTo?.fullName);
  res.json(GetMissionResponse.parse({ ...counts, checklist }));
});

router.patch(
  "/missions/:id",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
  const { id } = UpdateMissionParams.parse(req.params);
  const body = UpdateMissionBody.parse(req.body);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
    with: { client: true },
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }

  let assignedTo: typeof usersTable.$inferSelect | null = null;
  if (body.assignedToId !== undefined && body.assignedToId !== null) {
    assignedTo =
      (await db.query.usersTable.findFirst({
        where: and(eq(usersTable.id, body.assignedToId), eq(usersTable.firmId, req.user!.firmId)),
      })) ?? null;
    if (!assignedTo) {
      res.status(404).json({ error: "Collaborateur assigné introuvable." });
      return;
    }
  }

  // Only the Expert-comptable (cabinet owner) may issue the final digital
  // Visa stamp -- a Collaborateur can bring the dossier to "valide" but
  // cannot perform the emission itself.
  if (body.status === "visa_emis" && req.user!.role !== "expert_comptable") {
    res.status(403).json({
      error: "Seul l'expert-comptable peut émettre le visa numérique.",
    });
    return;
  }

  let extraUpdates: Partial<typeof missionsTable.$inferInsert> = {};

  if (body.status && body.status !== mission.status) {
    const items = await db.query.checklistItemsTable.findMany({
      where: eq(checklistItemsTable.missionId, id),
    });
    const hasAnomalies = items.some((i) => i.status === "anomalie");
    const allConform = items.length > 0 && items.every((i) => i.status === "conforme");

    try {
      assertValidMissionTransition(mission.status, body.status, { allConform, hasAnomalies });
    } catch (err) {
      if (err instanceof VisaWorkflowError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Mock the emission of the digital visa stamp when the mission finally
    // reaches "visa_emis".
    if (body.status === "visa_emis") {
      extraUpdates = {
        visaStampCode: generateVisaStampCode(mission.fiscalYear, mission.id),
        visaIssuedAt: new Date(),
      };
    }
  }

  const [updated] = await db
    .update(missionsTable)
    .set({ ...body, ...extraUpdates })
    .where(eq(missionsTable.id, id))
    .returning();

  if (body.status) {
    await db
      .update(clientsTable)
      .set({ missionStatus: body.status })
      .where(eq(clientsTable.id, mission.clientId));
  }

  const assignedToName =
    body.assignedToId !== undefined
      ? assignedTo?.fullName ?? null
      : (
          await db.query.usersTable.findFirst({
            where: eq(usersTable.id, updated.assignedToId ?? -1),
          })
        )?.fullName ?? null;

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: body.status === "visa_emis" ? AuditAction.VISA_ISSUED : AuditAction.MISSION_UPDATE,
    entityType: "mission",
    entityId: id,
    details: body.status ? `Statut mis à jour : ${body.status}` : undefined,
    ipAddress: req.ip,
  });

  res.json(
    UpdateMissionResponse.parse(await withCounts(updated, mission.client, assignedToName)),
  );
});

router.get("/missions/:id/checklist", async (req, res) => {
  const { id } = ListMissionChecklistItemsParams.parse(req.params);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }
  if (!requireOwnClient(req, res, mission.clientId)) return;

  const items = await db.query.checklistItemsTable.findMany({
    where: eq(checklistItemsTable.missionId, id),
    orderBy: (t, { asc }) => [asc(t.orderIndex)],
  });

  res.json(ListMissionChecklistItemsResponse.parse(items));
});

router.patch(
  "/missions/:id/checklist/:itemId",
  requireRole("expert_comptable", "collaborateur", "stagiaire"),
  async (req, res) => {
  const { id, itemId } = UpdateMissionChecklistItemParams.parse(req.params);
  const body = UpdateMissionChecklistItemBody.parse(req.body);

  const mission = await db.query.missionsTable.findFirst({
    where: and(eq(missionsTable.id, id), eq(missionsTable.firmId, req.user!.firmId)),
  });
  if (!mission) {
    res.status(404).json({ error: "Mission introuvable." });
    return;
  }
  if (mission.status === "visa_emis") {
    res.status(409).json({
      error: "Le visa a déjà été émis : la grille de contrôle est verrouillée.",
    });
    return;
  }

  const item = await db.query.checklistItemsTable.findFirst({
    where: and(eq(checklistItemsTable.id, itemId), eq(checklistItemsTable.missionId, id)),
  });
  if (!item) {
    res.status(404).json({ error: "Élément de checklist introuvable." });
    return;
  }

  // Stagiaire has read-only access to the checklist: they may fill in a
  // draft observation (the `note` field) but cannot validate a control
  // point (change its `status` to conforme/anomalie).
  if (req.user!.role === "stagiaire" && body.status !== undefined) {
    res.status(403).json({
      error:
        "Les stagiaires ne peuvent pas valider les points de contrôle, uniquement ajouter des observations.",
    });
    return;
  }

  // Flagging a control point as an anomaly always requires a justification
  // comment so the accountant knows what to fix before the visa can be issued.
  if (body.status === "anomalie") {
    const note = (body.note ?? item.note ?? "").trim();
    if (!note) {
      res.status(400).json({
        error:
          "Un commentaire est obligatoire pour signaler une anomalie sur ce point de contrôle.",
      });
      return;
    }
  }

  const [updated] = await db
    .update(checklistItemsTable)
    .set(body)
    .where(eq(checklistItemsTable.id, itemId))
    .returning();

  // Reflect the checklist's anomaly state onto the mission/client status
  // automatically (system-driven part of the visa workflow state machine).
  await syncMissionAnomalyState(mission);

  await logAudit({
    firmId: req.user!.firmId,
    userId: req.user!.id,
    userName: req.user!.fullName,
    userRole: req.user!.role,
    action: body.status !== undefined ? AuditAction.CHECKLIST_VALIDATE : AuditAction.CHECKLIST_NOTE,
    entityType: "checklist_item",
    entityId: itemId,
    details: body.status ? `"${item.label}" -> ${body.status}` : undefined,
    ipAddress: req.ip,
  });

  res.json(UpdateMissionChecklistItemResponse.parse(updated));
});

// ---------------------------------------------------------------------------
// POST /missions/:id/analyze
// AI-powered checklist pre-fill: calls Gemini to evaluate each control point
// against the client's trial balance for the mission's fiscal year.
//
// CONFORME items are automatically applied to the DB (status = "conforme",
// note = AI justification). ALERTE / NON_APPLICABLE items are returned as-is
// for the accountant to review and act on manually.
// ---------------------------------------------------------------------------
router.post(
  "/missions/:id/analyze",
  requireRole("expert_comptable", "collaborateur"),
  async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "GEMINI_API_KEY n'est pas configuré sur ce serveur." });
      return;
    }

    // ── 1. Fetch mission + checklist items ──────────────────────────────────
    const missionId = parseInt(String(req.params.id), 10);
    if (isNaN(missionId)) {
      res.status(400).json({ error: "Identifiant de mission invalide." });
      return;
    }

    const mission = await db.query.missionsTable.findFirst({
      where: and(eq(missionsTable.id, missionId), eq(missionsTable.firmId, req.user!.firmId)),
      with: { client: true },
    });
    if (!mission) {
      res.status(404).json({ error: "Mission introuvable." });
      return;
    }
    if (mission.status === "visa_emis") {
      res.status(409).json({ error: "Le visa a déjà été émis : la grille est verrouillée." });
      return;
    }

    const items = await db.query.checklistItemsTable.findMany({
      where: eq(checklistItemsTable.missionId, missionId),
      orderBy: (t, { asc }) => [asc(t.orderIndex)],
    });
    if (items.length === 0) {
      res.status(422).json({ error: "Aucun point de contrôle à analyser." });
      return;
    }

    const client = mission.client;
    if (!client || client.annualTurnover == null) {
      res.status(422).json({ error: "Le profil client est incomplet (CA manquant)." });
      return;
    }

    // ── 2. Fetch ledger data ────────────────────────────────────────────────
    const [ledgerLines, anomalyTxs] = await Promise.all([
      fetchValidatedLedgerLines(client.id, req.user!.firmId),
      fetchAnomalyTransactions(client.id, req.user!.firmId),
    ]);

    const yearStart        = new Date(Date.UTC(mission.fiscalYear, 0, 1));
    const yearEndExclusive = new Date(Date.UTC(mission.fiscalYear + 1, 0, 1));
    const balance          = computeBalanceDesComptes(ledgerLines, yearStart, yearEndExclusive);

    // ── 3. Call Gemini ──────────────────────────────────────────────────────
    const prompt = buildChecklistPrompt(
      {
        name:              client.name,
        sector:            client.sector,
        annualTurnover:    client.annualTurnover,
        accountingSystem:  mission.accountingSystem,
      },
      mission.fiscalYear,
      balance,
      anomalyTxs.length,
      items.map((i) => ({ id: i.id, label: i.label })),
    );

    let rawResponse: string;
    try {
      const ai       = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model:    "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: `${CHECKLIST_SYSTEM_PROMPT}\n\n${prompt}` }] }],
        config:   { responseMimeType: "application/json", maxOutputTokens: 8192 },
      });
      rawResponse = response.text ?? "";
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "Gemini checklist analysis API call failed");
      res.status(502).json({ error: `Le service d'analyse IA est temporairement indisponible. (${detail})` });
      return;
    }

    // ── 4. Parse & validate Gemini response ────────────────────────────────
    let parsed: AIChecklistResult[];
    try {
      const raw = JSON.parse(rawResponse);
      if (!Array.isArray(raw)) throw new Error("Expected a JSON array");
      parsed = raw.map((r) => ({
        checklist_item_id: Number(r.checklist_item_id),
        label:             String(r.label ?? ""),
        status:            r.status as "CONFORME" | "ALERTE" | "NON_APPLICABLE",
        justification:     String(r.justification ?? ""),
      }));
    } catch (err) {
      req.log.error({ err, raw: rawResponse.slice(0, 400) }, "Failed to parse Gemini checklist response");
      res.status(502).json({ error: "L'IA a retourné une réponse invalide. Veuillez réessayer." });
      return;
    }

    // ── 5. Bulk-apply CONFORME items to DB ──────────────────────────────────
    // ALERTE and NON_APPLICABLE items are NOT written to DB here; the
    // accountant reviews them manually and decides the final status.
    const conformeResults = parsed.filter((r) => r.status === "CONFORME");
    if (conformeResults.length > 0) {
      await Promise.all(
        conformeResults.map((r) =>
          db
            .update(checklistItemsTable)
            .set({ status: "conforme", note: r.justification })
            .where(
              and(
                eq(checklistItemsTable.id, r.checklist_item_id),
                eq(checklistItemsTable.missionId, missionId),
              ),
            ),
        ),
      );
      // Sync anomaly state (may clear anomalie flag if all items are now conforme)
      await syncMissionAnomalyState(mission);
    }

    // ── 6. Enrich results with labels from DB (AI may not return label) ─────
    const itemById = new Map(items.map((i) => [i.id, i]));
    const enriched: AIChecklistResult[] = parsed.map((r) => ({
      ...r,
      label: itemById.get(r.checklist_item_id)?.label ?? r.label,
    }));

    // ── 7. Audit log ────────────────────────────────────────────────────────
    await logAudit({
      firmId:    req.user!.firmId,
      userId:    req.user!.id,
      userName:  req.user!.fullName,
      userRole:  req.user!.role,
      action:    AuditAction.CHECKLIST_VALIDATE,
      entityType: "mission",
      entityId:  missionId,
      details:   `Pré-remplissage IA (Gemini) — ${conformeResults.length}/${items.length} points conformes appliqués automatiquement pour "${client.name}" exercice ${mission.fiscalYear}.`,
      ipAddress: req.ip,
    });

    res.json({ results: enriched });
  },
);

export default router;
