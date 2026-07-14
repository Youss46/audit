import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getListNotificationsQueryKey, getListThreadsQueryKey } from "@workspace/api-client-react"
import { getToken } from "@/lib/auth"

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
  | { type: "notification:new"; payload: unknown }
  | { type: "comment:new"; payload: { targetType: string; targetId: number; clientId: number } }
  | { type: "thread:resolved"; payload: { targetType: string; targetId: number; clientId: number } }

export function useRealtime(enabled: boolean) {
  const queryClient = useQueryClient()
  const socketRef = useRef<WebSocket | null>(null)

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
      } else if (message.type === "comment:new" || message.type === "thread:resolved") {
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey({ clientId: message.payload.clientId }) })
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() })
        // Comment-thread detail queries are keyed per targetType/targetId;
        // broad invalidation by predicate catches them without needing
        // every consumer to expose its own query key getter.
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && String(q.queryKey[0]).includes("/collaboration/comments/"),
        })
      }
    }

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [enabled, queryClient])
}
