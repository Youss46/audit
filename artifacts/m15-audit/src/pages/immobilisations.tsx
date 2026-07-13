import { useState } from "react"
import { useRoute, Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListAssets,
  getListAssetsQueryKey,
  useCreateAsset,
  useUpdateAsset,
  useGetAssetDepreciationSchedule,
  getGetAssetDepreciationScheduleQueryKey,
  useGenerateDepreciationClosings,
} from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import {
  getFixedAssetStatusLabel,
  getFixedAssetStatusColor,
  getDepreciationTypeLabel,
} from "@/lib/status"
import { cn, formatDate } from "@/lib/utils"
import {
  Layers,
  Plus,
  ChevronLeft,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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

// Module M17 — Registre des Immobilisations & Amortissements.
// Accessible at /cabinet/client/:clientId/immobilisations.

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i)

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

  const [scheduleAssetId, setScheduleAssetId] = useState<number | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() })

  const createMutation = useCreateAsset({
    mutation: {
      onSuccess: () => {
        toast({ title: "Immobilisation enregistrée", description: "Le tableau d'amortissement a été calculé automatiquement." })
        setShowAddModal(false)
        setAddForm(EMPTY_FORM)
        setAddError(null)
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
        toast({
          title: `Dotations générées — Exercice ${closingYear}`,
          description: `${generated.length} écriture(s) créée(s) à valider en M3${skipped.length ? `, ${skipped.length} ignorée(s)` : ""}.`,
        })
        queryClient.invalidateQueries({ queryKey: ["transactions"] })
      },
      onError: () => toast({ title: "Erreur lors de la génération", variant: "destructive" }),
    },
  })

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function openSchedule(assetId: number) {
    setScheduleAssetId(assetId)
    setShowSchedule(true)
  }

  function handleRetire(assetId: number) {
    updateMutation.mutate({ id: assetId, data: { status: "RETIRE" } })
  }

  function handleAddSubmit() {
    setAddError(null)
    if (!clientId) return
    if (!addForm.accountNumber.trim()) { setAddError("Le numéro de compte est requis."); return }
    if (!addForm.label.trim()) { setAddError("La désignation est requise."); return }
    if (!addForm.acquisitionDate) { setAddError("La date d'acquisition est requise."); return }
    const cost = parseInt(addForm.acquisitionCost, 10)
    if (!cost || cost <= 0) { setAddError("La valeur d'origine doit être un entier positif."); return }
    const years = parseInt(addForm.usefulLifeYears, 10)
    if (!years || years < 1) { setAddError("La durée de vie doit être d'au moins 1 an."); return }
    const salvage = parseInt(addForm.salvageValue, 10) || 0
    if (salvage >= cost) { setAddError("La valeur résiduelle doit être inférieure à la valeur d'origine."); return }

    createMutation.mutate({
      data: {
        clientId,
        accountNumber: addForm.accountNumber.trim(),
        label: addForm.label.trim(),
        acquisitionDate: new Date(addForm.acquisitionDate).toISOString(),
        acquisitionCost: cost,
        depreciationType: addForm.depreciationType,
        usefulLifeYears: years,
        salvageValue: salvage,
      },
    })
  }

  function handleGenerateClosings() {
    if (!clientId) return
    generateMutation.mutate({ clientId, year: closingYear })
  }

  // -------------------------------------------------------------------------
  // Empty state — no client selected
  // -------------------------------------------------------------------------

  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <Layers className="h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Registre des Immobilisations</h2>
        <p className="text-muted-foreground max-w-sm">
          Sélectionnez un client depuis le Registre des Clients pour accéder à ses
          immobilisations et au moteur d'amortissement.
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

  const activeAssets = assets?.filter((a) => a.status === "ACTIF") ?? []
  const totalOriginalCost = (assets ?? []).reduce((s, a) => s + a.acquisitionCost, 0)
  const totalVNC = (assets ?? []).reduce((s, a) => s + a.netBookValue, 0)
  const totalCumulative = (assets ?? []).reduce((s, a) => s + a.cumulativeDepreciation, 0)

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Registre des Immobilisations</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Module M17 — Gestion des immobilisations & amortissements SYSCOHADA
            </p>
          </div>
        </div>
        <Button
          onClick={() => { setAddForm(EMPTY_FORM); setAddError(null); setShowAddModal(true) }}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-2" />
          Ajouter une immobilisation
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Controls row                                                        */}
      {/* ------------------------------------------------------------------ */}
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

      {/* ------------------------------------------------------------------ */}
      {/* Summary KPIs                                                        */}
      {/* ------------------------------------------------------------------ */}
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
              <p className="text-xs text-muted-foreground">FCFA</p>
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

      {/* ------------------------------------------------------------------ */}
      {/* Asset registry table                                                */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tableau des immobilisations</CardTitle>
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
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => openSchedule(asset.id)}
                    >
                      <TableCell className="pl-6 font-mono text-sm">{asset.accountNumber}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate" title={asset.label}>
                        {asset.label}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(asset.acquisitionDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {asset.acquisitionCost.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getDepreciationTypeLabel(asset.depreciationType)} / {asset.usefulLifeYears}&nbsp;ans
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-orange-600 dark:text-orange-400">
                        {asset.cumulativeDepreciation.toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-primary">
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
                        className="pr-6 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
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

      {/* ------------------------------------------------------------------ */}
      {/* Add Asset Dialog                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter une immobilisation</DialogTitle>
            <DialogDescription>
              Renseignez les paramètres de l'immobilisation. Le tableau d'amortissement
              sera calculé automatiquement.
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
                <Label htmlFor="accountNumber">
                  Compte SYSCOHADA (Classe 2) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="accountNumber"
                  placeholder="241100"
                  value={addForm.accountNumber}
                  onChange={(e) => setAddForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  className="font-mono"
                />
              </div>
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="label">
                Désignation <span className="text-destructive">*</span>
              </Label>
              <Input
                id="label"
                placeholder="Camion de livraison Toyota Hilux"
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="acquisitionCost">
                  Valeur d'origine HT (FCFA) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="acquisitionCost"
                  type="number"
                  min={1}
                  placeholder="5000000"
                  value={addForm.acquisitionCost}
                  onChange={(e) => setAddForm((f) => ({ ...f, acquisitionCost: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salvageValue">Valeur résiduelle (FCFA)</Label>
                <Input
                  id="salvageValue"
                  type="number"
                  min={0}
                  value={addForm.salvageValue}
                  onChange={(e) => setAddForm((f) => ({ ...f, salvageValue: e.target.value }))}
                />
              </div>
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
      {/* Depreciation Schedule Drawer                                        */}
      {/* ------------------------------------------------------------------ */}
      <Sheet open={showSchedule} onOpenChange={setShowSchedule}>
        <SheetContent side="right" className="w-full sm:w-[680px] sm:max-w-none overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Tableau d'amortissement
            </SheetTitle>
            {scheduleAsset && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  <span className="font-mono text-foreground">{scheduleAsset.accountNumber}</span>
                  {" — "}
                  <span className="font-medium text-foreground">{scheduleAsset.label}</span>
                </p>
                <p>
                  Valeur d'origine&nbsp;:{" "}
                  <span className="text-foreground font-medium">
                    {scheduleAsset.acquisitionCost.toLocaleString("fr-FR")} FCFA
                  </span>
                  {" · "}
                  {getDepreciationTypeLabel(scheduleAsset.depreciationType)}
                  {" · "}
                  {scheduleAsset.usefulLifeYears}&nbsp;ans
                  {scheduleAsset.salvageValue > 0 && (
                    <> · Valeur résiduelle&nbsp;: {scheduleAsset.salvageValue.toLocaleString("fr-FR")} FCFA</>
                  )}
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
                    return (
                      <TableRow
                        key={row.year}
                        className={cn(
                          isCurrentYear && "bg-primary/5 font-medium",
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
                              <Badge variant="outline" className="text-xs font-normal border-primary text-primary">
                                N en cours
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.depreciableBase.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {(row.rate * 100).toFixed(2)}&nbsp;%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.annuity.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-orange-600 dark:text-orange-400">
                          {row.cumulativeDepreciation.toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-primary">
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
