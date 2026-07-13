import { useState } from "react"
import {
  useListTransactions,
  getListTransactionsQueryKey,
  useApproveTransaction,
  useRejectTransaction,
  TransactionStatus,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  getTransactionStatusColor,
  getTransactionStatusLabel,
  getTransactionTypeLabel,
  getPaymentMethodLabel,
  formatFcfa,
} from "@/lib/status"
import { BookOpenCheck, CheckCircle2, XCircle, Paperclip, ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Module M3 (Comptabilité et Travaux): the accountant's ledger review
// workspace. Every plain-language PME entry ("à valider") is shown next to
// the double-entry lines the matching engine already computed, so the
// accountant only has to review and click -- never re-key an operation.
export default function ComptabiliteCabinet() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | "ALL">("a_valider")
  const [rejectTarget, setRejectTarget] = useState<number | null>(null)
  const [clarificationNote, setClarificationNote] = useState("")

  const { data: transactions, isLoading } = useListTransactions(
    statusFilter === "ALL" ? undefined : { status: statusFilter },
  )

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() })

  const approveMutation = useApproveTransaction({
    mutation: {
      onSuccess: () => {
        toast({ title: "Opération comptabilisée", description: "Elle est désormais verrouillée dans le grand livre." })
        invalidateList()
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de comptabiliser cette opération.",
          variant: "destructive",
        })
      },
    },
  })

  const rejectMutation = useRejectTransaction({
    mutation: {
      onSuccess: () => {
        toast({ title: "Opération invalidée", description: "Le client a été informé de la correction à apporter." })
        setRejectTarget(null)
        setClarificationNote("")
        invalidateList()
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible d'invalider cette opération.",
          variant: "destructive",
        })
      },
    },
  })

  const handleReject = (e: React.FormEvent) => {
    e.preventDefault()
    if (rejectTarget == null || !clarificationNote.trim()) return
    rejectMutation.mutate({ id: rejectTarget, data: { clarificationNote: clarificationNote.trim() } })
  }

  const rows = transactions ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité & Travaux</h1>
        <p className="text-muted-foreground mt-1">
          Vérifiez les opérations déclarées par vos clients avant de les comptabiliser dans le
          grand livre SYSCOHADA.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {([
          ["a_valider", "À valider"],
          ["valide", "Validées"],
          ["anomalie", "Anomalies"],
          ["ALL", "Toutes"],
        ] as const).map(([value, label]) => (
          <Badge
            key={value}
            variant={statusFilter === value ? "default" : "outline"}
            className="cursor-pointer whitespace-nowrap"
            onClick={() => setStatusFilter(value)}
            data-testid={`filter-status-${value}`}
          >
            {label}
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground">Chargement...</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <BookOpenCheck className="h-8 w-8 mb-2 opacity-20" />
            <p>Aucune opération dans cette file.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((t) => (
            <Card key={t.id} className="shadow-sm" data-testid={`card-transaction-${t.id}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {t.clientName}
                    <Badge variant="outline" className={`border-transparent ${getTransactionStatusColor(t.status)}`}>
                      {getTransactionStatusLabel(t.status)}
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatDate(t.date)} · {getTransactionTypeLabel(t.type)} · {formatFcfa(t.amount)}
                  </p>
                </div>
                {t.status !== "valide" && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                      onClick={() => {
                        setRejectTarget(t.id)
                        setClarificationNote("")
                      }}
                      disabled={rejectMutation.isPending}
                      data-testid={`button-reject-${t.id}`}
                    >
                      <XCircle className="mr-1.5 h-4 w-4" />
                      Invalider
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate({ id: t.id })}
                      disabled={approveMutation.isPending}
                      data-testid={`button-approve-${t.id}`}
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      Approuver &amp; Comptabiliser
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Left: plain-language PME entry + attachment */}
                  <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Déclaration du client
                    </p>
                    <p className="font-medium">{t.label}</p>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Catégorie : {t.categoryLabel ?? "—"}</p>
                      <p>Mode de règlement : {getPaymentMethodLabel(t.paymentMethod)}</p>
                      <p>Saisi par : {t.createdByName ?? "—"}</p>
                    </div>
                    {t.documentId ? (
                      <div className="flex items-center gap-1.5 text-sm text-primary pt-1">
                        <Paperclip className="h-3.5 w-3.5" />
                        {t.documentFileName ?? "Pièce jointe"}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic pt-1">Aucune pièce jointe</p>
                    )}
                    {t.status === "anomalie" && t.clarificationNote && (
                      <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 p-2 mt-2">
                        <p className="text-xs font-medium text-red-700 dark:text-red-400">Note envoyée au client :</p>
                        <p className="text-xs text-red-700 dark:text-red-400">{t.clarificationNote}</p>
                      </div>
                    )}
                  </div>

                  {/* Right: computed SYSCOHADA double-entry lines */}
                  <div className="rounded-md border p-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <ClipboardList className="h-3.5 w-3.5" />
                      Écriture SYSCOHADA générée
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="text-left font-normal pb-1">Compte</th>
                          <th className="text-right font-normal pb-1">Débit</th>
                          <th className="text-right font-normal pb-1">Crédit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.journalLines.map((line) => (
                          <tr key={line.id} className="border-t">
                            <td className="py-1.5">
                              <span className="font-mono text-xs mr-1.5">{line.accountNumber}</span>
                              {line.label}
                            </td>
                            <td className="text-right py-1.5">
                              {line.debitAmount > 0 ? formatFcfa(line.debitAmount) : ""}
                            </td>
                            <td className="text-right py-1.5">
                              {line.creditAmount > 0 ? formatFcfa(line.creditAmount) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {t.validatedByName && (
                      <>
                        <Separator />
                        <p className="text-xs text-muted-foreground">
                          Comptabilisé par {t.validatedByName}
                          {t.validatedAt ? ` le ${formatDateTime(t.validatedAt)}` : ""}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={rejectTarget != null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invalider l'opération</DialogTitle>
            <DialogDescription>
              Expliquez au client ce qu'il doit corriger. L'opération repassera en anomalie et
              devra être resoumise.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleReject} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="clarification">Note de clarification</Label>
              <Textarea
                id="clarification"
                placeholder="Ex : Merci de joindre le reçu correspondant à cette dépense."
                value={clarificationNote}
                onChange={(e) => setClarificationNote(e.target.value)}
                data-testid="input-clarification-note"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectTarget(null)}
                disabled={rejectMutation.isPending}
              >
                Annuler
              </Button>
              <Button type="submit" variant="destructive" disabled={rejectMutation.isPending || !clarificationNote.trim()}>
                {rejectMutation.isPending ? "Envoi..." : "Envoyer et invalider"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
