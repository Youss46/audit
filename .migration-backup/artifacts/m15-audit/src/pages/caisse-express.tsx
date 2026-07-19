import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListCashRegisters,
  getListCashRegistersQueryKey,
  useCreateCashRegister,
  useGetTodayClosure,
  getGetTodayClosureQueryKey,
  useCloseDailyClosure,
  useListTransactionCategories,
  getListTransactionCategoriesQueryKey,
  useBatchCreateTransactions,
  getListTransactionsQueryKey,
  TransactionType,
  type TransactionInput,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { formatFcfa } from "@/lib/status"
import { formatDateTime } from "@/lib/utils"
import {
  enqueueEntry,
  listQueuedEntries,
  removeQueuedEntries,
  type QueuedEntry,
} from "@/lib/offline-queue"
import { Plus, Minus, Wifi, WifiOff, RefreshCw, Lock, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// A sensible default category per movement direction, so the big +/- buttons
// stay a single tap for the common case while still letting the agent
// override the category before submitting.
const DEFAULT_CATEGORY: Record<TransactionType, string> = {
  recette: "vente_marchandises",
  depense: "autres_depenses",
}

function emptyEntryForm(type: TransactionType) {
  return {
    type,
    label: "",
    amount: "",
    category: DEFAULT_CATEGORY[type],
  }
}

// Module P5 "Caisse Terrain": the mobile-first quick-entry screen for field
// agents handling physical cash. Big +/- buttons log a movement in one tap,
// entries queue locally when offline and sync in a batch once reconnected,
// and "Clôturer la journée" reconciles the theoretical vs. physical count.
export default function CaisseExpress() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const clientId = user?.clientId ?? 0

  const [selectedRegisterId, setSelectedRegisterId] = useState<number | null>(null)
  const [newRegisterName, setNewRegisterName] = useState("")
  const [isOnline, setIsOnline] = useState(true)
  const [manualOffline, setManualOffline] = useState(false)
  const [entryForm, setEntryForm] = useState<ReturnType<typeof emptyEntryForm> | null>(null)
  const [queuedEntries, setQueuedEntries] = useState<QueuedEntry[]>([])
  const [isClosureOpen, setIsClosureOpen] = useState(false)
  const [physicalBalance, setPhysicalBalance] = useState("")
  const [closureComment, setClosureComment] = useState("")

  const effectivelyOnline = isOnline && !manualOffline

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [])

  useEffect(() => {
    setQueuedEntries(listQueuedEntries())
  }, [])

  const { data: cashRegisters } = useListCashRegisters(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListCashRegistersQueryKey({ clientId }) } },
  )

  useEffect(() => {
    if (selectedRegisterId == null && cashRegisters && cashRegisters.length > 0) {
      setSelectedRegisterId(cashRegisters[0].id)
    }
  }, [cashRegisters, selectedRegisterId])

  const createRegisterMutation = useCreateCashRegister({
    mutation: {
      onSuccess: (register) => {
        queryClient.invalidateQueries({ queryKey: getListCashRegistersQueryKey({ clientId }) })
        setSelectedRegisterId(register.id)
        setNewRegisterName("")
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de créer la caisse.",
          variant: "destructive",
        })
      },
    },
  })

  const { data: closure, isLoading: isClosureLoading } = useGetTodayClosure(selectedRegisterId ?? 0, {
    query: {
      enabled: !!selectedRegisterId,
      queryKey: getGetTodayClosureQueryKey(selectedRegisterId ?? 0),
      refetchInterval: 15000,
    },
  })

  const { data: categories } = useListTransactionCategories(
    { type: entryForm?.type ?? "recette" },
    {
      query: {
        enabled: !!entryForm,
        queryKey: getListTransactionCategoriesQueryKey({ type: entryForm?.type ?? "recette" }),
      },
    },
  )

  const invalidateAfterEntry = () => {
    if (selectedRegisterId) {
      queryClient.invalidateQueries({ queryKey: getGetTodayClosureQueryKey(selectedRegisterId) })
      queryClient.invalidateQueries({ queryKey: getListCashRegistersQueryKey({ clientId }) })
    }
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey({ clientId }) })
  }

  const createMutation = useBatchCreateTransactions({
    mutation: {
      onSuccess: (result) => {
        invalidateAfterEntry()
        if (result.errors.length > 0) {
          toast({
            title: "Opération refusée",
            description: result.errors[0]?.error ?? "Cette opération n'a pas pu être enregistrée.",
            variant: "destructive",
          })
        } else {
          toast({ title: "Opération enregistrée", description: "Le montant de la caisse a été mis à jour." })
        }
        setEntryForm(null)
      },
      onError: () => {
        toast({
          title: "Erreur",
          description: "Impossible d'enregistrer l'opération. Elle a été mise en attente.",
          variant: "destructive",
        })
      },
    },
  })

  const closeMutation = useCloseDailyClosure({
    mutation: {
      onSuccess: (result) => {
        invalidateAfterEntry()
        toast({
          title: "Journée clôturée",
          description: result.summaryTransaction
            ? "L'écart de caisse a été transmis à votre cabinet pour comptabilisation."
            : "Aucun écart constaté. La caisse est à jour.",
        })
        setIsClosureOpen(false)
        setPhysicalBalance("")
        setClosureComment("")
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de clôturer la caisse.",
          variant: "destructive",
        })
      },
    },
  })

  const buildInput = (form: ReturnType<typeof emptyEntryForm>): TransactionInput => ({
    clientId,
    date: new Date().toISOString(),
    label: form.label.trim() || (form.type === "recette" ? "Entrée de caisse" : "Sortie de caisse"),
    amount: parseInt(form.amount, 10),
    type: form.type,
    category: form.category,
    paymentType: "cash",
    paymentMethod: "especes",
    cashRegisterId: selectedRegisterId,
  })

  const handleSubmitEntry = (e: React.FormEvent) => {
    e.preventDefault()
    if (!entryForm || !selectedRegisterId) return
    const amount = parseInt(entryForm.amount, 10)
    if (!amount || amount <= 0 || !entryForm.category) return
    const input = buildInput(entryForm)

    if (!effectivelyOnline) {
      enqueueEntry(input)
      setQueuedEntries(listQueuedEntries())
      setEntryForm(null)
      toast({
        title: "Enregistré hors-ligne",
        description: "Cette opération sera synchronisée dès le retour du réseau.",
      })
      return
    }

    createMutation.mutate({ data: { entries: [input] } })
  }

  const syncMutation = useBatchCreateTransactions({
    mutation: {
      onSuccess: (result, variables) => {
        invalidateAfterEntry()
        const syncedLocalIds = queuedEntries
          .slice(0, (variables.data as { entries: TransactionInput[] }).entries.length)
          .map((e) => e.localId)
        removeQueuedEntries(syncedLocalIds)
        setQueuedEntries(listQueuedEntries())
        if (result.errors.length > 0) {
          toast({
            title: "Synchronisation partielle",
            description: `${result.created.length} opération(s) synchronisée(s), ${result.errors.length} en échec.`,
            variant: "destructive",
          })
        } else {
          toast({
            title: "Synchronisation réussie",
            description: `${result.created.length} opération(s) transmise(s) à votre cabinet.`,
          })
        }
      },
      onError: () => {
        toast({
          title: "Échec de la synchronisation",
          description: "Les opérations restent en attente sur cet appareil.",
          variant: "destructive",
        })
      },
    },
  })

  const handleSync = () => {
    if (queuedEntries.length === 0) return
    syncMutation.mutate({ data: { entries: queuedEntries.map((e) => e.input) } })
  }

  useEffect(() => {
    if (effectivelyOnline && queuedEntries.length > 0 && !syncMutation.isPending) {
      handleSync()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivelyOnline])

  const liveBalance = closure?.liveBalance ?? 0
  const discrepancyPreview = useMemo(() => {
    const physical = parseInt(physicalBalance, 10)
    if (isNaN(physical)) return null
    return physical - liveBalance
  }, [physicalBalance, liveBalance])

  const handleClose = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRegisterId || !closure) return
    const physical = parseInt(physicalBalance, 10)
    if (isNaN(physical) || physical < 0) return
    if (discrepancyPreview !== 0 && !closureComment.trim()) return
    closeMutation.mutate({
      id: selectedRegisterId,
      closureId: closure.id,
      data: { physicalClosingBalance: physical, comment: closureComment.trim() || null },
    })
  }

  if (!clientId) return null

  if (cashRegisters && cashRegisters.length === 0) {
    return (
      <div className="max-w-md mx-auto mt-10 space-y-4">
        <div className="text-center">
          <Wallet className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <h1 className="text-2xl font-bold tracking-tight">Caisse Terrain</h1>
          <p className="text-muted-foreground mt-1">
            Créez votre première caisse pour commencer à enregistrer vos opérations en espèces.
          </p>
        </div>
        <Card>
          <CardContent className="p-4 space-y-3">
            <Label htmlFor="newRegister">Nom de la caisse</Label>
            <Input
              id="newRegister"
              placeholder="Ex : Caisse principale"
              value={newRegisterName}
              onChange={(e) => setNewRegisterName(e.target.value)}
              data-testid="input-new-cash-register"
            />
            <Button
              className="w-full"
              disabled={!newRegisterName.trim() || createRegisterMutation.isPending}
              onClick={() => createRegisterMutation.mutate({ data: { name: newRegisterName.trim(), clientId } })}
              data-testid="button-create-cash-register"
            >
              Créer la caisse
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Caisse Express</h1>
          <p className="text-sm text-muted-foreground">Enregistrez vos mouvements de caisse en un tap.</p>
        </div>
        <Badge
          variant="outline"
          className={
            effectivelyOnline
              ? "border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1"
              : "border-transparent bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 gap-1"
          }
          data-testid="badge-connection-status"
        >
          {effectivelyOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {effectivelyOnline ? "En ligne" : "Hors-ligne"}
        </Badge>
      </div>

      {(cashRegisters?.length ?? 0) > 1 && (
        <Select
          value={selectedRegisterId ? String(selectedRegisterId) : ""}
          onValueChange={(v) => setSelectedRegisterId(parseInt(v, 10))}
        >
          <SelectTrigger data-testid="select-cash-register">
            <SelectValue placeholder="Sélectionner une caisse..." />
          </SelectTrigger>
          <SelectContent>
            {(cashRegisters ?? []).map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Card className="shadow-sm">
        <CardContent className="p-6 text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Solde actuel</div>
          <div className="text-4xl font-bold mt-1" data-testid="text-live-balance">
            {isClosureLoading ? "…" : formatFcfa(liveBalance)}
          </div>
          {closure?.status === "CLOSED" && (
            <Badge variant="outline" className="mt-2 border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              Journée déjà clôturée
            </Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Button
          className="h-24 text-lg flex-col gap-1 bg-green-600 hover:bg-green-700"
          onClick={() => setEntryForm(emptyEntryForm("recette"))}
          disabled={!selectedRegisterId}
          data-testid="button-quick-entree"
        >
          <Plus className="h-7 w-7" />
          Entrée
        </Button>
        <Button
          className="h-24 text-lg flex-col gap-1 bg-red-600 hover:bg-red-700"
          onClick={() => setEntryForm(emptyEntryForm("depense"))}
          disabled={!selectedRegisterId}
          data-testid="button-quick-sortie"
        >
          <Minus className="h-7 w-7" />
          Sortie
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setManualOffline((v) => !v)}
          data-testid="button-toggle-offline"
        >
          {manualOffline ? "Simuler : revenir en ligne" : "Simuler le mode hors-ligne"}
        </Button>
        {queuedEntries.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSync}
            disabled={!effectivelyOnline || syncMutation.isPending}
            data-testid="button-sync-queue"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Synchroniser ({queuedEntries.length})
          </Button>
        )}
      </div>

      {queuedEntries.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">En attente de synchronisation</div>
            {queuedEntries.map((e) => (
              <div key={e.localId} className="flex items-center justify-between text-sm" data-testid={`row-queued-${e.localId}`}>
                <span className="truncate pr-2">{e.input.label}</span>
                <span className={e.input.type === "recette" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                  {e.input.type === "recette" ? "+" : "-"}
                  {formatFcfa(e.input.amount)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setPhysicalBalance("")
          setClosureComment("")
          setIsClosureOpen(true)
        }}
        disabled={!closure || closure.status === "CLOSED"}
        data-testid="button-open-closure"
      >
        <Lock className="mr-2 h-4 w-4" />
        Clôturer la journée
      </Button>

      <Dialog open={!!entryForm} onOpenChange={(open) => !open && setEntryForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {entryForm?.type === "recette" ? "Nouvelle entrée" : "Nouvelle sortie"}
            </DialogTitle>
            <DialogDescription>
              Montant, motif et catégorie -- le reste est déjà pré-rempli pour aller vite.
            </DialogDescription>
          </DialogHeader>
          {entryForm && (
            <form onSubmit={handleSubmitEntry} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="entryAmount">Montant (FCFA)</Label>
                <AmountInput
                  id="entryAmount"
                  min={1}
                  autoFocus
                  placeholder="0"
                  value={entryForm.amount}
                  onChange={(e) => setEntryForm((f) => (f ? { ...f, amount: e.target.value } : f))}
                  data-testid="input-entry-amount"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entryLabel">Libellé (optionnel)</Label>
                <Input
                  id="entryLabel"
                  placeholder={entryForm.type === "recette" ? "Ex : Vente du jour" : "Ex : Achat fournitures"}
                  value={entryForm.label}
                  onChange={(e) => setEntryForm((f) => (f ? { ...f, label: e.target.value } : f))}
                  data-testid="input-entry-label"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entryCategory">Catégorie</Label>
                <Select
                  value={entryForm.category}
                  onValueChange={(v) => setEntryForm((f) => (f ? { ...f, category: v } : f))}
                >
                  <SelectTrigger id="entryCategory" data-testid="select-entry-category">
                    <SelectValue placeholder="Sélectionner une catégorie..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEntryForm(null)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-entry">
                  {createMutation.isPending ? "Envoi..." : "Enregistrer"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isClosureOpen} onOpenChange={setIsClosureOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clôture de caisse</DialogTitle>
            <DialogDescription>
              Comptez l'argent physiquement présent dans la caisse et indiquez le montant.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleClose} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Solde théorique</div>
                <div className="font-semibold">{formatFcfa(liveBalance)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Ouverture du jour</div>
                <div className="font-semibold">{formatFcfa(closure?.openingBalance)}</div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="physicalBalance">Montant compté physiquement (FCFA)</Label>
              <AmountInput
                id="physicalBalance"
                min={0}
                value={physicalBalance}
                onChange={(e) => setPhysicalBalance(e.target.value)}
                data-testid="input-physical-balance"
                required
              />
            </div>
            {discrepancyPreview !== null && discrepancyPreview !== 0 && (
              <div className="space-y-2">
                <p
                  className={`text-sm font-medium ${discrepancyPreview > 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
                  data-testid="text-discrepancy"
                >
                  Écart : {discrepancyPreview > 0 ? "+" : ""}
                  {formatFcfa(discrepancyPreview)}
                </p>
                <Label htmlFor="closureComment">Justification de l'écart (obligatoire)</Label>
                <Textarea
                  id="closureComment"
                  value={closureComment}
                  onChange={(e) => setClosureComment(e.target.value)}
                  placeholder="Expliquez l'origine de l'écart..."
                  data-testid="input-closure-comment"
                  required
                />
              </div>
            )}
            {discrepancyPreview === 0 && (
              <p className="text-sm text-green-700 dark:text-green-400" data-testid="text-discrepancy-zero">
                Aucun écart. La caisse correspond au solde théorique.
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsClosureOpen(false)} disabled={closeMutation.isPending}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={
                  closeMutation.isPending ||
                  !physicalBalance ||
                  (discrepancyPreview !== 0 && !closureComment.trim())
                }
                data-testid="button-confirm-closure"
              >
                {closeMutation.isPending ? "Clôture..." : "Clôturer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
