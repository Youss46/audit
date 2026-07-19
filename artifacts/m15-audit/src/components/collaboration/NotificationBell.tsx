import { useLocation } from "wouter"
import {
  useListNotifications,
  getListNotificationsQueryKey,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Bell, CheckCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToastAction } from "@/components/ui/toast"
import { formatDateTime } from "@/lib/utils"
import { useRealtime } from "@/hooks/use-realtime"
import { useToast } from "@/hooks/use-toast"

// Module M26 (Révision Collaborative & Chat Contextuel): the persistent
// "Notification_Center" -- lives in the topbar for every authenticated
// user (cabinet and Espace PME alike) so a new comment on either side
// surfaces immediately, whether or not the recipient has the relevant
// ledger/portal page open. Backed by a short refetch interval as a
// reliable fallback in addition to the best-effort WebSocket push.
export function NotificationBell() {
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Module M32: on top of the bell dropdown (which just waits for the next
  // poll/click), pop an instant slide-down banner the moment a new
  // notification arrives -- e.g. "Le client X a soumis une nouvelle dépense
  // à valider." -- with a one-click "Voir" action that deep-links straight
  // to the review queue for that entry.
  useRealtime(true, {
    onNotification: (notification) => {
      toast({
        title: notification.title,
        description: notification.body,
        action: notification.linkToRoute ? (
          <ToastAction altText="Voir" onClick={() => setLocation(notification.linkToRoute!)}>
            Voir
          </ToastAction>
        ) : undefined,
      })
    },
  })

  const { data: notifications } = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      refetchInterval: 20_000,
    },
  })

  const markReadMutation = useMarkNotificationRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    },
  })
  const markAllReadMutation = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    },
  })

  const items = notifications ?? []
  const unreadCount = items.filter((n) => !n.isRead).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notification-bell">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="font-medium text-sm">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => markAllReadMutation.mutate()}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tout marquer comme lu
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Aucune notification.</p>
          ) : (
            <div className="divide-y">
              {items.slice(0, 8).map((notif) => (
                <button
                  key={notif.id}
                  className={`w-full text-left p-3 text-sm hover:bg-muted/50 transition-colors ${
                    !notif.isRead ? "bg-blue-50/60 dark:bg-blue-900/10" : ""
                  }`}
                  onClick={() => {
                    if (!notif.isRead) markReadMutation.mutate({ id: notif.id })
                    if (notif.linkToRoute) setLocation(notif.linkToRoute)
                  }}
                  data-testid={`notification-${notif.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{notif.title}</span>
                    {!notif.isRead && <Badge className="h-1.5 w-1.5 p-0 rounded-full bg-blue-600 shrink-0 mt-1" />}
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{notif.body}</p>
                  <p className="text-muted-foreground text-[10px] mt-1">{formatDateTime(notif.createdAt)}</p>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        {/* Lien vers la page complète */}
        <div className="border-t p-2">
          <button
            className="w-full text-xs text-center text-muted-foreground hover:text-foreground py-1.5 rounded transition-colors hover:bg-muted/50"
            onClick={() => setLocation("/notifications")}
          >
            Voir toutes les notifications
            {items.length > 8 && ` (${items.length - 8} de plus)`}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
