import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { verifyToken } from "./auth";
import { logger } from "./logger";

// Module M26 (Révision Collaborative & Chat Contextuel): a lightweight
// authenticated WebSocket hub so a new comment/notification reaches an
// already-open browser tab instantly, instead of waiting on the next
// polling interval. The frontend's `useRealtime` hook is a best-effort
// enhancement on top of normal React Query fetching/polling -- if the
// socket never connects (e.g. a restrictive network), the UI still works,
// just slightly less instantly.
//
// Auth: the browser can't set an Authorization header on a WebSocket
// handshake, so the JWT is passed as a `?token=` query parameter instead
// (short-lived exposure in server access logs is an accepted tradeoff for
// this MVP-scale feature, matching how e.g. signed download URLs work
// elsewhere).

type RealtimeEvent =
  | { type: "notification:new"; payload: { id: number; title: string; body: string; linkToRoute: string | null; createdAt: string } }
  | { type: "comment:new"; payload: { targetType: string; targetId: number; clientId: number } }
  | { type: "thread:resolved"; payload: { targetType: string; targetId: number; clientId: number } }
  // Module M31 (Messagerie Interne du Cabinet): multiplexed onto this same
  // hub rather than a second gateway -- see lib/db/src/schema/chat.ts.
  | { type: "chat:channel-message"; payload: { channelId: number; message: unknown } }
  | { type: "chat:direct-message"; payload: { message: unknown } }
  | { type: "chat:presence"; payload: { userId: number; online: boolean } }
  // Module M32 (Notification Instantanée & Compteurs Dynamiques): pushed to
  // firm accountants/collaborateurs/stagiaires whenever a client's "à
  // valider" queue changes (new PME submission, or an approve/reject
  // decrements it), so nav badges stay live without polling.
  | {
      type: "pendingTransactionsUpdated";
      payload: { clientId: number; pendingExpenses: number; pendingRevenues: number; totalPending: number };
    };

const socketsByUserId = new Map<number, Set<WebSocket>>();
// Module M31: tracks which firm each open socket's user belongs to, purely
// to fan out "colleague came online/offline" presence events without a DB
// round-trip on every connect/disconnect.
const firmIdBySocket = new Map<WebSocket, number>();
const onlineUserIdsByFirm = new Map<number, Set<number>>();

export function initRealtime(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (socket, req) => {
    let userId: number | null = null;
    let firmId: number | null = null;
    try {
      const url = new URL(req.url ?? "", "http://internal");
      const token = url.searchParams.get("token");
      if (!token) throw new Error("missing token");
      const payload = verifyToken(token);
      userId = payload.id;
      firmId = payload.firmId;
    } catch {
      socket.close(4401, "Authentification requise.");
      return;
    }

    let set = socketsByUserId.get(userId);
    if (!set) {
      set = new Set();
      socketsByUserId.set(userId, set);
    }
    set.add(socket);
    firmIdBySocket.set(socket, firmId);

    let firmOnline = onlineUserIdsByFirm.get(firmId);
    if (!firmOnline) {
      firmOnline = new Set();
      onlineUserIdsByFirm.set(firmId, firmOnline);
    }
    const isFirstSocketForUser = !firmOnline.has(userId);
    firmOnline.add(userId);
    if (isFirstSocketForUser) {
      broadcastPresence(firmId, userId, true, socket);
    }

    socket.on("close", () => {
      set!.delete(socket);
      if (set!.size === 0) socketsByUserId.delete(userId!);
      firmIdBySocket.delete(socket);

      const stillHasOtherSockets = [...(socketsByUserId.get(userId!) ?? [])].some(
        (s) => firmIdBySocket.get(s) === firmId,
      );
      if (!stillHasOtherSockets) {
        onlineUserIdsByFirm.get(firmId!)?.delete(userId!);
        broadcastPresence(firmId!, userId!, false, null);
      }
    });

    socket.on("error", (err) => {
      logger.warn({ err, userId }, "Realtime socket error");
    });
  });

  logger.info("Realtime WebSocket server attached at /api/ws");
}

function broadcastPresence(firmId: number, userId: number, online: boolean, exceptSocket: WebSocket | null): void {
  for (const [otherUserId, sockets] of socketsByUserId) {
    if (otherUserId === userId) continue;
    for (const socket of sockets) {
      if (socket === exceptSocket) continue;
      if (firmIdBySocket.get(socket) !== firmId) continue;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "chat:presence", payload: { userId, online } } satisfies RealtimeEvent));
      }
    }
  }
}

/** Module M31: currently-connected user ids within a given firm, for the initial (pre-websocket-event) online state. */
export function getOnlineUserIds(firmId: number): number[] {
  return [...(onlineUserIdsByFirm.get(firmId) ?? [])];
}

/** Push a real-time event to every open socket for a given user. No-op if the user has no open tab. */
export function pushToUser(userId: number, event: RealtimeEvent): void {
  const set = socketsByUserId.get(userId);
  if (!set || set.size === 0) return;
  const message = JSON.stringify(event);
  for (const socket of set) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

export function pushToUsers(userIds: number[], event: RealtimeEvent): void {
  for (const id of userIds) pushToUser(id, event);
}
