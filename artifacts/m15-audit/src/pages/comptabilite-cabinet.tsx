import { useState, useMemo, useEffect, useRef } from "react"
import { useRoute, useSearch } from "wouter"
import {
  useListTransactions,
  getListTransactionsQueryKey,
  useApproveTransaction,
  useRejectTransaction,
  useUpdateTransactionJournalLines,
  getListAssetsQueryKey,
  useListClients,
  useListAnalyticalAxes,
  useListAnalyticalCodes,
  useListAnalyticalAllocations,
  useSetJournalLineAllocations,
  getListAnalyticalAxesQueryKey,
  getListAnalyticalCodesQueryKey,
  TransactionStatus,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { formatDate, formatDateTime, cn } from "@/lib/utils"
import {
  getTransactionStatusColor,
  getTransactionStatusLabel,
  getTransactionTypeLabel,
  getPaymentMethodLabel,
  getTransactionSourceLabel,
  getAnomalyLabel,
  getAnomalyShortLabel,
  formatFcfa,
  isVatAccount,
} from "@/lib/status"
import { BookOpenCheck, CheckCircle2, XCircle, Paperclip, ClipboardList, Clock, Pencil, Save, AlertTriangle, ShieldAlert, GitMerge, Trash2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// M23 Ventiler Dialog — analytical allocation split for Class 6/7 lines
// ---------------------------------------------------------------------------

interface VentilerDialogProps {
  lineId: number
  lineLabel: string
  lineAmount: number
  clientId: number
  open: boolean
  onClose: () => void
}

function VentilerDialog({ lineId, lineLabel, lineAmount, clientId, open, onClose }: VentilerDialogProps) {
  const qc = useQueryClient()
  const setAllocs = useSetJournalLineAllocations()

  const { data: axes = [] } = useListAnalyticalAxes(
    { clientId },
    { query: { enabled: open, queryKey: getListAnalyticalAxesQueryKey({ clientId }) } },
  )
  const { data: codes = [] } = useListAnalyticalCodes(
    { clientId },
    { query: { enabled: open, queryKey: getListAnalyticalCodesQueryKey({ clientId }) } },
  )
  const { data: existingAllocs = [] } = useListAnalyticalAllocations(
    { journalLineId: lineId },
    { query: { enabled: open, queryKey: ["listAnalyticalAllocations", lineId] } },
  )

  // Local state: rows of { codeId, pct }
  const [rows, setRows] = useState<{ codeId: number; pct: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  // Initialise rows from existing allocations when dialog opens.
  const [initialised, setInitialised] = useState(false)
  if (open && !initialised && existingAllocs.length >= 0) {
    setRows(existingAllocs.map((a) => ({ codeId: a.analyticalCodeId, pct: String(a.percentage) })))
    setInitialised(true)
  }
  if (!open && initialised) {
    setInitialised(false)
    setRows([])
    setError(null)
  }

  const totalPct = useMemo(
    () => rows.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0),
    [rows],
  )

  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes])
  const usedCodeIds = new Set(rows.map((r) => r.codeId))
  const availableCodes = codes.filter((c) => c.isActive && !usedCodeIds.has(c.id))

  const byAxis = useMemo(() => {
    const map = new Map<number, { axisName: string; codes: typeof codes }>()
    for (const ax of axes) {
      const axCodes = availableCodes.filter((c) => c.axisId === ax.id)
      if (axCodes.length > 0) map.set(ax.id, { axisName: ax.name, codes: axCodes })
    }
    return map
  }, [axes, availableCodes])

  function addRow(codeId: number) {
    setRows((prev) => [...prev, { codeId, pct: "" }])
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function updatePct(idx: number, val: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, pct: val } : r)))
  }

  async function handleSave() {
    setError(null)
    const parsed = rows.map((r) => ({ analyticalCodeId: r.codeId, percentage: parseFloat(r.pct) || 0 }))
    const total = parsed.reduce((s, r) => s + r.percentage, 0)
    if (parsed.some((r) => r.percentage <= 0)) {
      setError("Chaque pourcentage doit être supérieur à 0.")
      return
    }
    if (total > 100.01) {
      setError(`Total : ${total.toFixed(2)} % — dépasse 100 %.`)
      return
    }
    try {
      await setAllocs.mutateAsync({ lineId, data: { allocations: parsed } })
      qc.invalidateQueries({ queryKey: ["listAnalyticalAllocations", lineId] })
      onClose()
    } catch {
      setError("Erreur lors de l'enregistrement.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-primary" />
            Ventilation analytique
          </DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-mono">{lineLabel}</span> — {formatFcfa(lineAmount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {rows.map((row, idx) => {
            const code = codeById.get(row.codeId)
            return (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{code?.label ?? "—"}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{code?.code}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={row.pct}
                    onChange={(e) => updatePct(idx, e.target.value)}
                    className="h-7 w-20 text-right text-xs"
                    placeholder="0.00"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                  {row.pct ? formatFcfa(Math.round((lineAmount * (parseFloat(row.pct) || 0)) / 100)) : ""}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => removeRow(idx)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )
          })}

          {/* Add row selector */}
          {availableCodes.length > 0 && (
            <div className="pt-1">
              <Select onValueChange={(v) => addRow(Number(v))}>
                <SelectTrigger className="h-7 text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Plus className="h-3 w-3" /> Ajouter une section…
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {Array.from(byAxis.values()).map(({ axisName, codes: axCodes }) => (
                    <div key={axisName}>
                      <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{axisName}</div>
                      {axCodes.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          <span className="font-mono text-xs mr-1">{c.code}</span> {c.label}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {codes.length === 0 && (
            <p className="text-xs text-muted-foreground italic text-center py-4">
              Aucune section analytique configurée pour ce client.
            </p>
          )}
        </div>

        {/* Total bar */}
        {rows.length > 0 && (
          <div className={`flex justify-between text-xs font-semibold px-1 border-t pt-2 ${totalPct > 100 ? "text-red-600" : totalPct === 100 ? "text-emerald-600" : "text-muted-foreground"}`}>
            <span>Total ventilé</span>
            <span>{totalPct.toFixed(2)} %</span>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          {rows.length === 0 ? (
            <Button onClick={handleSave} disabled={setAllocs.isPending} variant="destructive">
              {setAllocs.isPending ? "…" : "Effacer la ventilation"}
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={setAllocs.isPending}>
              {setAllocs.isPending ? "…" : "Enregistrer"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Module M3 (Comptabilité et Travaux): the accountant's ledger review
// workspace. Every plain-language PME entry ("à valider") is shown next to
// the double-entry lines the matching engine already computed, so the
// accountant only has to review and click -- never re-key an operation.
export default function ComptabiliteCabinet() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  // This page doubles as the unscoped "all clients" queue (/comptabilite)
  // and the per-client Flux de Saisie tab (/comptabilite/:clientId/saisie).
  const [, scopedParams] = useRoute<{ clientId: string }>("/comptabilite/:clientId/saisie")
  const clientId = scopedParams?.clientId ? Number(scopedParams.clientId) : null
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | "ALL">("a_valider")
  // Module M32: the global "Révision Dépenses" / "Révision Recettes" nav
  // links land here with a `?type=` query param so the unscoped "all
  // clients" queue opens pre-filtered to just that operation type.
  const search = useSearch()
  const typeParam = new URLSearchParams(search).get("type")
  const [typeFilter, setTypeFilter] = useState<"depense" | "recette" | "ALL">(
    typeParam === "depense" || typeParam === "recette" ? typeParam : "ALL",
  )
  useEffect(() => {
    if (typeParam === "depense" || typeParam === "recette") setTypeFilter(typeParam)
  }, [typeParam])
  // Module M32: a notification's "Voir" action deep-links here with
  // `?highlight=<transactionId>` so the accountant lands directly on the
  // entry the client just submitted instead of having to hunt for it.
  const highlightId = Number(new URLSearchParams(search).get("highlight")) || null
  const highlightRef = useRef<HTMLDivElement | null>(null)
  // Module M8: "Smart Filter" -- lets the accountant narrow the review
  // queue down to only the entries the anomaly detector flagged.
  const [anomaliesOnly, setAnomaliesOnly] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<number | null>(null)
  const [ventilerTarget, setVentilerTarget] = useState<{
    lineId: number; lineLabel: string; lineAmount: number; clientId: number
  } | null>(null)
  const [clarificationNote, setClarificationNote] = useState("")
  // Journal-line account numbers currently being edited, keyed by
  // `${transactionId}:${lineId}` -> account number. Only relevant for credit
  // (à crédit) operations still "à valider" (M3 requirement: let the
  // accountant adjust the 4111/4011 mapping before final validation).
  const [editingAccounts, setEditingAccounts] = useState<Record<number, Record<number, string>>>({})

  const { data: transactions, isLoading } = useListTransactions({
    ...(statusFilter === "ALL" ? {} : { status: statusFilter }),
    ...(clientId ? { clientId } : {}),
  })

  // Module M21 VAT-exemption guard: a transaction's serialized shape only
  // carries clientName, not the VAT-registration flag, so the client list is
  // fetched here to look it up per row and disable/hide the VAT account
  // entry client-side (the authoritative block is server-side, in
  // PATCH /transactions/:id/journal-lines).
  const { data: clients } = useListClients({})
  const vatRegisteredByClientId = new Map((clients ?? []).map((c) => [c.id, c.isVatRegistered]))

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() })

  const approveMutation = useApproveTransaction({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Opération comptabilisée", description: "Elle est désormais verrouillée dans le grand livre." })
        // Auto-sync: if Class 2 debit lines were detected, stub assets were
        // automatically created in the fixed assets registry for accountant review.
        const result = data as { autoCreatedAssets?: { id: number; accountNumber: string; label: string }[] }
        if (result.autoCreatedAssets && result.autoCreatedAssets.length > 0) {
          const count = result.autoCreatedAssets.length
          toast({
            title: count === 1 ? "Immobilisation détectée" : `${count} immobilisations détectées`,
            description: `Ajoutée${count > 1 ? "s" : ""} automatiquement au registre des actifs. Veuillez compléter les paramètres d'amortissement.`,
          })
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() })
        }
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

  const updateJournalLinesMutation = useUpdateTransactionJournalLines({
    mutation: {
      onSuccess: (_data, variables) => {
        toast({ title: "Comptes mis à jour", description: "Le mappage des comptes tiers a été enregistré." })
        setEditingAccounts((prev) => {
          const next = { ...prev }
          delete next[variables.id]
          return next
        })
        invalidateList()
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de mettre à jour les comptes.",
          variant: "destructive",
        })
      },
    },
  })

  const startEditingAccounts = (transactionId: number, lines: { id: number; accountNumber: string }[]) => {
    setEditingAccounts((prev) => ({
      ...prev,
      [transactionId]: Object.fromEntries(lines.map((l) => [l.id, l.accountNumber])),
    }))
  }

  const saveEditedAccounts = (transactionId: number, clientVatId: number | undefined) => {
    const edits = editingAccounts[transactionId]
    if (!edits) return

    // Client-side mirror of the server-side guard: never let a non-assujetti
    // client's opération be redirected onto a TVA account. The server
    // enforces this authoritatively; this just avoids a round-trip failure.
    if (clientVatId !== undefined && vatRegisteredByClientId.get(clientVatId) === false) {
      const blocked = Object.values(edits).some((accountNumber) => isVatAccount(accountNumber))
      if (blocked) {
        toast({
          title: "Compte TVA non autorisé",
          description:
            "Cette entité n'est pas assujettie à la TVA. Veuillez comptabiliser le montant TTC directement en charge/immobilisation.",
          variant: "destructive",
        })
        return
      }
    }

    updateJournalLinesMutation.mutate({
      id: transactionId,
      data: {
        lines: Object.entries(edits).map(([lineId, accountNumber]) => ({
          id: Number(lineId),
          accountNumber,
        })),
      },
    })
  }

  const allRows = transactions ?? []
  const typeFiltered = typeFilter === "ALL" ? allRows : allRows.filter((t) => t.type === typeFilter)
  const rows = anomaliesOnly ? typeFiltered.filter((t) => (t.anomalies?.length ?? 0) > 0) : typeFiltered
  const anomalyCount = typeFiltered.filter((t) => (t.anomalies?.length ?? 0) > 0).length

  // Module M32: scroll to and briefly highlight the entry a notification's
  // "Voir" action deep-linked to, once it's actually rendered in the list.
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [highlightId, rows.length])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité & Travaux</h1>
        <p className="text-muted-foreground mt-1">
          Vérifiez les opérations déclarées par vos clients avant de les comptabiliser dans le
          grand livre SYSCOHADA.
        </p>
      </div>

      <ClientAccountingNav activeTab="saisie" />

      <div className="flex flex-wrap items-center justify-between gap-3">
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
          <Separator orientation="vertical" className="h-5 mx-1" />
          {/* Module M32: type filter, mirrored by the "Révision Dépenses" /
              "Révision Recettes" sidebar links (which land here with
              `?type=`). */}
          {([
            ["ALL", "Tous types"],
            ["depense", "Dépenses"],
            ["recette", "Recettes"],
          ] as const).map(([value, label]) => (
            <Badge
              key={value}
              variant={typeFilter === value ? "default" : "outline"}
              className="cursor-pointer whitespace-nowrap"
              onClick={() => setTypeFilter(value)}
              data-testid={`filter-type-${value}`}
            >
              {label}
            </Badge>
          ))}
        </div>
        {/* Module M8: "Smart Filter" -- narrows the queue to entries the
            rule-based detector flagged (doublon, incohérence, montant
            anormal), regardless of the status filter above. */}
        <div className="flex items-center gap-2 pb-2">
          <Switch
            id="anomalies-only"
            checked={anomaliesOnly}
            onCheckedChange={setAnomaliesOnly}
            data-testid="switch-anomalies-only"
          />
          <Label htmlFor="anomalies-only" className="text-sm cursor-pointer flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            Afficher uniquement les anomalies
            {anomalyCount > 0 && (
              <Badge variant="outline" className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                {anomalyCount}
              </Badge>
            )}
          </Label>
        </div>
      </div>

      {isLoading ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground">Chargement...</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <BookOpenCheck className="h-8 w-8 mb-2 opacity-20" />
            <p>{anomaliesOnly ? "Aucune anomalie détectée dans cette file." : "Aucune opération dans cette file."}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((t) => {
            const anomalies = t.anomalies ?? []
            const hasAnomalies = anomalies.length > 0
            return (
            <Card
              key={t.id}
              ref={t.id === highlightId ? highlightRef : undefined}
              className={cn(
                hasAnomalies
                  ? "shadow-sm border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
                  : "shadow-sm",
                t.id === highlightId && "ring-2 ring-primary ring-offset-2",
              )}
              data-testid={`card-transaction-${t.id}`}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    {t.clientName}
                    <Badge variant="outline" className={`border-transparent ${getTransactionStatusColor(t.status)}`}>
                      {getTransactionStatusLabel(t.status)}
                    </Badge>
                    {t.paymentType === "credit" && (
                      <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        <Clock className="mr-1 h-3 w-3" />
                        À crédit
                      </Badge>
                    )}
                    {t.source === "settlement" && (
                      <Badge variant="outline" className="border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                        Règlement de facture
                      </Badge>
                    )}
                    {/* Module M8: explicit warning tooltip per detected
                        anomaly, worded so the accountant immediately knows
                        why the entry was flagged. */}
                    {anomalies.map((code) => (
                      <Tooltip key={code}>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 cursor-help"
                            data-testid={`badge-anomaly-${t.id}-${code}`}
                          >
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {getAnomalyShortLabel(code)}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs bg-red-700 text-white">
                          ⚠️ {getAnomalyLabel(code)}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatDate(t.date)} · {getTransactionTypeLabel(t.type)} · {formatFcfa(t.amount)}
                    {t.paymentType === "credit" && t.dueDate && ` · Échéance ${formatDate(t.dueDate)}`}
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
                      variant={hasAnomalies ? "destructive" : "default"}
                      onClick={() => approveMutation.mutate({ id: t.id })}
                      disabled={approveMutation.isPending}
                      data-testid={`button-approve-${t.id}`}
                    >
                      {hasAnomalies ? (
                        <>
                          <ShieldAlert className="mr-1.5 h-4 w-4" />
                          Forcer la validation
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-1.5 h-4 w-4" />
                          Approuver &amp; Comptabiliser
                        </>
                      )}
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
                      {t.paymentType === "credit" ? (
                        <>
                          <p>Règlement : À crédit{t.dueDate ? ` (échéance ${formatDate(t.dueDate)})` : ""}</p>
                          <p>
                            Facture réglée :{" "}
                            {t.settledAt ? `Oui, le ${formatDateTime(t.settledAt)}` : "Non"}
                          </p>
                        </>
                      ) : (
                        <p>Mode de règlement : {getPaymentMethodLabel(t.paymentMethod)}</p>
                      )}
                      <p>Origine : {getTransactionSourceLabel(t.source)}</p>
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
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <ClipboardList className="h-3.5 w-3.5" />
                        Écriture SYSCOHADA générée
                      </p>
                      {t.paymentType === "credit" && t.status === "a_valider" && (
                        editingAccounts[t.id] ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveEditedAccounts(t.id, t.clientId)}
                            disabled={updateJournalLinesMutation.isPending}
                            data-testid={`button-save-accounts-${t.id}`}
                          >
                            <Save className="mr-1.5 h-3.5 w-3.5" />
                            Enregistrer
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditingAccounts(t.id, t.journalLines)}
                            data-testid={`button-edit-accounts-${t.id}`}
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Ajuster les comptes tiers
                          </Button>
                        )
                      )}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="text-left font-normal pb-1">Compte</th>
                          <th className="text-right font-normal pb-1">Débit</th>
                          <th className="text-right font-normal pb-1">Crédit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.journalLines.map((line) => {
                          const isEditing = editingAccounts[t.id]?.[line.id] !== undefined
                          const editedValue = isEditing ? editingAccounts[t.id][line.id] : line.accountNumber
                          const clientNotVatRegistered = vatRegisteredByClientId.get(t.clientId) === false
                          const vatFieldDisabled = clientNotVatRegistered && isVatAccount(editedValue)
                          return (
                            <tr key={line.id} className="border-t">
                              <td className="py-1.5">
                                {isEditing ? (
                                  <Input
                                    className="h-7 w-24 font-mono text-xs inline-block mr-1.5"
                                    value={editingAccounts[t.id][line.id]}
                                    disabled={clientNotVatRegistered && isVatAccount(line.accountNumber)}
                                    onChange={(e) =>
                                      setEditingAccounts((prev) => ({
                                        ...prev,
                                        [t.id]: { ...prev[t.id], [line.id]: e.target.value },
                                      }))
                                    }
                                    data-testid={`input-account-${line.id}`}
                                  />
                                ) : (
                                  <span className="font-mono text-xs mr-1.5">{line.accountNumber}</span>
                                )}
                                {line.label}
                                {vatFieldDisabled && (
                                  <span className="block text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                    Non assujetti à la TVA — compte TVA non modifiable
                                  </span>
                                )}
                              </td>
                              <td className="text-right py-1.5">
                                {line.debitAmount > 0 ? formatFcfa(line.debitAmount) : ""}
                              </td>
                              <td className="text-right py-1.5">
                                {line.creditAmount > 0 ? formatFcfa(line.creditAmount) : ""}
                              </td>
                              <td className="py-1.5 pl-1.5">
                                {(line.accountNumber[0] === "6" || line.accountNumber[0] === "7") && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5 text-primary hover:text-primary"
                                        onClick={() =>
                                          setVentilerTarget({
                                            lineId: line.id,
                                            lineLabel: line.accountNumber + (line.label ? ` ${line.label}` : ""),
                                            lineAmount: line.debitAmount > 0 ? line.debitAmount : line.creditAmount,
                                            clientId: t.clientId,
                                          })
                                        }
                                      >
                                        <GitMerge className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Ventiler analytiquement</TooltipContent>
                                  </Tooltip>
                                )}
                              </td>
                            </tr>
                          )
                        })}
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
            )
          })}
        </div>
      )}

      {ventilerTarget && (
        <VentilerDialog
          {...ventilerTarget}
          open={ventilerTarget !== null}
          onClose={() => setVentilerTarget(null)}
        />
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
