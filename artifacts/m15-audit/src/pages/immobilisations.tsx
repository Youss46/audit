import { useState, useMemo } from "react"
import { useRoute } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListAssets,
  getListAssetsQueryKey,
  useCreateAsset,
  useUpdateAsset,
  useGetAssetDepreciationSchedule,
  getGetAssetDepreciationScheduleQueryKey,
  useGenerateDepreciationClosings,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import {
  getFixedAssetStatusLabel,
  getFixedAssetStatusColor,
  getDepreciationTypeLabel,
} from "@/lib/status"
import { cn, formatDate } from "@/lib/utils"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import {
  Layers,
  Plus,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Wrench,
  Zap,
  TrendingDown,
  Check,
  ChevronsUpDown,
} from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
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
// Module M17 — Registre des Immobilisations & Amortissements.
// Accessible at /cabinet/client/:clientId/immobilisations.
// ---------------------------------------------------------------------------

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i)

// ---------------------------------------------------------------------------
// SYSCOHADA Class 2 account catalogue — pre-loaded suggestions in the form.
// Accounts are ordered by sub-class so the picker reads naturally.
// ---------------------------------------------------------------------------

interface SyscohadaAccount {
  number: string
  label: string
  /** false = not depreciable under SYSCOHADA (land, goodwill…); absent/true = depreciable */
  isAmortizable?: boolean
  usefulLife: number | null
  type: "LINEAIRE" | "DEGRESSIF" | null
}

const SYSCOHADA_CLASS2_ACCOUNTS: SyscohadaAccount[] = [
  // Classe 21 — Immobilisations incorporelles
  { number: "211000", label: "Frais de développement",           usefulLife: 5,  type: "LINEAIRE" },
  { number: "212000", label: "Brevets et licences",              usefulLife: 10, type: "LINEAIRE" },
  { number: "213000", label: "Logiciels informatiques",          usefulLife: 3,  type: "LINEAIRE" },
  // Fonds commercial : non amortissable SYSCOHADA → tests de dépréciation annuels
  { number: "215000", label: "Fonds commercial",                 isAmortizable: false, usefulLife: null, type: null },
  // Classe 22 — Terrains
  // Terrains nus : non amortissables (durée de vie illimitée)
  { number: "221000", label: "Terrains nus",                     isAmortizable: false, usefulLife: null, type: null },
  { number: "222000", label: "Terrains aménagés",                isAmortizable: false, usefulLife: null, type: null },
  // Classe 23 — Bâtiments, installations
  { number: "231000", label: "Bâtiments administratifs",         usefulLife: 20, type: "LINEAIRE" },
  { number: "232000", label: "Bâtiments industriels",            usefulLife: 20, type: "LINEAIRE" },
  { number: "234000", label: "Installations générales",          usefulLife: 10, type: "LINEAIRE" },
  // Classe 24 — Matériel
  { number: "241100", label: "Matériel de transport",            usefulLife: 5,  type: "DEGRESSIF" },
  { number: "241200", label: "Camion de livraison",              usefulLife: 5,  type: "DEGRESSIF" },
  { number: "242000", label: "Matériel industriel et outillage", usefulLife: 7,  type: "DEGRESSIF" },
  { number: "243000", label: "Matériel de bureau",               usefulLife: 5,  type: "LINEAIRE"  },
  { number: "244000", label: "Matériel informatique",            usefulLife: 3,  type: "DEGRESSIF" },
  { number: "245000", label: "Mobilier de bureau",               usefulLife: 10, type: "LINEAIRE"  },
  { number: "246000", label: "Agencements et aménagements",      usefulLife: 10, type: "LINEAIRE"  },
  // Classe 25 — Avances et acomptes sur immobilisations
  { number: "251000", label: "Avances sur commandes d'immos",    usefulLife: 5,  type: "LINEAIRE"  },
  // Classe 26 — Titres de participation (non dépréciables → durée 50 ans)
  { number: "261000", label: "Titres de participation",          usefulLife: 50, type: "LINEAIRE"  },
]

const ACCOUNT_LOOKUP = new Map(SYSCOHADA_CLASS2_ACCOUNTS.map((a) => [a.number, a]))

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface AddFormState {
  accountNumber: string
  label: string
  acquisitionDate: string
  acquisitionCost: string
  depreciationType: "LINEAIRE" | "DEGRESSIF"
  usefulLifeYears: string
  salvageValue: string
}

const EMPTY_FORM: AddFormState = {
  accountNumber: "",
  label: "",
  acquisitionDate: "",
  acquisitionCost: "",
  depreciationType: "LINEAIRE",
  usefulLifeYears: "5",
  salvageValue: "0",
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Immobilisations() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/immobilisations")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [closingYear, setClosingYear] = useState(CURRENT_YEAR)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState<AddFormState>(EMPTY_FORM)
  const [addError, setAddError] = useState<string | null>(null)
  // "catalogue" | "custom" — controls whether the SYSCOHADA picker or free-text input is shown
  const [accountPickerMode, setAccountPickerMode] = useState<"catalogue" | "custom">("catalogue")
  const [accountComboOpen, setAccountComboOpen] = useState(false)

  const [scheduleAssetId, setScheduleAssetId] = useState<number | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  // Configure dialog: lets the accountant complete the depreciation parameters
  // of auto-synced pending-setup assets (created from validated Class 2 transactions).
  const [configureTarget, setConfigureTarget] = useState<number | null>(null)
  const [configureForm, setConfigureForm] = useState({
    depreciationType: "LINEAIRE" as "LINEAIRE" | "DEGRESSIF",
    usefulLifeYears: "",
    salvageValue: "0",
  })
  const [configureError, setConfigureError] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const assetsParams = { clientId: clientId ?? 0, year: selectedYear }
  const { data: assets, isLoading: assetsLoading } = useListAssets(
    assetsParams,
    { query: { enabled: !!clientId, queryKey: getListAssetsQueryKey(assetsParams) } },
  )

  const { data: schedule, isLoading: scheduleLoading } = useGetAssetDepreciationSchedule(
    scheduleAssetId ?? 0,
    {
      query: {
        enabled: !!scheduleAssetId && showSchedule,
        queryKey: getGetAssetDepreciationScheduleQueryKey(scheduleAssetId ?? 0),
      },
    },
  )

  const scheduleAsset = scheduleAssetId ? assets?.find((a) => a.id === scheduleAssetId) : null

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() })

  const createMutation = useCreateAsset({
    mutation: {
      onSuccess: () => {
        toast({ title: "Immobilisation enregistrée", description: "Le tableau d'amortissement a été calculé automatiquement." })
        setShowAddModal(false)
        setAddForm(EMPTY_FORM)
        setAddError(null)
        setAccountPickerMode("catalogue")
        invalidateAssets()
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur s'est produite."
        setAddError(msg)
      },
    },
  })

  const updateMutation = useUpdateAsset({
    mutation: {
      onSuccess: () => {
        toast({ title: "Immobilisation mise à jour" })
        invalidateAssets()
      },
      onError: () => toast({ title: "Erreur lors de la mise à jour", variant: "destructive" }),
    },
  })

  const generateMutation = useGenerateDepreciationClosings({
    mutation: {
      onSuccess: (data) => {
        const { generated, skipped } = data as { generated: unknown[]; skipped: unknown[] }
        if (generated.length > 0) {
          toast({
            title: `Dotations générées — Exercice ${closingYear}`,
            description:
              "Les écritures de dotations aux amortissements ont été générées avec succès dans le journal OD." +
              (skipped.length ? ` ${skipped.length} immobilisation(s) ignorée(s).` : ""),
          })
        } else {
          toast({
            title: `Aucune dotation générée — Exercice ${closingYear}`,
            description: "Aucune immobilisation éligible pour cet exercice.",
          })
        }
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() })
        invalidateAssets()
      },
      onError: (err: unknown) => {
        const message =
          (err as { data?: { error?: string } } | undefined)?.data?.error ??
          "Erreur lors de la génération des dotations."
        toast({ title: "Erreur lors de la génération", description: message, variant: "destructive" })
      },
    },
  })

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const activeAssets  = assets?.filter((a) => a.status === "ACTIF") ?? []
  const pendingAssets = assets?.filter((a) => a.pendingSetup) ?? []
  const totalOriginalCost  = (assets ?? []).reduce((s, a) => s + a.acquisitionCost, 0)
  const totalVNC           = (assets ?? []).reduce((s, a) => s + a.netBookValue, 0)
  const totalCumulative    = (assets ?? []).reduce((s, a) => s + a.cumulativeDepreciation, 0)
  const depreciationRatio  = totalOriginalCost > 0 ? totalCumulative / totalOriginalCost : 0

  // Grouped by SYSCOHADA class for the KPI row
  const class2Groups = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of assets ?? []) {
      const cls = a.accountNumber.slice(0, 2)
      map.set(cls, (map.get(cls) ?? 0) + 1)
    }
    return map
  }, [assets])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function openSchedule(assetId: number) {
    setScheduleAssetId(assetId)
    setShowSchedule(true)
  }

  function handleRetire(assetId: number) {
    updateMutation.mutate({ id: assetId, data: { status: "RETIRE" } })
  }

  // When a SYSCOHADA account is selected from the catalogue, pre-fill the
  // form fields with the standard useful life and depreciation type.
  function handleAccountSelect(accountNumber: string) {
    if (accountNumber === "__custom__") {
      setAccountPickerMode("custom")
      setAddForm((f) => ({ ...f, accountNumber: "" }))
      return
    }
    const preset = ACCOUNT_LOOKUP.get(accountNumber)
    if (preset) {
      if (preset.isAmortizable === false) {
        // Non-amortizable: clear depreciation fields, they'll be hidden in the form
        setAddForm((f) => ({
          ...f,
          accountNumber: preset.number,
          label: f.label || preset.label,
          depreciationType: "LINEAIRE",
          usefulLifeYears: "",
        }))
      } else {
        setAddForm((f) => ({
          ...f,
          accountNumber: preset.number,
          label: f.label || preset.label,
          depreciationType: preset.type as "LINEAIRE" | "DEGRESSIF",
          usefulLifeYears: String(preset.usefulLife),
        }))
      }
    }
  }

  function handleAddSubmit() {
    setAddError(null)
    if (!clientId) return
    if (!addForm.accountNumber.trim()) { setAddError("Le numéro de compte est requis."); return }
    if (!addForm.label.trim()) { setAddError("La désignation est requise."); return }
    if (!addForm.acquisitionDate) { setAddError("La date d'acquisition est requise."); return }
    const cost = parseInt(addForm.acquisitionCost, 10)
    if (!cost || cost <= 0) { setAddError("La valeur d'origine doit être un entier positif."); return }
    const salvage = parseInt(addForm.salvageValue, 10) || 0
    if (salvage >= cost) { setAddError("La valeur résiduelle doit être inférieure à la valeur d'origine."); return }

    // Non-amortizable assets don't need useful-life validation
    const selectedPreset = ACCOUNT_LOOKUP.get(addForm.accountNumber.trim())
    const isNonAmortizable = selectedPreset?.isAmortizable === false

    let years = 0
    if (!isNonAmortizable) {
      years = parseInt(addForm.usefulLifeYears, 10)
      if (!years || years < 1) { setAddError("La durée de vie doit être d'au moins 1 an."); return }
    }

    createMutation.mutate({
      data: {
        clientId,
        accountNumber: addForm.accountNumber.trim(),
        label: addForm.label.trim(),
        acquisitionDate: new Date(addForm.acquisitionDate).toISOString(),
        acquisitionCost: cost,
        depreciationType: addForm.depreciationType,
        usefulLifeYears: isNonAmortizable ? 0 : years,
        salvageValue: salvage,
      },
    })
  }

  function handleGenerateClosings() {
    if (!clientId) return
    generateMutation.mutate({ clientId, year: closingYear })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">

      {/* ------------------------------------------------------------------ */}
      {/* Client selector + tab navigation (shared with accounting views)    */}
      {/* ------------------------------------------------------------------ */}
      <ClientAccountingNav activeTab="immobilisations" />

      {/* ------------------------------------------------------------------ */}
      {/* Empty state — no client selected                                   */}
      {/* ------------------------------------------------------------------ */}
      {!clientId ? (
        <Card className="shadow-sm">
          <CardContent className="p-16 flex flex-col items-center justify-center gap-4 text-center text-muted-foreground">
            <Layers className="h-10 w-10 opacity-20" />
            <div>
              <p className="font-medium">Sélectionnez un client</p>
              <p className="text-sm mt-1">
                Choisissez un client dans le menu ci-dessus pour accéder à son registre
                des immobilisations et au moteur d'amortissement.
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
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Registre des Immobilisations</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Module M17 — Gestion des immobilisations &amp; amortissements SYSCOHADA
                </p>
              </div>
            </div>
            <Button
              onClick={() => { setAddForm(EMPTY_FORM); setAddError(null); setAccountPickerMode("catalogue"); setShowAddModal(true) }}
              className="w-full sm:w-auto shrink-0"
            >
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une immobilisation
            </Button>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Controls row                                                     */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex flex-wrap gap-4">
            {/* Year selector for the registry table */}
            <Card className="flex-1 min-w-[220px]">
              <CardContent className="pt-4 pb-4">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">
                  Exercice d'analyse
                </Label>
                <Select
                  value={String(selectedYear)}
                  onValueChange={(v) => setSelectedYear(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEAR_OPTIONS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        Exercice {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Generate year-end closings */}
            <Card className="flex-1 min-w-[300px]">
              <CardContent className="pt-4 pb-4">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">
                  Générer les dotations aux amortissements
                </Label>
                <div className="flex gap-2">
                  <Select
                    value={String(closingYear)}
                    onValueChange={(v) => setClosingYear(Number(v))}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEAR_OPTIONS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          Exercice {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={generateMutation.isPending || activeAssets.length === 0}
                        className="flex-1"
                      >
                        {generateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Générer les dotations
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Générer les dotations — Exercice {closingYear}</AlertDialogTitle>
                        <AlertDialogDescription>
                          Cette action créera une écriture comptable «&nbsp;à valider&nbsp;» (Débit&nbsp;681x / Crédit&nbsp;284x)
                          pour chaque immobilisation active ayant une dotation non nulle en {closingYear}.
                          Les écritures apparaîtront dans la file M3 pour validation.
                          <br /><br />
                          <strong>Appelez cette action une seule fois par exercice</strong> pour éviter les doublons.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={handleGenerateClosings}>
                          Générer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Summary KPIs                                                     */}
          {/* ---------------------------------------------------------------- */}
          {assets && assets.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Immobilisations</p>
                  <p className="text-2xl font-bold mt-1">{assets.length}</p>
                  <p className="text-xs text-muted-foreground">{activeAssets.length} actives</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Valeur d'origine totale</p>
                  <p className="text-xl font-bold mt-1 tabular-nums">{totalOriginalCost.toLocaleString("fr-FR")}</p>
                  <p className="text-xs text-muted-foreground">FCFA</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Amort. cumulés (fin {selectedYear})</p>
                  <p className="text-xl font-bold mt-1 tabular-nums text-orange-600">{totalCumulative.toLocaleString("fr-FR")}</p>
                  <p className="text-xs text-muted-foreground">
                    {(depreciationRatio * 100).toFixed(0)}&nbsp;% amorti
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">VNC totale (fin {selectedYear})</p>
                  <p className="text-xl font-bold mt-1 tabular-nums text-primary">{totalVNC.toLocaleString("fr-FR")}</p>
                  <p className="text-xs text-muted-foreground">FCFA</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Pending-setup callout: assets auto-synced from Class 2 entries  */}
          {/* ---------------------------------------------------------------- */}
          {pendingAssets.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 px-4 py-3">
              <Zap className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-semibold text-amber-800 dark:text-amber-400">
                  {pendingAssets.length === 1
                    ? "1 immobilisation synchronisée automatiquement"
                    : `${pendingAssets.length} immobilisations synchronisées automatiquement`}
                </span>
                <span className="text-amber-700 dark:text-amber-500">
                  {" "}nécessite{pendingAssets.length > 1 ? "nt" : ""} la saisie des paramètres
                  d'amortissement avant la prochaine clôture d'exercice. Cliquez sur{" "}
                  <strong>Configurer</strong> sur chaque ligne concernée.
                </span>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Asset registry table                                             */}
          {/* ---------------------------------------------------------------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Tableau des immobilisations
                {!assetsLoading && assets && assets.length > 0 && (
                  <Badge variant="outline" className="font-normal text-xs">
                    {assets.length} actif{assets.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {assetsLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Chargement…
                </div>
              ) : !assets || assets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
                  <Layers className="h-8 w-8 opacity-30" />
                  <p className="text-sm">Aucune immobilisation enregistrée.</p>
                  <p className="text-xs">Cliquez sur «&nbsp;Ajouter une immobilisation&nbsp;» pour commencer.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Compte</TableHead>
                        <TableHead>Désignation</TableHead>
                        <TableHead>Date d'acquisition</TableHead>
                        <TableHead className="text-right">Valeur d'origine</TableHead>
                        <TableHead>Type / Durée</TableHead>
                        <TableHead className="text-right">Amort. cumulés</TableHead>
                        <TableHead className="text-right font-semibold">VNC fin {selectedYear}</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead className="pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assets.map((asset) => (
                        <TableRow
                          key={asset.id}
                          className={cn(
                            "hover:bg-muted/40 transition-colors",
                            asset.pendingSetup
                              ? "cursor-pointer bg-amber-50/50 dark:bg-amber-950/20 border-l-4 border-l-amber-400"
                              : "cursor-pointer",
                          )}
                          onClick={() => {
                            if (asset.pendingSetup) {
                              setConfigureTarget(asset.id)
                              setConfigureForm({ depreciationType: "LINEAIRE", usefulLifeYears: "", salvageValue: "0" })
                              setConfigureError(null)
                            } else {
                              openSchedule(asset.id)
                            }
                          }}
                        >
                          <TableCell className="pl-6">
                            <span className="font-mono text-sm">{asset.accountNumber}</span>
                            {ACCOUNT_LOOKUP.has(asset.accountNumber) && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                                {ACCOUNT_LOOKUP.get(asset.accountNumber)!.label}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="font-medium max-w-[200px] truncate" title={asset.label}>
                            {asset.label}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDate(asset.acquisitionDate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-mono text-sm">
                            {asset.acquisitionCost.toLocaleString("fr-FR")}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {asset.pendingSetup ? (
                              <Badge
                                variant="outline"
                                className="border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-xs gap-1"
                              >
                                <Wrench className="h-3 w-3" />
                                À configurer
                              </Badge>
                            ) : (
                              <>
                                {getDepreciationTypeLabel(asset.depreciationType as "LINEAIRE" | "DEGRESSIF")}
                                {" / "}
                                {asset.usefulLifeYears}&nbsp;ans
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-mono text-sm text-orange-600 dark:text-orange-400">
                            {asset.cumulativeDepreciation.toLocaleString("fr-FR")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold font-mono text-sm text-primary">
                            {asset.netBookValue.toLocaleString("fr-FR")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "border-transparent text-xs",
                                getFixedAssetStatusColor(asset.status),
                              )}
                            >
                              {getFixedAssetStatusLabel(asset.status)}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="pr-6 text-right space-x-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {asset.pendingSetup && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40 gap-1 text-xs h-7"
                                onClick={() => {
                                  setConfigureTarget(asset.id)
                                  setConfigureForm({ depreciationType: "LINEAIRE", usefulLifeYears: "", salvageValue: "0" })
                                  setConfigureError(null)
                                }}
                              >
                                <Wrench className="h-3 w-3" />
                                Configurer
                              </Button>
                            )}
                            {asset.status === "ACTIF" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    disabled={updateMutation.isPending}
                                  >
                                    Mettre au rebut
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Mettre au rebut «&nbsp;{asset.label}&nbsp;»&nbsp;?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      L'immobilisation sera marquée «&nbsp;Retiré&nbsp;». Elle reste visible dans le registre
                                      et son amortissement cumulé est conservé, mais elle n'entrera plus dans les dotations
                                      futures.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() => handleRetire(asset.id)}
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
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Add Asset Dialog                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Ajouter une immobilisation</DialogTitle>
            <DialogDescription>
              Sélectionnez un compte SYSCOHADA pour pré-remplir les paramètres standard,
              ou saisissez librement. Le tableau d'amortissement sera calculé automatiquement.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {addError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {addError}
              </div>
            )}

            {/* ---- SYSCOHADA account picker ---- */}
            <div className="space-y-2">
              <Label>
                Compte SYSCOHADA (Classe 2) <span className="text-destructive">*</span>
              </Label>

              {accountPickerMode === "catalogue" ? (
                <div className="space-y-2">
                  <Popover open={accountComboOpen} onOpenChange={setAccountComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={accountComboOpen}
                        data-testid="select-account-number"
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate font-mono text-sm">
                          {addForm.accountNumber
                            ? `${addForm.accountNumber} — ${SYSCOHADA_CLASS2_ACCOUNTS.find(a => a.number === addForm.accountNumber)?.label ?? "Compte personnalisé"}`
                            : "Sélectionner un compte SYSCOHADA…"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[420px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Rechercher par numéro ou libellé…" />
                        <CommandList className="max-h-72">
                          <CommandEmpty>Aucun compte trouvé.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="__custom__ Saisir compte personnalisé"
                              onSelect={() => {
                                handleAccountSelect("__custom__")
                                setAccountComboOpen(false)
                              }}
                            >
                              <span className="text-muted-foreground italic">✏️ Saisir un compte personnalisé…</span>
                            </CommandItem>
                            <Separator className="my-1" />
                            {SYSCOHADA_CLASS2_ACCOUNTS.map((acct) => (
                              <CommandItem
                                key={acct.number}
                                value={`${acct.number} ${acct.label}`}
                                onSelect={() => {
                                  handleAccountSelect(acct.number)
                                  setAccountComboOpen(false)
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4 shrink-0", addForm.accountNumber === acct.number ? "opacity-100" : "opacity-0")} />
                                <span className="font-mono text-xs text-muted-foreground mr-2">{acct.number}</span>
                                <span className="truncate">{acct.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground shrink-0">
                                  {acct.isAmortizable === false
                                    ? "(non amort.)"
                                    : `(${acct.usefulLife} ans)`}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {addForm.accountNumber && (
                    <p className="text-xs text-muted-foreground">
                      Compte sélectionné :{" "}
                      <span className="font-mono font-medium text-foreground">{addForm.accountNumber}</span>
                      {" — "}Les paramètres ont été pré-remplis. Ajustez si nécessaire.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="Ex : 241100"
                    value={addForm.accountNumber}
                    onChange={(e) => setAddForm((f) => ({ ...f, accountNumber: e.target.value }))}
                    className="font-mono"
                    data-testid="input-account-number-custom"
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
                placeholder="Ex : Camion de livraison Toyota Hilux"
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            {/* ---- Depreciation type + useful life (hidden for non-amortizable assets) ---- */}
            {(() => {
              const _preset = ACCOUNT_LOOKUP.get(addForm.accountNumber)
              const _nonAmort = _preset?.isAmortizable === false
              if (_nonAmort) {
                return (
                  <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p>
                      Ce type d'actif (Terrain nu, Fonds commercial) n'est pas amortissable selon
                      les normes SYSCOHADA. Il fera l'objet de <strong>tests de dépréciation
                      annuels</strong>.
                    </p>
                  </div>
                )
              }
              return (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="depreciationType">
                      Type d'amortissement <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={addForm.depreciationType}
                      onValueChange={(v) =>
                        setAddForm((f) => ({ ...f, depreciationType: v as "LINEAIRE" | "DEGRESSIF" }))
                      }
                    >
                      <SelectTrigger id="depreciationType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LINEAIRE">Linéaire</SelectItem>
                        <SelectItem value="DEGRESSIF">Dégressif (SYSCOHADA)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="usefulLifeYears">
                      Durée de vie (années) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="usefulLifeYears"
                      type="number"
                      min={1}
                      max={50}
                      value={addForm.usefulLifeYears}
                      onChange={(e) => setAddForm((f) => ({ ...f, usefulLifeYears: e.target.value }))}
                    />
                  </div>
                </div>
              )
            })()}

            {/* ---- Cost + acquisition date ---- */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="acquisitionCost">
                  Valeur d'origine HT (FCFA) <span className="text-destructive">*</span>
                </Label>
                <AmountInput
                  id="acquisitionCost"
                  min={1}
                  placeholder="5 000 000"
                  value={addForm.acquisitionCost}
                  onChange={(e) => setAddForm((f) => ({ ...f, acquisitionCost: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acquisitionDate">
                  Date d'acquisition <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="acquisitionDate"
                  type="date"
                  value={addForm.acquisitionDate}
                  onChange={(e) => setAddForm((f) => ({ ...f, acquisitionDate: e.target.value }))}
                />
              </div>
            </div>

            {/* ---- Salvage value ---- */}
            <div className="space-y-1.5">
              <Label htmlFor="salvageValue">Valeur résiduelle (FCFA)</Label>
              <AmountInput
                id="salvageValue"
                min={0}
                value={addForm.salvageValue}
                onChange={(e) => setAddForm((f) => ({ ...f, salvageValue: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Valeur estimée en fin de vie économique. L'amortissement s'arrête lorsque la VNC
                atteint ce seuil. Laissez à 0 si l'actif est entièrement amorti.
              </p>
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
      {/* Configure depreciation parameters dialog (for auto-synced stubs)   */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={configureTarget !== null} onOpenChange={(open) => !open && setConfigureTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-amber-600" />
              Paramètres d'amortissement
            </DialogTitle>
            <DialogDescription>
              Cette immobilisation a été synchronisée automatiquement depuis le flux de
              saisie. Complétez les paramètres pour activer le tableau d'amortissement.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {configureError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {configureError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cfg-depreciationType">
                Type d'amortissement <span className="text-destructive">*</span>
              </Label>
              <Select
                value={configureForm.depreciationType}
                onValueChange={(v) =>
                  setConfigureForm((f) => ({ ...f, depreciationType: v as "LINEAIRE" | "DEGRESSIF" }))
                }
              >
                <SelectTrigger id="cfg-depreciationType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LINEAIRE">Linéaire</SelectItem>
                  <SelectItem value="DEGRESSIF">Dégressif (SYSCOHADA)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-usefulLifeYears">
                  Durée de vie (années) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cfg-usefulLifeYears"
                  type="number"
                  min={1}
                  max={50}
                  placeholder="5"
                  value={configureForm.usefulLifeYears}
                  onChange={(e) =>
                    setConfigureForm((f) => ({ ...f, usefulLifeYears: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-salvageValue">Valeur résiduelle (FCFA)</Label>
                <AmountInput
                  id="cfg-salvageValue"
                  min={0}
                  value={configureForm.salvageValue}
                  onChange={(e) =>
                    setConfigureForm((f) => ({ ...f, salvageValue: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigureTarget(null)}>
              Annuler
            </Button>
            <Button
              disabled={updateMutation.isPending}
              onClick={() => {
                const years = parseInt(configureForm.usefulLifeYears, 10)
                if (!years || years < 1 || years > 50) {
                  setConfigureError("Veuillez saisir une durée d'utilisation valide (1–50 ans).")
                  return
                }
                setConfigureError(null)
                updateMutation.mutate(
                  {
                    id: configureTarget!,
                    data: {
                      depreciationType: configureForm.depreciationType,
                      usefulLifeYears: years,
                      salvageValue: parseInt(configureForm.salvageValue, 10) || 0,
                    } as Parameters<typeof updateMutation.mutate>[0]["data"],
                  },
                  {
                    onSuccess: () => setConfigureTarget(null),
                    onError: () => setConfigureError("Une erreur est survenue. Veuillez réessayer."),
                  },
                )
              }}
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enregistrer les paramètres
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Depreciation Schedule Drawer                                        */}
      {/* ------------------------------------------------------------------ */}
      <Sheet open={showSchedule} onOpenChange={setShowSchedule}>
        <SheetContent side="right" className="w-full sm:w-[720px] sm:max-w-none overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Tableau d'amortissement
            </SheetTitle>
            {scheduleAsset && (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-mono text-foreground">{scheduleAsset.accountNumber}</span>
                  {" — "}
                  <span className="font-medium text-foreground">{scheduleAsset.label}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    Valeur d'origine : {scheduleAsset.acquisitionCost.toLocaleString("fr-FR")} FCFA
                  </Badge>
                  <Badge variant="outline" className="text-xs font-normal">
                    {getDepreciationTypeLabel(scheduleAsset.depreciationType)}
                  </Badge>
                  <Badge variant="outline" className="text-xs font-normal">
                    {scheduleAsset.usefulLifeYears}&nbsp;ans
                  </Badge>
                  {scheduleAsset.salvageValue > 0 && (
                    <Badge variant="outline" className="text-xs font-normal">
                      Valeur résiduelle : {scheduleAsset.salvageValue.toLocaleString("fr-FR")} FCFA
                    </Badge>
                  )}
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
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Exercice</TableHead>
                    <TableHead className="text-right">Base amortissable</TableHead>
                    <TableHead className="text-right">Taux</TableHead>
                    <TableHead className="text-right">Annuité</TableHead>
                    <TableHead className="text-right">Amort. cumulés</TableHead>
                    <TableHead className="text-right font-semibold">VNC fin d'exercice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.rows.map((row) => {
                    const isCurrentYear = row.year === CURRENT_YEAR
                    const isFullyDepreciated = row.closingVNC <= 0
                    return (
                      <TableRow
                        key={row.year}
                        className={cn(
                          isCurrentYear && "bg-primary/5 font-medium",
                          isFullyDepreciated && "opacity-60",
                        )}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {row.year}
                            {row.isProrata && (
                              <Badge variant="outline" className="text-xs font-normal border-amber-300 text-amber-700 dark:text-amber-400">
                                Prorata
                              </Badge>
                            )}
                            {isCurrentYear && (
                              <Badge variant="outline" className="text-xs font-normal border-primary/50 text-primary">
                                N en cours
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono text-sm text-muted-foreground">
                          {row.depreciableBase.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono text-sm text-muted-foreground">
                          {(row.rate * 100).toFixed(2)}&nbsp;%
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono text-sm">
                          {row.annuity.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono text-sm text-orange-600 dark:text-orange-400">
                          {row.cumulativeDepreciation.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold font-mono text-sm text-primary">
                          {row.closingVNC.toLocaleString("fr-FR")}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
