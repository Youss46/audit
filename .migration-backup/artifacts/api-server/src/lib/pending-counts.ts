import { and, count, eq } from "drizzle-orm";
import { db, transactionsTable, usersTable, notificationsTable } from "@workspace/db";
import { pushToUsers } from "./realtime";

// Module M32 (Notification Instantanée & Compteurs Dynamiques): the single
// source of truth for "how many of this client's entries are still à
// valider, split by type" -- shared by the GET /cabinet/pending-counts/:id
// endpoint (used on page load) and the real-time push fired from
// accounting.ts on create/approve/reject (used to keep badges live
// in-between page loads).
function tallyByType(rows: { type: string | null; count: number }[]) {
  let pendingExpenses = 0;
  let pendingRevenues = 0;
  for (const row of rows) {
    if (row.type === "depense") pendingExpenses = Number(row.count);
    else if (row.type === "recette") pendingRevenues = Number(row.count);
  }
  return { pendingExpenses, pendingRevenues, totalPending: pendingExpenses + pendingRevenues };
}

export async function computePendingCounts(firmId: number, clientId: number) {
  const rows = await db
    .select({ type: transactionsTable.type, count: count() })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.firmId, firmId),
        eq(transactionsTable.clientId, clientId),
        eq(transactionsTable.status, "a_valider"),
      ),
    )
    .groupBy(transactionsTable.type);

  return tallyByType(rows);
}

// Firm-wide variant, aggregated across every client -- backs the global
// "Révision Dépenses" / "Révision Recettes" sidebar badges (module M32),
// which live in the cabinet's main navigation and are not scoped to a
// single client dossier the way the per-client counters are.
export async function computeFirmPendingCounts(firmId: number) {
  const rows = await db
    .select({ type: transactionsTable.type, count: count() })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.firmId, firmId), eq(transactionsTable.status, "a_valider")))
    .groupBy(transactionsTable.type);

  return tallyByType(rows);
}

// There is no staff<->client assignment table (a mission's assignedToId is
// advisory, not an access filter -- see module M15/M22 notes), so "the
// cabinet staff who should see this client's queue" is every active
// accountant/collaborateur/stagiaire in the firm, matching the fan-out
// already used for module M26 comment notifications.
async function getCabinetStaffUserIds(firmId: number): Promise<number[]> {
  const staff = await db.query.usersTable.findMany({
    where: and(eq(usersTable.firmId, firmId), eq(usersTable.status, "active")),
    columns: { id: true, role: true },
  });
  return staff
    .filter((u) => u.role === "expert_comptable" || u.role === "collaborateur" || u.role === "stagiaire")
    .map((u) => u.id);
}

/**
 * Recomputes this client's pending counts and pushes them to the firm's
 * cabinet staff. Best-effort -- a missed push just means the badge/counter
 * catches up on next page load/poll. The frontend invalidates both the
 * per-client and the firm-wide pending-counts queries on this single event,
 * so one broadcast keeps every badge (client-scoped or global) in sync.
 */
export async function broadcastPendingCounts(firmId: number, clientId: number) {
  const counts = await computePendingCounts(firmId, clientId);
  const staffIds = await getCabinetStaffUserIds(firmId);
  pushToUsers(staffIds, { type: "pendingTransactionsUpdated", payload: { clientId, ...counts } });
  return counts;
}

/**
 * Module M32: fires when a PME client (or one of its Caisse Terrain
 * agents) submits a new Dépense/Recette entry. Creates a real
 * `notifications` row per cabinet staff member (so it shows up in the bell
 * dropdown even offline) and pushes an instant "notification:new" so the
 * frontend can also pop the slide-down toast banner right away. Always
 * paired with a `broadcastPendingCounts` call from the caller so the
 * counters and the banner land together.
 */
export async function notifyPmeTransactionSubmitted(input: {
  firmId: number;
  clientId: number;
  transactionId: number;
  clientName: string;
  type: "depense" | "recette";
  amount: number;
}) {
  const staffIds = await getCabinetStaffUserIds(input.firmId);
  if (staffIds.length === 0) return;

  const typeLabel = input.type === "depense" ? "dépense" : "recette";
  const title = input.type === "depense" ? "Nouvelle dépense à valider" : "Nouvelle recette à valider";
  const body = `Le client ${input.clientName} a soumis une nouvelle ${typeLabel} à valider (${input.amount.toLocaleString("fr")} FCFA).`;
  // Deep-links straight into the cabinet's review queue for this exact
  // client, defaulting to the "à valider" filter, with the specific entry
  // flagged so the page can scroll to and highlight it.
  const linkToRoute = `/comptabilite/${input.clientId}/saisie?highlight=${input.transactionId}`;

  const createdNotifs = await db
    .insert(notificationsTable)
    .values(
      staffIds.map((recipientId) => ({
        firmId: input.firmId,
        recipientId,
        title,
        body,
        linkToRoute,
      })),
    )
    .returning();

  for (const notif of createdNotifs) {
    pushToUsers([notif.recipientId], {
      type: "notification:new",
      payload: {
        id: notif.id,
        title: notif.title,
        body: notif.body,
        linkToRoute: notif.linkToRoute,
        createdAt: notif.createdAt.toISOString(),
      },
    });
  }
}

export { getCabinetStaffUserIds };
