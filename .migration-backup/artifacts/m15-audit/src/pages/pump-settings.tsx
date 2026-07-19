import { useState } from "react"
import { Link } from "wouter"
import {
  useListPumps,
  getListPumpsQueryKey,
  useCreatePump,
  useUpdatePump,
  useDeletePump,
  useListStations,
  getListStationsQueryKey,
  FuelType,
  type Station,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import {
  Fuel,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  AlertTriangle,
  Gauge,
  Building2,
  MapPin,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

type PumpFormState = {
  label: string
  fuelType: FuelType | ""
  initialIndex: string
  stationId: number | null
}

const EMPTY_FORM: PumpFormState = { label: "", fuelType: "", initialIndex: "0", stationId: null }

// Module P7 (Calibration initiale): PME owner screen for registering physical
// pumps and their meter readings at onboarding time.
// Multi-station (P8): pumps are now grouped by station; each pump must be
// assigned to a station when stations are configured.
export default function PumpSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const clientId = user?.clientId ?? 0

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingPump, setEditingPump] = useState<{ id: number } & PumpFormState | null>(null)
  const [deletingPumpId, setDeletingPumpId] = useState<number | null>(null)
  const [form, setForm] = useState<PumpFormState>(EMPTY_FORM)

  const { data: pumps = [], isLoading, refetch } = useListPumps(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListPumpsQueryKey({ clientId }) } },
  )

  const { data: stations = [] } = useListStations(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListStationsQueryKey({ clientId }) } },
  )

  const createMutation = useCreatePump({
    mutation: {
      onSuccess: () => {
        setIsCreateOpen(false)
        setForm(EMPTY_FORM)
        toast({ title: "Pompe enregistrée avec succès" })
        refetch()
      },
      onError: (err: any) => {
        toast({
          title: "Erreur",
          description: err?.data?.error ?? "Impossible d'ajouter cette pompe.",
          variant: "destructive",
        })
      },
    },
  })

  const updateMutation = useUpdatePump({
    mutation: {
      onSuccess: () => {
        setEditingPump(null)
        toast({ title: "Pompe mise à jour" })
        refetch()
      },
      onError: (err: any) => {
        toast({
          title: "Erreur",
          description: err?.data?.error ?? "Impossible de mettre à jour.",
          variant: "destructive",
        })
      },
    },
  })

  const deleteMutation = useDeletePump({
    mutation: {
      onSuccess: () => {
        setDeletingPumpId(null)
        toast({ title: "Pompe supprimée" })
        refetch()
      },
      onError: (err: any) => {
        toast({
          title: "Erreur",
          description: err?.data?.error ?? "Impossible de supprimer.",
          variant: "destructive",
        })
      },
    },
  })

  function handleCreate() {
    if (!form.label || !form.fuelType) return
    const idx = parseFloat(form.initialIndex)
    createMutation.mutate({
      data: {
        clientId,
        label: form.label,
        fuelType: form.fuelType as FuelType,
        initialIndex: isNaN(idx) ? 0 : idx,
        ...(form.stationId ? { stationId: form.stationId } : {}),
      } as any,
    })
  }

  function handleUpdate() {
    if (!editingPump || !editingPump.label || !editingPump.fuelType) return
    const idx = parseFloat(editingPump.initialIndex)
    updateMutation.mutate({
      id: editingPump.id,
      data: {
        label: editingPump.label,
        fuelType: editingPump.fuelType as FuelType,
        initialIndex: isNaN(idx) ? 0 : idx,
      },
    })
  }

  function openEdit(pump: typeof pumps[number]) {
    setEditingPump({
      id: pump.id,
      label: pump.label,
      fuelType: pump.fuelType as FuelType,
      initialIndex: String(pump.initialIndex),
      stationId: (pump as any).stationId ?? null,
    })
  }

  const fuelLabel = (f: FuelType | string) =>
    f === "super" ? "Super" : f === "gasoil" ? "Gasoil" : f

  // Group pumps by station for display.
  const pumpsByStation = stations.map((station) => ({
    station,
    pumps: pumps.filter((p) => (p as any).stationId === station.id),
  }))
  const unassignedPumps = pumps.filter((p) => !(p as any).stationId)

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/portal">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Retour
        </Link>
      </Button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Fuel className="h-6 w-6 text-amber-600" />
            Gestion des pompes
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Enregistrez vos pompes physiques et saisissez leur index de départ pour initialiser le suivi des relevés.
          </p>
        </div>
        <Button
          onClick={() => { setForm(EMPTY_FORM); setIsCreateOpen(true) }}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          data-testid="button-add-pump"
        >
          <Plus className="h-4 w-4 mr-2" />
          Ajouter une pompe
        </Button>
      </div>

      {stations.length > 0 ? (
        // ── Multi-station view: grouped by station ──────────────────────
        <div className="space-y-4">
          {pumpsByStation.map(({ station, pumps: stationPumps }) => (
            <StationPumpCard
              key={station.id}
              station={station}
              pumps={stationPumps}
              isLoading={isLoading}
              fuelLabel={fuelLabel}
              onEdit={openEdit}
              onDelete={(id) => setDeletingPumpId(id)}
            />
          ))}
          {unassignedPumps.length > 0 && (
            <StationPumpCard
              station={null}
              pumps={unassignedPumps}
              isLoading={false}
              fuelLabel={fuelLabel}
              onEdit={openEdit}
              onDelete={(id) => setDeletingPumpId(id)}
            />
          )}
        </div>
      ) : (
        // ── Single-station / legacy view: flat table ────────────────────
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Pompes enregistrées</CardTitle>
            <CardDescription>
              Chaque pompe est identifiée par son libellé et son type de carburant. L'index d'étalonnage sert uniquement au premier relevé.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Chargement…</p>
            ) : pumps.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Aucune pompe enregistrée. Cliquez sur « Ajouter une pompe » pour commencer.
              </p>
            ) : (
              <PumpTable
                pumps={pumps}
                fuelLabel={fuelLabel}
                onEdit={openEdit}
                onDelete={(id) => setDeletingPumpId(id)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Create dialog ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter une pompe</DialogTitle>
            <DialogDescription>
              Renseignez le libellé, le type de carburant et l'index physique actuellement affiché sur le compteur.
            </DialogDescription>
          </DialogHeader>
          <PumpForm form={form} onChange={setForm} stations={stations} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleCreate}
              disabled={!form.label || !form.fuelType || createMutation.isPending}
              data-testid="button-confirm-add-pump"
            >
              {createMutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editingPump} onOpenChange={(open) => !open && setEditingPump(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la pompe</DialogTitle>
            <DialogDescription>Mettez à jour les informations de cette pompe.</DialogDescription>
          </DialogHeader>
          {editingPump && (
            <PumpForm
              form={editingPump}
              onChange={(updated) =>
                setEditingPump((prev) => (prev ? { ...prev, ...updated } : null))
              }
              stations={stations}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPump(null)}>
              Annuler
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleUpdate}
              disabled={
                !editingPump?.label || !editingPump?.fuelType || updateMutation.isPending
              }
              data-testid="button-confirm-edit-pump"
            >
              {updateMutation.isPending ? "Enregistrement…" : "Mettre à jour"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={deletingPumpId !== null}
        onOpenChange={(open) => !open && setDeletingPumpId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette pompe ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Les relevés de shift existants ne seront pas affectés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() =>
                deletingPumpId !== null && deleteMutation.mutate({ id: deletingPumpId })
              }
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Station-grouped pump card ───────────────────────────────────────────────
function StationPumpCard({
  station,
  pumps,
  isLoading,
  fuelLabel,
  onEdit,
  onDelete,
}: {
  station: Station | null
  pumps: any[]
  isLoading: boolean
  fuelLabel: (f: string) => string
  onEdit: (pump: any) => void
  onDelete: (id: number) => void
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-amber-600" />
          {station ? (
            <span>
              {station.name}
              <span className="ml-2 font-normal text-muted-foreground text-sm flex items-center gap-1 inline-flex">
                <MapPin className="h-3.5 w-3.5" />
                {station.city}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Pompes non attribuées</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Chargement…</p>
        ) : pumps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Aucune pompe enregistrée pour cette station.
          </p>
        ) : (
          <PumpTable pumps={pumps} fuelLabel={fuelLabel} onEdit={onEdit} onDelete={onDelete} />
        )}
      </CardContent>
    </Card>
  )
}

// ── Pump table (shared) ────────────────────────────────────────────────────
function PumpTable({
  pumps,
  fuelLabel,
  onEdit,
  onDelete,
}: {
  pumps: any[]
  fuelLabel: (f: string) => string
  onEdit: (pump: any) => void
  onDelete: (id: number) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Libellé</TableHead>
          <TableHead>Carburant</TableHead>
          <TableHead className="text-right">Index initial (L)</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {pumps.map((pump) => (
          <TableRow key={pump.id}>
            <TableCell className="font-medium">{pump.label}</TableCell>
            <TableCell>
              <Badge variant="outline">{fuelLabel(pump.fuelType)}</Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-sm">
              {pump.initialIndex.toLocaleString("fr-FR")} L
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1 justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(pump)}
                  data-testid={`button-edit-pump-${pump.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onDelete(pump.id)}
                  data-testid={`button-delete-pump-${pump.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── Shared form fields ─────────────────────────────────────────────────────
function PumpForm({
  form,
  onChange,
  stations,
}: {
  form: PumpFormState
  onChange: (v: PumpFormState) => void
  stations: Station[]
}) {
  return (
    <div className="space-y-4 py-2">
      {stations.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="pump-station">Station</Label>
          <Select
            value={form.stationId ? String(form.stationId) : "none"}
            onValueChange={(v) =>
              onChange({ ...form, stationId: v === "none" ? null : Number(v) })
            }
          >
            <SelectTrigger id="pump-station">
              <SelectValue placeholder="Attribuer à une station…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sans station</SelectItem>
              {stations.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name} — {s.city}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="pump-label">Libellé de la pompe</Label>
        <Input
          id="pump-label"
          placeholder="Ex : Pompe 1, Pompe SP95-A…"
          value={form.label}
          onChange={(e) => onChange({ ...form, label: e.target.value })}
          data-testid="input-pump-label"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pump-fuel-type">Type de carburant</Label>
        <Select
          value={form.fuelType}
          onValueChange={(v) => onChange({ ...form, fuelType: v as FuelType })}
        >
          <SelectTrigger id="pump-fuel-type" data-testid="select-pump-fuel-type">
            <SelectValue placeholder="Sélectionner…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="super">Super</SelectItem>
            <SelectItem value="gasoil">Gasoil</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pump-initial-index" className="flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          Index d'étalonnage initial (L)
        </Label>
        <Input
          id="pump-initial-index"
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="Ex : 48250.75"
          value={form.initialIndex}
          onChange={(e) => onChange({ ...form, initialIndex: e.target.value })}
          data-testid="input-pump-initial-index"
        />
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            <span className="font-semibold">Important :</span> Saisissez l'index physique
            actuellement affiché sur le compteur de la pompe. Cet index servira de point de départ
            absolu pour le tout premier shift enregistré sur l'application.
          </p>
        </div>
      </div>
    </div>
  )
}
