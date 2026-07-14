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
  | { type: "thread:resolved"; payload: { targetType: string; targetId: number; clientId: number } };

const socketsByUserId = new Map<number, Set<WebSocket>>();

export function initRealtime(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (socket, req) => {
    let userId: number | null = null;
    try {
      const url = new URL(req.url ?? "", "http://internal");
      const token = url.searchParams.get("token");
      if (!token) throw new Error("missing token");
      const payload = verifyToken(token);
      userId = payload.id;
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

    socket.on("close", () => {
      set!.delete(socket);
      if (set!.size === 0) socketsByUserId.delete(userId!);
    });

    socket.on("error", (err) => {
      logger.warn({ err, userId }, "Realtime socket error");
    });
  });

  logger.info("Realtime WebSocket server attached at /api/ws");
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
