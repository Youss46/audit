import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  getListNotificationsQueryKey,
  getListThreadsQueryKey,
  getListChatChannelsQueryKey,
  getListChatChannelMessagesQueryKey,
  getListChatDirectMessagesQueryKey,
  getListChatColleaguesQueryKey,
} from "@workspace/api-client-react"
import { getToken } from "@/lib/auth"

// Module M32 notification payload shape (mirrors the server's
// NotificationDto -- see routes/collaboration.ts and lib/pending-counts.ts).
export type RealtimeNotificationPayload = {
  id: number
  title: string
  body: string
  linkToRoute: string | null
  createdAt: string
}

// Module M26 (Révision Collaborative & Chat Contextuel): best-effort
// real-time push. When a socket message arrives we simply invalidate the
// relevant React Query caches -- the already-mounted components refetch
// and re-render, so there is no separate client-side event bus to keep in
// sync with the server's notion of state.
//
// This is deliberately just an enhancement on top of normal fetching: if
// the socket never connects (offline, restrictive proxy, etc.) the app
// still works via the notification bell's periodic refetch.
type RealtimeMessage =
  | { type: "notification:new"; payload: RealtimeNotificationPayload }
  | { type: "comment:new"; payload: { targetType: string; targetId: number; clientId: number } }
  | { type: "thread:resolved"; payload: { targetType: string; targetId: number; clientId: number } }
  // Module M31 (Messagerie Interne du Cabinet).
  | { type: "chat:channel-message"; payload: { channelId: number; message: unknown } }
  | { type: "chat:direct-message"; payload: { message: { senderId: number; recipientId: number } } }
  | { type: "chat:presence"; payload: { userId: number; online: boolean } }
  // Module M32 (Notification Instantanée & Compteurs Dynamiques): fired on
  // every création/approbation/rejet touching a client's "à valider" queue.
  | {
      type: "pendingTransactionsUpdated"
      payload: { clientId: number; pendingExpenses: number; pendingRevenues: number; totalPending: number }
    }

export function useRealtime(
  enabled: boolean,
  options?: { onNotification?: (notification: RealtimeNotificationPayload) => void },
) {
  const queryClient = useQueryClient()
  const socketRef = useRef<WebSocket | null>(null)
  const onNotificationRef = useRef(options?.onNotification)
  onNotificationRef.current = options?.onNotification

  useEffect(() => {
    if (!enabled) return
    const token = getToken()
    if (!token) return

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`)
    socketRef.current = socket

    socket.onmessage = (event) => {
      let message: RealtimeMessage
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }

      if (message.type === "notification:new") {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() })
        onNotificationRef.current?.(message.payload)
      } else if (message.type === "pendingTransactionsUpdated") {
        // Both the per-client counter (used on the "Flux de Saisie" tab)
        // and the firm-wide counter (used by the global "Révision
        // Dépenses"/"Révision Recettes" nav badges) share the same
        // "/cabinet/pending-counts" URL prefix in their generated query
        // keys, so one broad predicate refreshes every badge at once.
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && String(q.queryKey[0]).includes("/cabinet/pending-counts"),
        })
        // ClientAccountingNav's existing "Flux de Saisie" tab badge (module
        // M3) already counts this same client's "à valider" entries via
        // the plain transactions list -- refresh it too so it doesn't lag
        // behind the dedicated M32 counters above.
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && String(q.queryKey[0]).includes("/transactions"),
        })
      } else if (message.type === "comment:new" || message.type === "thread:resolved") {
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey({ clientId: message.payload.clientId }) })
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() })
        // Comment-thread detail queries are keyed per targetType/targetId;
        // broad invalidation by predicate catches them without needing
        // every consumer to expose its own query key getter.
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && String(q.queryKey[0]).includes("/collaboration/comments/"),
        })
      } else if (message.type === "chat:channel-message") {
        queryClient.invalidateQueries({ queryKey: getListChatChannelMessagesQueryKey(message.payload.channelId) })
        queryClient.invalidateQueries({ queryKey: getListChatChannelsQueryKey() })
      } else if (message.type === "chat:direct-message") {
        queryClient.invalidateQueries({
          queryKey: getListChatDirectMessagesQueryKey(message.payload.message.senderId),
        })
        queryClient.invalidateQueries({
          queryKey: getListChatDirectMessagesQueryKey(message.payload.message.recipientId),
        })
      } else if (message.type === "chat:presence") {
        queryClient.invalidateQueries({ queryKey: getListChatColleaguesQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListChatChannelsQueryKey() })
      }
    }

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [enabled, queryClient])
}
