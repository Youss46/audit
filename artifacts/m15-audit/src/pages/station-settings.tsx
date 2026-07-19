import { useState } from "react"
import { Link } from "wouter"
import {
  useListStations,
  getListStationsQueryKey,
  useCreateStation,
  useUpdateStation,
  useDeleteStation,
  type Station,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import {
  MapPin,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Building2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type StationFormState = { name: string; city: string }
const EMPTY_FORM: StationFormState = { name: "", city: "" }

// Multi-station (P8): PME owner screen to manage physical stations.
// Each station is an independent operational unit — pumps and staff are
// assigned to a station, and accounting reports can be filtered per site.
export default function StationSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const clientId = user?.clientId ?? 0

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingStation, setEditingStation] = useState<{ id: number } & StationFormState | null>(null)
  const [deletingStationId, setDeletingStationId] = useState<number | null>(null)
  const [form, setForm] = useState<StationFormState>(EMPTY_FORM)

  const { data: stations = [], isLoading, refetch } = useListStations(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListStationsQueryKey({ clientId }) } },
  )

  const createMutation = useCreateStation({
    mutation: {
      onSuccess: () => {
        setIsCreateOpen(false)
        setForm(EMPTY_FORM)
        toast({ title: "Station enregistrée avec succès" })
        refetch()
      },
      onError: (err: any) => {
        toast({
          title: "Erreur",
          description: err?.data?.error ?? "Impossible d'ajouter cette station.",
          variant: "destructive",
        })
      },
    },
  })

  const updateMutation = useUpdateStation({
    mutation: {
      onSuccess: () => {
        setEditingStation(null)
        toast({ title: "Station mise à jour" })
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

  const deleteMutation = useDeleteStation({
    mutation: {
      onSuccess: () => {
        setDeletingStationId(null)
        toast({ title: "Station supprimée" })
        refetch()
      },
      onError: (err: any) => {
        toast({
          title: "Suppression impossible",
          description:
            err?.data?.error ??
            "Des pompes sont encore attribuées à cette station. Réattribuez-les d'abord.",
          variant: "destructive",
        })
        setDeletingStationId(null)
      },
    },
  })

  function handleCreate() {
    if (!form.name || !form.city) return
    createMutation.mutate({ data: { clientId, name: form.name, city: form.city } })
  }

  function handleUpdate() {
    if (!editingStation || !editingStation.name || !editingStation.city) return
    updateMutation.mutate({
      id: editingStation.id,
      data: { name: editingStation.name, city: editingStation.city },
    })
  }

  function openEdit(s: Station) {
    setEditingStation({ id: s.id, name: s.name, city: s.city })
  }

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
            <Building2 className="h-6 w-6 text-amber-600" />
            Gestion des stations
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Enregistrez vos sites physiques. Chaque station regroupe ses propres pompes et agents terrain.
          </p>
        </div>
        <Button
          onClick={() => { setForm(EMPTY_FORM); setIsCreateOpen(true) }}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          data-testid="button-add-station"
        >
          <Plus className="h-4 w-4 mr-2" />
          Ajouter une station
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Stations enregistrées</CardTitle>
          <CardDescription>
            Chaque station correspond à un site physique. Les pompes et les agents terrain y sont rattachés individuellement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Chargement…</p>
          ) : stations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Aucune station enregistrée.</p>
              <p className="text-xs mt-1">Commencez par créer vos sites physiques, puis rattachez-y vos pompes et votre personnel.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom de la station</TableHead>
                  <TableHead>Ville</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stations.map((station) => (
                  <TableRow key={station.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-amber-600 shrink-0" />
                        {station.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {station.city}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(station)}
                          data-testid={`button-edit-station-${station.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeletingStationId(station.id)}
                          data-testid={`button-delete-station-${station.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Create dialog ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter une station</DialogTitle>
            <DialogDescription>
              Renseignez le nom commercial et la ville de ce site.
            </DialogDescription>
          </DialogHeader>
          <StationForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleCreate}
              disabled={!form.name || !form.city || createMutation.isPending}
              data-testid="button-confirm-add-station"
            >
              {createMutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editingStation} onOpenChange={(open) => !open && setEditingStation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la station</DialogTitle>
            <DialogDescription>Mettez à jour les informations de ce site.</DialogDescription>
          </DialogHeader>
          {editingStation && (
            <StationForm
              form={editingStation}
              onChange={(updated) =>
                setEditingStation((prev) => (prev ? { ...prev, ...updated } : null))
              }
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStation(null)}>
              Annuler
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleUpdate}
              disabled={!editingStation?.name || !editingStation?.city || updateMutation.isPending}
              data-testid="button-confirm-edit-station"
            >
              {updateMutation.isPending ? "Enregistrement…" : "Mettre à jour"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={deletingStationId !== null}
        onOpenChange={(open) => !open && setDeletingStationId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette station ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La suppression échouera si des pompes sont encore
              rattachées à ce site — réattribuez-les d'abord.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() =>
                deletingStationId !== null &&
                deleteMutation.mutate({ id: deletingStationId })
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

function StationForm({
  form,
  onChange,
}: {
  form: StationFormState
  onChange: (v: StationFormState) => void
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="station-name">Nom de la station</Label>
        <Input
          id="station-name"
          placeholder="Ex : Station Yamoussoukro Autogare"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          data-testid="input-station-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="station-city">Ville</Label>
        <Input
          id="station-city"
          placeholder="Ex : Yamoussoukro"
          value={form.city}
          onChange={(e) => onChange({ ...form, city: e.target.value })}
          data-testid="input-station-city"
        />
      </div>
    </div>
  )
}
