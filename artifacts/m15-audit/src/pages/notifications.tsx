import { useState } from "react"
import { useLocation } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListNotifications,
  getListNotificationsQueryKey,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@workspace/api-client-react"
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  ArrowRight,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/utils"

// Helper — group notifications by day bucket (Aujourd'hui / Hier / Plus tôt)
function dayBucket(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86_400_000)
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (itemDay.getTime() === today.getTime()) return "Aujourd'hui"
  if (itemDay.getTime() === yesterday.getTime()) return "Hier"
  return "Plus tôt"
}

const BUCKET_ORDER = ["Aujourd'hui", "Hier", "Plus tôt"]

function groupByBucket<T extends { createdAt: string }>(items: T[]) {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const b = dayBucket(item.createdAt)
    if (!map.has(b)) map.set(b, [])
    map.get(b)!.push(item)
  }
  // Return in canonical order, skipping empty buckets
  return BUCKET_ORDER
    .filter((b) => map.has(b))
    .map((b) => ({ bucket: b, items: map.get(b)! }))
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
      <Bell className="h-10 w-10 opacity-20" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function NotifSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 items-start">
          <Skeleton className="h-2 w-2 rounded-full mt-2 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function NotificationsPage() {
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<"all" | "unread">("all")

  const { data: notifications, isLoading } = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      refetchInterval: 30_000,
    },
  })

  const markReadMutation = useMarkNotificationRead({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    },
  })

  const markAllReadMutation = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    },
  })

  const all = notifications ?? []
  const unread = all.filter((n) => !n.isRead)
  const displayed = tab === "unread" ? unread : all
  const groups = groupByBucket(displayed)

  function handleClick(notif: (typeof all)[number]) {
    if (!notif.isRead) markReadMutation.mutate({ id: notif.id })
    if (notif.linkToRoute) setLocation(notif.linkToRoute)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* ── En-tête ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">
            {unread.length > 0
              ? `${unread.length} notification${unread.length > 1 ? "s" : ""} non lue${unread.length > 1 ? "s" : ""}`
              : "Tout est à jour"}
          </p>
        </div>
        {unread.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            disabled={markAllReadMutation.isPending}
            onClick={() => markAllReadMutation.mutate()}
          >
            {markAllReadMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            Tout marquer comme lu
          </Button>
        )}
      </div>

      {/* ── Onglets ──────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "unread")}>
        <TabsList>
          <TabsTrigger value="all" className="gap-2">
            Toutes
            <Badge variant="secondary" className="h-5 min-w-5 px-1 text-xs">
              {all.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="unread" className="gap-2">
            Non lues
            {unread.length > 0 && (
              <Badge className="h-5 min-w-5 px-1 text-xs bg-blue-600 text-white">
                {unread.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Contenu commun aux deux onglets ─────────────────────── */}
        {(["all", "unread"] as const).map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            {isLoading ? (
              <NotifSkeleton />
            ) : groups.length === 0 ? (
              <EmptyState
                label={
                  t === "unread"
                    ? "Aucune notification non lue — vous êtes à jour !"
                    : "Aucune notification pour le moment."
                }
              />
            ) : (
              <div className="space-y-6">
                {groups.map(({ bucket, items }) => (
                  <div key={bucket}>
                    {/* Séparateur de date */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {bucket}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    <div className="divide-y divide-border rounded-lg border bg-card shadow-sm overflow-hidden">
                      {items.map((notif) => (
                        <button
                          key={notif.id}
                          className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors hover:bg-muted/40 group ${
                            !notif.isRead ? "bg-blue-50/60 dark:bg-blue-900/10" : ""
                          }`}
                          onClick={() => handleClick(notif)}
                        >
                          {/* Dot indicateur lu/non-lu */}
                          <span
                            className={`mt-1.5 h-2 w-2 rounded-full shrink-0 transition-colors ${
                              notif.isRead ? "bg-transparent" : "bg-blue-500"
                            }`}
                          />

                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <p
                                className={`text-sm leading-snug ${
                                  notif.isRead ? "font-normal text-foreground" : "font-semibold"
                                }`}
                              >
                                {notif.title}
                              </p>
                              {notif.isRead && (
                                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                              {notif.body}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1">
                              {formatDateTime(notif.createdAt)}
                            </p>
                          </div>

                          {/* Chevron si lien disponible */}
                          {notif.linkToRoute && (
                            <ArrowRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 mt-1 transition-colors" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
