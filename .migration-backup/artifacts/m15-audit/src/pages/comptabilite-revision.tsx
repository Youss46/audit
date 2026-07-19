import { useMemo, useState } from "react"
import { useRoute } from "wouter"
import { useListTransactions, getListTransactionsQueryKey, useListThreads, getListThreadsQueryKey } from "@workspace/api-client-react"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { CommentThreadSidebar } from "@/components/collaboration/CommentThreadSidebar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { formatDate } from "@/lib/utils"
import { formatFcfa } from "@/lib/status"
import { MessageSquare, MessagesSquare, CheckCircle2 } from "lucide-react"
import { useRealtime } from "@/hooks/use-realtime"

// Module M26 (Révision Collaborative & Chat Contextuel — "le Slack de la
// Révision Comptable"): a split view over the client's ledger entries with
// a speech-bubble icon per row. Clicking it opens the Slack-style
// slide-over so the cabinet can raise a point on that exact écriture
// without leaving the page, and the client sees/replies from their own
// portal on the very same thread.
export default function ComptabiliteRevision() {
  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/revision")
  const clientId = params?.clientId ? Number(params.clientId) : null

  useRealtime(!!clientId)

  const [onlyDiscussed, setOnlyDiscussed] = useState(false)
  const [selectedTransactionId, setSelectedTransactionId] = useState<number | null>(null)

  const { data: transactions, isLoading } = useListTransactions(
    clientId ? { clientId } : undefined,
    {
      query: {
        enabled: !!clientId,
        queryKey: getListTransactionsQueryKey({ clientId: clientId ?? 0 }),
      },
    },
  )

  const { data: threads } = useListThreads(
    { clientId: clientId ?? 0 },
    {
      query: {
        enabled: !!clientId,
        queryKey: getListThreadsQueryKey({ clientId: clientId ?? 0 }),
      },
    },
  )

  const threadByTransactionId = useMemo(() => {
    const map = new Map<number, NonNullable<typeof threads>[number]>()
    for (const thread of threads ?? []) {
      if (thread.targetType === "TRANSACTION_LINE") map.set(thread.targetId, thread)
    }
    return map
  }, [threads])

  const rows = useMemo(() => {
    const sorted = [...(transactions ?? [])].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )
    if (!onlyDiscussed) return sorted
    return sorted.filter((t) => threadByTransactionId.has(t.id))
  }, [transactions, onlyDiscussed, threadByTransactionId])

  const selectedTransaction = (transactions ?? []).find((t) => t.id === selectedTransactionId) ?? null
  const selectedThread = selectedTransactionId ? threadByTransactionId.get(selectedTransactionId) : undefined

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité &amp; Travaux</h1>
        <p className="text-muted-foreground mt-1">
          Révision Collaborative — discutez chaque écriture directement avec le client, en contexte.
        </p>
      </div>

      <ClientAccountingNav activeTab="revision" />

      {!clientId ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <MessagesSquare className="h-8 w-8 mb-2 opacity-20" />
            <p>Sélectionnez un client pour lancer la révision collaborative.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Switch id="only-discussed" checked={onlyDiscussed} onCheckedChange={setOnlyDiscussed} data-testid="switch-only-discussed" />
            <Label htmlFor="only-discussed" className="text-sm cursor-pointer">
              Afficher uniquement les écritures avec une discussion
            </Label>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Écritures du client</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-10 text-center text-muted-foreground">Chargement...</div>
              ) : rows.length === 0 ? (
                <div className="p-10 flex flex-col items-center justify-center text-muted-foreground">
                  <MessagesSquare className="h-8 w-8 mb-2 opacity-20" />
                  <p>Aucune écriture à afficher.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Discussion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((t) => {
                      const thread = threadByTransactionId.get(t.id)
                      const amount = t.journalLines.reduce((s, l) => s + l.debitAmount, 0)
                      return (
                        <TableRow key={t.id} data-testid={`row-transaction-${t.id}`}>
                          <TableCell className="whitespace-nowrap">{formatDate(t.date)}</TableCell>
                          <TableCell>{t.label}</TableCell>
                          <TableCell className="text-right font-mono">{formatFcfa(amount)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {t.status === "valide" ? "Validé" : t.status === "anomalie" ? "Anomalie" : "À valider"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="relative"
                              onClick={() => setSelectedTransactionId(t.id)}
                              data-testid={`button-comment-${t.id}`}
                            >
                              {thread?.isResolved ? (
                                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                              ) : (
                                <MessageSquare className={`h-4 w-4 ${thread ? "text-blue-600" : "text-muted-foreground"}`} />
                              )}
                              {thread && thread.commentCount > 0 && !thread.isResolved && (
                                <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">
                                  {thread.commentCount}
                                </span>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {clientId && selectedTransactionId && (
        <CommentThreadSidebar
          open={!!selectedTransactionId}
          onOpenChange={(open) => !open && setSelectedTransactionId(null)}
          clientId={clientId}
          targetType="TRANSACTION_LINE"
          targetId={selectedTransactionId}
          targetSummary={
            selectedTransaction ? (
              <div className="text-xs text-muted-foreground">
                {formatDate(selectedTransaction.date)} — <span className="text-foreground font-medium">{selectedTransaction.label}</span>
              </div>
            ) : (
              selectedThread?.targetLabel && (
                <div className="text-xs text-muted-foreground">{selectedThread.targetLabel}</div>
              )
            )
          }
        />
      )}
    </div>
  )
}
