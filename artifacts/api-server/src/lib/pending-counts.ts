import { and, count, eq } from "drizzle-orm";
import { db, transactionsTable, usersTable } from "@workspace/db";
import { pushToUsers } from "./realtime";

// Module M32 (Notification Instantanée & Compteurs Dynamiques): the single
// source of truth for "how many of this client's entries are still à
// valider, split by type" -- shared by the GET /cabinet/pending-counts/:id
// endpoint (used on page load) and the real-time push fired from
// accounting.ts on create/approve/reject (used to keep badges live
// in-between page loads).
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

  let pendingExpenses = 0;
  let pendingRevenues = 0;
  for (const row of rows) {
    if (row.type === "depense") pendingExpenses = Number(row.count);
    else if (row.type === "recette") pendingRevenues = Number(row.count);
  }
  return { pendingExpenses, pendingRevenues, totalPending: pendingExpenses + pendingRevenues };
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

/** Recomputes this client's pending counts and pushes them to the firm's cabinet staff. Best-effort -- a missed push just means the badge catches up on next page load/poll. */
export async function broadcastPendingCounts(firmId: number, clientId: number) {
  const counts = await computePendingCounts(firmId, clientId);
  const staffIds = await getCabinetStaffUserIds(firmId);
  pushToUsers(staffIds, { type: "pendingTransactionsUpdated", payload: { clientId, ...counts } });
  return counts;
}

export { getCabinetStaffUserIds };
