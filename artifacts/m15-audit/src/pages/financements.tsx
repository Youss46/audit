import { useState, useMemo } from "react"
import { useRoute } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListFinancialItems,
  getListFinancialItemsQueryKey,
  useCreateFinancialItem,
  useUpdateFinancialItem,
  useGetFinancialItemSchedule,
  getGetFinancialItemScheduleQueryKey,
  useGenerateFinanceJournalEntries,
  getListTransactionsQueryKey,
  useRenegotiateFinancialItem,
  usePrepayFinancialItem,
} from "@workspace/api-client-react"
import type { FinancialItemType } from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import {
  getFinancialItemTypeLabel,
  getFinancialItemStatusLabel,
  getFinancialItemStatusColor,
  getPaymentFrequencyLabel,
} from "@/lib/status"
import { cn, formatDate } from "@/lib/utils"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import {
  Landmark,
  Plus,
  AlertTriangle,
  Loader2,
  RefreshCw,
  HandCoins,
  TrendingDown,
  CheckCircle2,
  Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

// ---------------------------------------------------------------------------
// Module M18 — Financements & Dettes (Immobilisations Financières & Emprunts).
// Accessible at /cabinet/client/:clientId/finance.
// ---------------------------------------------------------------------------

type PaymentFrequencyValue = "MENSUEL" | "TRIMESTRIEL" | "ANNUEL"

// ---------------------------------------------------------------------------
// SYSCOHADA account catalogues for Classe 16 (Emprunts) and Classe 27
// (Immobilisations Financières). Pre-loaded so the accountant never has to
// memorise account codes.
// ---------------------------------------------------------------------------

interface AccountPreset {
  number: string
  label: string
}

const LOAN_ACCOUNTS: AccountPreset[] = [
  { number: "161100", label: "Emprunts auprès des établissements de crédit" },
  { number: "161200", label: "Dettes auprès des établissements de crédit" },
  { number: "162000", label: "Emprunts obligataires" },
  { number: "163000", label: "Avances et acomptes reçus" },
  { number: "164000", label: "Dépôts et cautionnements reçus" },
  { number: "165000", label: "Effets à payer à long terme" },
  { number: "166000", label: "Participation des salariés aux résultats" },
  { number: "167000", label: "Emprunts et dettes assimilées" },
  { number: "168000", label: "Intérêts courus sur emprunts" },
]

const FINANCIAL_ASSET_ACCOUNTS: AccountPreset[] = [
  { number: "271000", label: "Titres de placement — actions" },
  { number: "272000", label: "Titres de placement — obligations" },
  { number: "273000", label: "Prêts et avances accordés" },
  { number: "274000", label: "Prêts au personnel" },
  { number: "275000", label: "Dépôts et cautionnements versés" },
  { number: "276000", label: "Intérêts courus sur prêts accordés" },
]

const ACCOUNT_LOOKUP = new Map<string, string>(
  [...LOAN_ACCOUNTS, ...FINANCIAL_ASSET_ACCOUNTS].map((a) => [a.number, a.label]),
)

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface AddFormState {
  type: FinancialItemType
  accountNumber: string
  label: string
  principalAmount: string
  annualInterestRate: string
  startDate: string
  termMonths: string
  paymentFrequency: PaymentFrequencyValue
}

function emptyForm(type: FinancialItemType): AddFormState {
  return {
    type,
    accountNumber: "",
    label: "",
    principalAmount: "",
    annualInterestRate: "0",
    startDate: "",
    termMonths: "12",
    paymentFrequency: "MENSUEL",
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Financements() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/finance")
  const clientId   = params?.clientId ? Number(params.clientId) : null

  const [activeTab, setActiveTab] = useState<FinancialItemType>("EMPRUNT_BANCAIRE")
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState<AddFormState>(emptyForm("EMPRUNT_BANCAIRE"))
  const [addError, setAddError] = useState<string | null>(null)
  // "catalogue" | "custom" — same UX pattern as M17 immobilisations form
  const [accountPickerMode, setAccountPickerMode] = useState<"catalogue" | "custom">("catalogue")

  const [scheduleItemId, setScheduleItemId] = useState<number | null>(null)
  const [showSchedule, setShowSchedule]     = useState(false)
  // Renegotiation dialog
  const [showRenegotiateModal, setShowRenegotiateModal] = useState(false)
  const [renegotiateItemId, setRenegotiateItemId] = useState<number | null>(null)
  const [renegotiateForm, setRenegotiateForm] = useState({ newAnnualInterestRate: "", newTermMonths: "", renegotiationDate: "", note: "" })
  const [renegotiateError, setRenegotiateError] = useState<string | null>(null)
  // Prepayment dialog
  const [showPrepayModal, setShowPrepayModal] = useState(false)
  const [prepayItemId, setPrepayItemId] = useState<number | null>(null)
  const [prepayForm, setPrepayForm] = useState({ amount: "", date: "", note: "" })
  const [prepayError, setPrepayError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const itemsParams = { clientId: clientId ?? 0, type: activeTab }
  const { data: items, isLoading: itemsLoading } = useListFinancialItems(
    itemsParams,
    { query: { enabled: !!clientId, queryKey: getListFinancialItemsQueryKey(itemsParams) } },
  )

  const { data: schedule, isLoading: scheduleLoading } = useGetFinancialItemSchedule(
    scheduleItemId ?? 0,
    {
      query: {
        enabled:  !!scheduleItemId && showSchedule,
        queryKey: getGetFinancialItemScheduleQueryKey(scheduleItemId ?? 0),
      },
    },
  )

  const scheduleItem = scheduleItemId ? items?.find((i) => i.id === scheduleItemId) : null

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const invalidateItems = () =>
    queryClient.invalidateQueries({ queryKey: getListFinancialItemsQueryKey() })

  const createMutation = useCreateFinancialItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Élément enregistré", description: "Le tableau d'amortissement a été calculé automatiquement." })
        setShowAddModal(false)
        setAddForm(emptyForm(activeTab))
        setAddError(null)
        setAccountPickerMode("catalogue")
        invalidateItems()
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur s'est produite."
        setAddError(msg)
      },
    },
  })

  const updateMutation = useUpdateFinancialItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Élément mis à jour" })
        invalidateItems()
      },
      onError: () => toast({ title: "Erreur lors de la mise à jour", variant: "destructive" }),
    },
  })

  const renegotiateMutation = useRenegotiateFinancialItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Renégociation effectuée", description: "Le tableau d'amortissement a été recalculé avec les nouveaux paramètres." })
        setShowRenegotiateModal(false)
        setRenegotiateItemId(null)
        setRenegotiateForm({ newAnnualInterestRate: "", newTermMonths: "", renegotiationDate: "", note: "" })
        setRenegotiateError(null)
        invalidateItems()
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } }
        setRenegotiateError(e.data?.error || "Erreur lors de la renégociation.")
      },
    },
  })

  const prepayMutation = usePrepayFinancialItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Remboursement anticipé enregistré", description: "Le capital résiduel a été recalculé." })
        setShowPrepayModal(false)
        setPrepayItemId(null)
        setPrepayForm({ amount: "", date: "", note: "" })
        setPrepayError(null)
        invalidateItems()
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } }
        setPrepayError(e.data?.error || "Erreur lors du remboursement anticipé.")
      },
    },
  })

  const generateMutation = useGenerateFinanceJournalEntries({
    mutation: {
      onSuccess: (data) => {
        const { generated } = data as { generated: unknown[]; skipped: unknown[] }
        if (generated.length === 0) {
          toast({ title: "Aucune nouvelle échéance à traiter pour le moment." })
        } else {
          toast({
            title: "Échéances générées",
            description: "Les écritures d'échéances ont été générées avec succès (statut : à valider).",
          })
        }
        invalidateItems()
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() })
      },
      onError: () => toast({ title: "Erreur lors de la génération", variant: "destructive" }),
    },
  })

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const activeItems   = items?.filter((i) => i.status === "ACTIF") ?? []
  const totalPrincipal = (items ?? []).reduce((s, i) => s + i.principalAmount,   0)
  const totalRemaining = (items ?? []).reduce((s, i) => s + i.remainingCapital,  0)
  const totalInterest  = (items ?? []).reduce((s, i) => s + i.totalInterest,     0)
  const isLoan         = activeTab === "EMPRUNT_BANCAIRE"

  // Schedule summary derived from rows
  const scheduleSummary = useMemo(() => {
    if (!schedule) return null
    const rows = schedule.rows ?? []
    const postedRows  = rows.filter((r) => r.posted)
    const pendingRows = rows.filter((r) => !r.posted)
    return {
      totalRows:         rows.length,
      postedCount:       postedRows.length,
      pendingCount:      pendingRows.length,
      totalAnnuity:      rows.reduce((s, r) => s + r.annuity,        0),
      totalInterest:     rows.reduce((s, r) => s + r.interestAmount, 0),
      totalPrincipal:    rows.reduce((s, r) => s + r.principalAmount, 0),
      postedAnnuity:     postedRows.reduce((s, r)  => s + r.annuity,        0),
      postedInterest:    postedRows.reduce((s, r)  => s + r.interestAmount, 0),
      pendingAnnuity:    pendingRows.reduce((s, r) => s + r.annuity,        0),
      progressPct:       rows.length > 0 ? Math.round((postedRows.length / rows.length) * 100) : 0,
    }
  }, [schedule])

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function openSchedule(itemId: number) {
    setScheduleItemId(itemId)
    setShowSchedule(true)
  }

  function handleSolde(itemId: number) {
    updateMutation.mutate({ id: itemId, data: { status: "SOLDE" } })
  }

  function handleAccountSelect(value: string) {
    if (value === "__custom__") {
      setAccountPickerMode("custom")
      setAddForm((f) => ({ ...f, accountNumber: "" }))
      return
    }
    const label = ACCOUNT_LOOKUP.get(value) ?? ""
    setAddForm((f) => ({
      ...f,
      accountNumber: value,
      label: f.label || label,
    }))
  }

  function handleAddSubmit() {
    setAddError(null)
    if (!clientId) return
    if (!addForm.accountNumber.trim()) { setAddError("Le numéro de compte est requis."); return }
    if (!addForm.label.trim())         { setAddError("La désignation est requise."); return }
    if (!addForm.startDate)            { setAddError("La date de départ est requise."); return }
    const principal = parseInt(addForm.principalAmount, 10)
    if (!principal || principal <= 0)  { setAddError("Le montant nominal doit être un entier positif."); return }
    const term = parseInt(addForm.termMonths, 10)
    if (!term || term < 1)             { setAddError("La durée doit être d'au moins 1 mois."); return }
    const rate = parseFloat(addForm.annualInterestRate) || 0
    if (rate < 0)                      { setAddError("Le taux d'intérêt ne peut pas être négatif."); return }

    createMutation.mutate({
      data: {
        clientId,
        type: addForm.type,
        accountNumber: addForm.accountNumber.trim(),
        label: addForm.label.trim(),
        principalAmount: principal,
        annualInterestRate: rate,
        startDate: new Date(addForm.startDate).toISOString(),
        termMonths: term,
        paymentFrequency: addForm.paymentFrequency,
      },
    })
  }

  function handleGenerateEntries() {
    if (!clientId) return
    generateMutation.mutate({ clientId })
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const catalogueAccounts = activeTab === "EMPRUNT_BANCAIRE" ? LOAN_ACCOUNTS : FINANCIAL_ASSET_ACCOUNTS

  return (
    <div className="space-y-6">

      {/* ------------------------------------------------------------------ */}
      {/* Client selector + tab navigation (shared with accounting views)    */}
      {/* ------------------------------------------------------------------ */}
      <ClientAccountingNav activeTab="finance" />

      {/* ------------------------------------------------------------------ */}
      {/* Empty state — no client selected                                   */}
      {/* ------------------------------------------------------------------ */}
      {!clientId ? (
        <Card className="shadow-sm">
          <CardContent className="p-16 flex flex-col items-center justify-center gap-4 text-center text-muted-foreground">
            <Landmark className="h-10 w-10 opacity-20" />
            <div>
              <p className="font-medium">Sélectionnez un client</p>
              <p className="text-sm mt-1">
                Choisissez un client dans le menu ci-dessus pour accéder à ses
                emprunts bancaires et immobilisations financières.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---------------------------------------------------------------- */}
          {/* Page header                                                      */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Landmark className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight">Financements &amp; Dettes</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Immobilisations Financières &amp; Emprunts SYSCOHADA
                </p>
              </div>
            </div>
            <Button
              onClick={() => {
                setAddForm(emptyForm(activeTab))
                setAddError(null)
                setAccountPickerMode("catalogue")
                setShowAddModal(true)
              }}
              className="w-full sm:w-auto shrink-0"
            >
              <Plus className="h-4 w-4 mr-2" />
              {isLoan ? "Ajouter un emprunt" : "Ajouter une immobilisation financière"}
            </Button>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Type tabs                                                        */}
          {/* ---------------------------------------------------------------- */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FinancialItemType)}>
            <TabsList>
              <TabsTrigger value="EMPRUNT_BANCAIRE">Emprunts Bancaires</TabsTrigger>
              <TabsTrigger value="IMMOBILISATION_FINANCIERE">Immobilisations Financières</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* ---------------------------------------------------------------- */}
          {/* Generate journal entries                                         */}
          {/* ---------------------------------------------------------------- */}
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
                  Traiter les échéances dues
                </Label>
                <p className="text-sm text-muted-foreground max-w-lg">
                  Génère automatiquement une écriture «&nbsp;à valider&nbsp;» pour chaque
                  échéance (capital&nbsp;+ intérêts) arrivée à terme sur l'ensemble des
                  éléments actifs de ce client.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={generateMutation.isPending || activeItems.length === 0}
                    className="shrink-0"
                  >
                    {generateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Générer les échéances
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Générer les écritures d'échéances</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action créera une écriture comptable «&nbsp;à valider&nbsp;» pour
                      chaque échéance due à ce jour et non encore comptabilisée, pour tous les
                      emprunts et immobilisations financières actifs de ce client (tous types
                      confondus). Les écritures apparaîtront dans la file M3 pour validation.
                      <br /><br />
                      Une échéance déjà comptabilisée ne peut pas être générée deux fois.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={handleGenerateEntries}>
                      Générer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* ---------------------------------------------------------------- */}
          {/* Summary KPIs                                                     */}
          {/* ---------------------------------------------------------------- */}
          {items && items.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">{isLoan ? "Emprunts" : "Immobilisations"}</p>
                  <p className="text-2xl font-bold mt-1">{items.length}</p>
                  <p className="text-xs text-muted-foreground">{activeItems.length} actif(s)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Montant nominal total</p>
                  <p className="text-xl font-bold mt-1 tabular-nums">{totalPrincipal.toLocaleString("fr-FR")}</p>
                  <p className="text-xs text-muted-foreground">FCFA</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Capital restant dû</p>
                  <p className="text-xl font-bold mt-1 tabular-nums text-primary">{totalRemaining.toLocaleString("fr-FR")}</p>
                  <p className="text-xs text-muted-foreground">
                    {totalPrincipal > 0
                      ? `${Math.round(((totalPrincipal - totalRemaining) / totalPrincipal) * 100)}\u00a0% remboursé`
                      : "FCFA"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Intérêts totaux (prévisionnel)</p>
                  <p className="text-xl font-bold mt-1 tabular-nums text-orange-600">{totalInterest.toLocaleString("fr-FR")}</p>
                  <p className="text-xs text-muted-foreground">FCFA</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Registry table                                                   */}
          {/* ---------------------------------------------------------------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {isLoan ? "Tableau des emprunts bancaires" : "Tableau des immobilisations financières"}
                {!itemsLoading && items && items.length > 0 && (
                  <Badge variant="outline" className="font-normal text-xs">
                    {items.length} élément{items.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {itemsLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Chargement…
                </div>
              ) : !items || items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
                  <HandCoins className="h-8 w-8 opacity-30" />
                  <p className="text-sm">
                    {isLoan ? "Aucun emprunt enregistré." : "Aucune immobilisation financière enregistrée."}
                  </p>
                  <p className="text-xs">Cliquez sur «&nbsp;Ajouter&nbsp;» pour commencer.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Compte</TableHead>
                        <TableHead>Désignation</TableHead>
                        <TableHead>Départ</TableHead>
                        <TableHead className="text-right">Montant nominal</TableHead>
                        <TableHead>Taux / Périodicité</TableHead>
                        <TableHead>Prochaine échéance</TableHead>
                        <TableHead className="text-right">Avancement</TableHead>
                        <TableHead className="text-right font-semibold">Capital restant dû</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead className="pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => {
                        const pct = item.totalInstallments > 0
                          ? Math.round((item.installmentsPosted / item.totalInstallments) * 100)
                          : 0
                        return (
                          <TableRow
                            key={item.id}
                            className="cursor-pointer hover:bg-muted/40 transition-colors"
                            onClick={() => openSchedule(item.id)}
                          >
                            <TableCell className="pl-6">
                              <span className="font-mono text-sm">{item.accountNumber}</span>
                              {ACCOUNT_LOOKUP.has(item.accountNumber) && (
                                <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                                  {ACCOUNT_LOOKUP.get(item.accountNumber)}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="font-medium max-w-[180px] truncate" title={item.label}>
                              {item.label}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                              {formatDate(item.startDate)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-sm">
                              {item.principalAmount.toLocaleString("fr-FR")}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {item.annualInterestRate}&nbsp;% / {getPaymentFrequencyLabel(item.paymentFrequency)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {item.nextDueDate ? (
                                <>
                                  {formatDate(item.nextDueDate)}
                                  <span className="text-xs"> (n°{item.nextInstallmentNumber})</span>
                                </>
                              ) : (
                                <span className="italic text-muted-foreground/60">Soldé</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2 min-w-[90px]">
                                <Progress value={pct} className="h-1.5 w-16" />
                                <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">
                                  {pct}&nbsp;%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold font-mono text-sm text-primary">
                              {item.remainingCapital.toLocaleString("fr-FR")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "border-transparent text-xs",
                                  getFinancialItemStatusColor(item.status),
                                )}
                              >
                                {getFinancialItemStatusLabel(item.status)}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className="pr-6 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.status === "ACTIF" && (
                                <div className="flex justify-end gap-1 flex-wrap">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7 px-2 text-muted-foreground hover:text-primary"
                                    disabled={updateMutation.isPending}
                                    onClick={() => {
                                      setRenegotiateItemId(item.id)
                                      setRenegotiateForm({ newAnnualInterestRate: String(item.annualInterestRate), newTermMonths: String(item.termMonths), renegotiationDate: new Date().toISOString().slice(0, 10), note: "" })
                                      setRenegotiateError(null)
                                      setShowRenegotiateModal(true)
                                    }}
                                  >
                                    Renégocier
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7 px-2 text-muted-foreground hover:text-primary"
                                    disabled={updateMutation.isPending}
                                    onClick={() => {
                                      setPrepayItemId(item.id)
                                      setPrepayForm({ amount: "", date: new Date().toISOString().slice(0, 10), note: "" })
                                      setPrepayError(null)
                                      setShowPrepayModal(true)
                                    }}
                                  >
                                    Prépayer
                                  </Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs h-7 px-2 text-muted-foreground hover:text-destructive"
                                        disabled={updateMutation.isPending}
                                      >
                                        Solder
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Solder «&nbsp;{item.label}&nbsp;»&nbsp;?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          L'élément sera marqué «&nbsp;Soldé&nbsp;». Il reste visible dans
                                          le registre mais n'apparaîtra plus dans la génération future des
                                          échéances.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                                        <AlertDialogAction
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                          onClick={() => handleSolde(item.id)}
                                        >
                                          Confirmer
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Add Item Dialog                                                     */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {addForm.type === "EMPRUNT_BANCAIRE"
                ? "Ajouter un emprunt bancaire"
                : "Ajouter une immobilisation financière"}
            </DialogTitle>
            <DialogDescription>
              Sélectionnez un compte SYSCOHADA pour pré-remplir la désignation, ou
              saisissez librement. Le tableau d'amortissement sera calculé automatiquement
              (méthode des annuités constantes).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {addError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {addError}
              </div>
            )}

            {/* ---- Type selector ---- */}
            <div className="space-y-1.5">
              <Label htmlFor="type">
                Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={addForm.type}
                onValueChange={(v) => {
                  setAddForm(emptyForm(v as FinancialItemType))
                  setAccountPickerMode("catalogue")
                }}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMPRUNT_BANCAIRE">Emprunt bancaire (Classe 16)</SelectItem>
                  <SelectItem value="IMMOBILISATION_FINANCIERE">Immobilisation financière (Classe 27)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ---- SYSCOHADA account picker ---- */}
            <div className="space-y-2">
              <Label>
                Compte SYSCOHADA <span className="text-destructive">*</span>
              </Label>
              {accountPickerMode === "catalogue" ? (
                <div className="space-y-2">
                  <Select
                    value={addForm.accountNumber || undefined}
                    onValueChange={handleAccountSelect}
                  >
                    <SelectTrigger data-testid="select-account-number">
                      <SelectValue placeholder="Sélectionner un compte…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="__custom__" className="text-muted-foreground italic">
                        ✏️ Saisir un compte personnalisé…
                      </SelectItem>
                      <Separator className="my-1" />
                      {catalogueAccounts.map((acct) => (
                        <SelectItem key={acct.number} value={acct.number}>
                          <span className="font-mono text-xs mr-2 text-muted-foreground">{acct.number}</span>
                          {acct.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {addForm.accountNumber && (
                    <p className="text-xs text-muted-foreground">
                      Compte sélectionné :{" "}
                      <span className="font-mono font-medium text-foreground">{addForm.accountNumber}</span>
                      {" — "}La désignation a été pré-remplie. Ajustez si nécessaire.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder={addForm.type === "EMPRUNT_BANCAIRE" ? "161100" : "274000"}
                    value={addForm.accountNumber}
                    onChange={(e) => setAddForm((f) => ({ ...f, accountNumber: e.target.value }))}
                    className="font-mono"
                  />
                  <button
                    type="button"
                    className="text-xs text-primary underline underline-offset-2"
                    onClick={() => { setAccountPickerMode("catalogue"); setAddForm((f) => ({ ...f, accountNumber: "" })) }}
                  >
                    ← Utiliser le catalogue SYSCOHADA
                  </button>
                </div>
              )}
            </div>

            {/* ---- Label ---- */}
            <div className="space-y-1.5">
              <Label htmlFor="label">
                Désignation <span className="text-destructive">*</span>
              </Label>
              <Input
                id="label"
                placeholder={addForm.type === "EMPRUNT_BANCAIRE" ? "Emprunt BOA Rénovation" : "Dépôt de garantie Loyer"}
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            {/* ---- Dates & duration ---- */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">
                  Date de départ (1ère échéance) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={addForm.startDate}
                  onChange={(e) => setAddForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="termMonths">
                  Durée (mois) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="termMonths"
                  type="number"
                  min={1}
                  max={600}
                  value={addForm.termMonths}
                  onChange={(e) => setAddForm((f) => ({ ...f, termMonths: e.target.value }))}
                />
              </div>
            </div>

            {/* ---- Amounts & rate ---- */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="principalAmount">
                  Montant nominal (FCFA) <span className="text-destructive">*</span>
                </Label>
                <AmountInput
                  id="principalAmount"
                  min={1}
                  placeholder="5 000 000"
                  value={addForm.principalAmount}
                  onChange={(e) => setAddForm((f) => ({ ...f, principalAmount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="annualInterestRate">
                  Taux d'intérêt annuel (%)
                </Label>
                <Input
                  id="annualInterestRate"
                  type="number"
                  min={0}
                  step="0.01"
                  value={addForm.annualInterestRate}
                  onChange={(e) => setAddForm((f) => ({ ...f, annualInterestRate: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Laissez à 0 pour un dépôt de garantie ou une avance sans intérêts.
                </p>
              </div>
            </div>

            {/* ---- Payment frequency ---- */}
            <div className="space-y-1.5">
              <Label htmlFor="paymentFrequency">
                Périodicité des échéances <span className="text-destructive">*</span>
              </Label>
              <Select
                value={addForm.paymentFrequency}
                onValueChange={(v) =>
                  setAddForm((f) => ({ ...f, paymentFrequency: v as PaymentFrequencyValue }))
                }
              >
                <SelectTrigger id="paymentFrequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MENSUEL">Mensuelle</SelectItem>
                  <SelectItem value="TRIMESTRIEL">Trimestrielle</SelectItem>
                  <SelectItem value="ANNUEL">Annuelle</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Annuler
            </Button>
            <Button onClick={handleAddSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Amortization Schedule Drawer                                        */}
      {/* ------------------------------------------------------------------ */}
      {/* ---- Renegotiation Dialog ---- */}
      <Dialog open={showRenegotiateModal} onOpenChange={(v) => { setShowRenegotiateModal(v); if (!v) setRenegotiateError(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renégociation — {items?.find((i) => i.id === renegotiateItemId)?.label}</DialogTitle>
            <DialogDescription>
              Saisissez les nouveaux paramètres. Le capital restant dû actuel sera maintenu et le tableau d'amortissement sera recalculé à partir de la date de renégociation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nouveau taux annuel (%)</Label>
              <Input type="number" min="0" step="0.1" value={renegotiateForm.newAnnualInterestRate}
                onChange={(e) => setRenegotiateForm((f) => ({ ...f, newAnnualInterestRate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Nouvelle durée (mois)</Label>
              <Input type="number" min="1" value={renegotiateForm.newTermMonths}
                onChange={(e) => setRenegotiateForm((f) => ({ ...f, newTermMonths: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Date de renégociation</Label>
              <Input type="date" value={renegotiateForm.renegotiationDate}
                onChange={(e) => setRenegotiateForm((f) => ({ ...f, renegotiationDate: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Note (optionnel)</Label>
              <Input value={renegotiateForm.note} placeholder="Motif de la renégociation…"
                onChange={(e) => setRenegotiateForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            {renegotiateError && <p className="text-sm text-destructive">{renegotiateError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenegotiateModal(false)}>Annuler</Button>
            <Button
              disabled={renegotiateMutation.isPending}
              onClick={() => {
                if (!renegotiateItemId) return
                const rate = parseFloat(renegotiateForm.newAnnualInterestRate)
                const term = parseInt(renegotiateForm.newTermMonths, 10)
                if (isNaN(rate) || rate < 0) { setRenegotiateError("Taux invalide."); return }
                if (!term || term < 1) { setRenegotiateError("Durée invalide."); return }
                if (!renegotiateForm.renegotiationDate) { setRenegotiateError("Date requise."); return }
                renegotiateMutation.mutate({ id: renegotiateItemId, data: { newAnnualInterestRate: rate, newTermMonths: term, renegotiationDate: renegotiateForm.renegotiationDate, note: renegotiateForm.note || undefined } })
              }}
            >
              {renegotiateMutation.isPending ? "Traitement…" : "Confirmer la renégociation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Prepayment Dialog ---- */}
      <Dialog open={showPrepayModal} onOpenChange={(v) => { setShowPrepayModal(v); if (!v) setPrepayError(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remboursement anticipé — {items?.find((i) => i.id === prepayItemId)?.label}</DialogTitle>
            <DialogDescription>
              Saisissez le montant du remboursement anticipé. Le capital résiduel sera recalculé et un nouveau tableau d'amortissement sera généré.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Montant remboursé (FCFA)</Label>
              <AmountInput min={1} value={prepayForm.amount} placeholder="0"
                onChange={(e) => setPrepayForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Date du remboursement</Label>
              <Input type="date" value={prepayForm.date}
                onChange={(e) => setPrepayForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Note (optionnel)</Label>
              <Input value={prepayForm.note} placeholder="Ex : remboursement exceptionnel S2…"
                onChange={(e) => setPrepayForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            {prepayError && <p className="text-sm text-destructive">{prepayError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPrepayModal(false)}>Annuler</Button>
            <Button
              disabled={prepayMutation.isPending}
              onClick={() => {
                if (!prepayItemId) return
                const amount = parseInt(prepayForm.amount, 10)
                if (!amount || amount <= 0) { setPrepayError("Montant invalide."); return }
                if (!prepayForm.date) { setPrepayError("Date requise."); return }
                prepayMutation.mutate({ id: prepayItemId, data: { amount, date: prepayForm.date, note: prepayForm.note || undefined } })
              }}
            >
              {prepayMutation.isPending ? "Traitement…" : "Confirmer le remboursement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={showSchedule} onOpenChange={setShowSchedule}>
        <SheetContent side="right" className="w-full sm:w-[760px] sm:max-w-none overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Tableau d'amortissement financier
            </SheetTitle>
            {scheduleItem && (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-mono text-foreground">{scheduleItem.accountNumber}</span>
                  {" — "}
                  <span className="font-medium text-foreground">{scheduleItem.label}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    {getFinancialItemTypeLabel(scheduleItem.type)}
                  </Badge>
                  <Badge variant="outline" className="text-xs font-normal">
                    Nominal : {scheduleItem.principalAmount.toLocaleString("fr-FR")} FCFA
                  </Badge>
                  <Badge variant="outline" className="text-xs font-normal">
                    {scheduleItem.annualInterestRate}&nbsp;% / an
                  </Badge>
                  <Badge variant="outline" className="text-xs font-normal">
                    {getPaymentFrequencyLabel(scheduleItem.paymentFrequency)}
                  </Badge>
                </div>
              </div>
            )}
          </SheetHeader>

          <Separator className="mb-4" />

          {scheduleLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Calcul du tableau…
            </div>
          ) : !schedule || schedule.rows.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              Aucune donnée d'amortissement disponible.
            </p>
          ) : scheduleSummary ? (
            <div className="space-y-4">
              {/* ---- Progress summary ---- */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Échéances</p>
                  <p className="text-lg font-bold mt-0.5">
                    {scheduleSummary.postedCount}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{scheduleSummary.totalRows}
                    </span>
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Progress value={scheduleSummary.progressPct} className="h-1.5 flex-1" />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {scheduleSummary.progressPct}&nbsp;%
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Total annuités</p>
                  <p className="text-base font-bold mt-0.5 tabular-nums">
                    {scheduleSummary.totalAnnuity.toLocaleString("fr-FR")}
                  </p>
                  <p className="text-xs text-muted-foreground">FCFA</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Intérêts totaux</p>
                  <p className="text-base font-bold mt-0.5 tabular-nums text-orange-600">
                    {scheduleSummary.totalInterest.toLocaleString("fr-FR")}
                  </p>
                  <p className="text-xs text-muted-foreground">FCFA</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Restant à payer</p>
                  <p className="text-base font-bold mt-0.5 tabular-nums text-primary">
                    {scheduleSummary.pendingAnnuity.toLocaleString("fr-FR")}
                  </p>
                  <p className="text-xs text-muted-foreground">FCFA</p>
                </div>
              </div>

              {/* ---- Schedule table ---- */}
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">N° Échéance</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Intérêts</TableHead>
                      <TableHead className="text-right font-semibold">Annuité</TableHead>
                      <TableHead className="text-right">Capital restant dû</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedule.rows.map((row) => (
                      <TableRow
                        key={row.installmentNumber}
                        className={cn(
                          row.posted
                            ? "bg-green-50/40 dark:bg-green-950/10"
                            : "bg-primary/5",
                        )}
                      >
                        <TableCell className="pl-4 font-semibold">{row.installmentNumber}</TableCell>
                        <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                          {formatDate(row.dueDate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono text-sm">
                          {row.principalAmount.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono text-sm text-orange-600 dark:text-orange-400">
                          {row.interestAmount.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold font-mono text-sm">
                          {row.annuity.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold font-mono text-sm text-primary">
                          {row.remainingCapital.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell>
                          {row.posted ? (
                            <Badge
                              variant="outline"
                              className="text-xs border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Comptabilisée
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs border-transparent bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 gap-1"
                            >
                              <Clock className="h-3 w-3" />
                              À venir
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
