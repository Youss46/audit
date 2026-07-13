import { useState } from "react"
import { useRoute, Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListFinancialItems,
  getListFinancialItemsQueryKey,
  useCreateFinancialItem,
  useUpdateFinancialItem,
  useGetFinancialItemSchedule,
  getGetFinancialItemScheduleQueryKey,
  useGenerateFinanceJournalEntries,
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
import {
  Landmark,
  Plus,
  ChevronLeft,
  AlertTriangle,
  Loader2,
  RefreshCw,
  HandCoins,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

// Module M18 — Financements & Dettes (Immobilisations Financières & Emprunts).
// Accessible at /cabinet/client/:clientId/finance.

type PaymentFrequencyValue = "MENSUEL" | "TRIMESTRIEL" | "ANNUEL"

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

export default function Financements() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/finance")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [activeTab, setActiveTab] = useState<FinancialItemType>("EMPRUNT_BANCAIRE")
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState<AddFormState>(emptyForm("EMPRUNT_BANCAIRE"))
  const [addError, setAddError] = useState<string | null>(null)

  const [scheduleItemId, setScheduleItemId] = useState<number | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)

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
        enabled: !!scheduleItemId && showSchedule,
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

  const generateMutation = useGenerateFinanceJournalEntries({
    mutation: {
      onSuccess: (data) => {
        const { generated, skipped } = data as { generated: unknown[]; skipped: unknown[] }
        toast({
          title: "Échéances générées",
          description: `${generated.length} élément(s) traité(s) — écriture(s) créée(s) à valider en M3${skipped.length ? `, ${skipped.length} ignoré(s)` : ""}.`,
        })
        invalidateItems()
        queryClient.invalidateQueries({ queryKey: ["transactions"] })
      },
      onError: () => toast({ title: "Erreur lors de la génération", variant: "destructive" }),
    },
  })

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

  function handleAddSubmit() {
    setAddError(null)
    if (!clientId) return
    if (!addForm.accountNumber.trim()) { setAddError("Le numéro de compte est requis."); return }
    if (!addForm.label.trim()) { setAddError("La désignation est requise."); return }
    if (!addForm.startDate) { setAddError("La date de départ est requise."); return }
    const principal = parseInt(addForm.principalAmount, 10)
    if (!principal || principal <= 0) { setAddError("Le montant nominal doit être un entier positif."); return }
    const term = parseInt(addForm.termMonths, 10)
    if (!term || term < 1) { setAddError("La durée doit être d'au moins 1 mois."); return }
    const rate = parseFloat(addForm.annualInterestRate) || 0
    if (rate < 0) { setAddError("Le taux d'intérêt ne peut pas être négatif."); return }

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
  // Empty state — no client selected
  // -------------------------------------------------------------------------

  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <Landmark className="h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Financements &amp; Dettes</h2>
        <p className="text-muted-foreground max-w-sm">
          Sélectionnez un client depuis le Registre des Clients pour accéder à ses
          emprunts bancaires et immobilisations financières.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/clients">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Voir les clients
          </Link>
        </Button>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main view
  // -------------------------------------------------------------------------

  const activeItems = items?.filter((i) => i.status === "ACTIF") ?? []
  const totalPrincipal = (items ?? []).reduce((s, i) => s + i.principalAmount, 0)
  const totalRemaining = (items ?? []).reduce((s, i) => s + i.remainingCapital, 0)
  const totalInterest = (items ?? []).reduce((s, i) => s + i.totalInterest, 0)
  const isLoan = activeTab === "EMPRUNT_BANCAIRE"

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Landmark className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Financements &amp; Dettes</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Module M18 — Immobilisations Financières &amp; Emprunts
            </p>
          </div>
        </div>
        <Button
          onClick={() => { setAddForm(emptyForm(activeTab)); setAddError(null); setShowAddModal(true) }}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-2" />
          {isLoan ? "Ajouter un emprunt" : "Ajouter une immobilisation financière"}
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Tabs                                                                */}
      {/* ------------------------------------------------------------------ */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FinancialItemType)}>
        <TabsList>
          <TabsTrigger value="EMPRUNT_BANCAIRE">Emprunts Bancaires</TabsTrigger>
          <TabsTrigger value="IMMOBILISATION_FINANCIERE">Immobilisations Financières</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ------------------------------------------------------------------ */}
      {/* Generate journal entries                                            */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
              Traiter les échéances dues
            </Label>
            <p className="text-sm text-muted-foreground">
              Génère automatiquement une écriture «&nbsp;à valider&nbsp;» pour chaque échéance
              (capital + intérêts) arrivée à terme sur l'ensemble des éléments actifs de ce client.
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
                  Cette action créera une écriture comptable «&nbsp;à valider&nbsp;» pour chaque échéance
                  due à ce jour et non encore comptabilisée, pour tous les emprunts et immobilisations
                  financières actifs de ce client (tous types confondus). Les écritures apparaîtront
                  dans la file M3 pour validation.
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

      {/* ------------------------------------------------------------------ */}
      {/* Summary KPIs                                                        */}
      {/* ------------------------------------------------------------------ */}
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
              <p className="text-xs text-muted-foreground">FCFA</p>
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

      {/* ------------------------------------------------------------------ */}
      {/* Registry table                                                      */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isLoan ? "Tableau des emprunts bancaires" : "Tableau des immobilisations financières"}
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
                    <TableHead className="text-right font-semibold">Capital restant dû</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => openSchedule(item.id)}
                    >
                      <TableCell className="pl-6 font-mono text-sm">{item.accountNumber}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate" title={item.label}>
                        {item.label}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(item.startDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.principalAmount.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.annualInterestRate}&nbsp;% / {getPaymentFrequencyLabel(item.paymentFrequency)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.nextDueDate ? (
                          <>
                            {formatDate(item.nextDueDate)}
                            <span className="text-xs"> (n°{item.nextInstallmentNumber})</span>
                          </>
                        ) : (
                          <span className="italic">Soldé</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-primary">
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
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-destructive"
                                disabled={updateMutation.isPending}
                              >
                                Solder
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Solder «&nbsp;{item.label}&nbsp;»&nbsp;?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  L'élément sera marqué «&nbsp;Soldé&nbsp;». Il reste visible dans le registre
                                  mais n'apparaîtra plus dans la génération future des échéances.
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
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Add Item Dialog                                                     */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {addForm.type === "EMPRUNT_BANCAIRE" ? "Ajouter un emprunt bancaire" : "Ajouter une immobilisation financière"}
            </DialogTitle>
            <DialogDescription>
              Renseignez les paramètres du financement. Le tableau d'amortissement
              sera calculé automatiquement (méthode des annuités constantes).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {addError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {addError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="type">
                  Type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={addForm.type}
                  onValueChange={(v) =>
                    setAddForm((f) => ({ ...f, type: v as FinancialItemType }))
                  }
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
              <div className="space-y-1.5">
                <Label htmlFor="accountNumber">
                  Compte SYSCOHADA <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="accountNumber"
                  placeholder={addForm.type === "EMPRUNT_BANCAIRE" ? "161100" : "274000"}
                  value={addForm.accountNumber}
                  onChange={(e) => setAddForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  className="font-mono"
                />
              </div>
            </div>

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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">
                  Date de départ <span className="text-destructive">*</span>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="principalAmount">
                  Montant nominal (FCFA) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="principalAmount"
                  type="number"
                  min={1}
                  placeholder="5000000"
                  value={addForm.principalAmount}
                  onChange={(e) => setAddForm((f) => ({ ...f, principalAmount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="annualInterestRate">Taux d'intérêt annuel (%)</Label>
                <Input
                  id="annualInterestRate"
                  type="number"
                  min={0}
                  step="0.01"
                  value={addForm.annualInterestRate}
                  onChange={(e) => setAddForm((f) => ({ ...f, annualInterestRate: e.target.value }))}
                />
              </div>
            </div>

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
      <Sheet open={showSchedule} onOpenChange={setShowSchedule}>
        <SheetContent side="right" className="w-full sm:w-[720px] sm:max-w-none overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-primary" />
              Tableau d'amortissement financier
            </SheetTitle>
            {scheduleItem && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  <span className="font-mono text-foreground">{scheduleItem.accountNumber}</span>
                  {" — "}
                  <span className="font-medium text-foreground">{scheduleItem.label}</span>
                </p>
                <p>
                  {getFinancialItemTypeLabel(scheduleItem.type)}
                  {" · "}
                  Montant nominal&nbsp;:{" "}
                  <span className="text-foreground font-medium">
                    {scheduleItem.principalAmount.toLocaleString("fr-FR")} FCFA
                  </span>
                  {" · "}
                  {scheduleItem.annualInterestRate}&nbsp;%
                  {" · "}
                  {getPaymentFrequencyLabel(scheduleItem.paymentFrequency)}
                </p>
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
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N° Échéance</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Intérêts</TableHead>
                    <TableHead className="text-right">Annuité</TableHead>
                    <TableHead className="text-right font-semibold">Capital restant dû</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.rows.map((row) => (
                    <TableRow
                      key={row.installmentNumber}
                      className={cn(!row.posted && "bg-primary/5")}
                    >
                      <TableCell className="font-medium">{row.installmentNumber}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(row.dueDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.principalAmount.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-orange-600 dark:text-orange-400">
                        {row.interestAmount.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {row.annuity.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-primary">
                        {row.remainingCapital.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs border-transparent",
                            row.posted
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                          )}
                        >
                          {row.posted ? "Comptabilisée" : "À venir"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
