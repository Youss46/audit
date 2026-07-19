import { useMemo, useState } from "react"
import { Link } from "wouter"
import {
  useListPumpAssignments,
  getListPumpAssignmentsQueryKey,
  useCreatePumpAssignment,
  useDeletePumpAssignment,
  useListPumps,
  getListPumpsQueryKey,
  useListStaff,
  type PumpAssignmentItem,
  type Pump,
  type StaffUser,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, CalendarDays, Fuel, Plus, Trash2, UserCog } from "lucide-react"
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

function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const fuelLabel = (f: string) => (f === "super" ? "Super" : f === "gasoil" ? "Gasoil" : f)

// Module P7 (Restriction d'attribution des pompes): the PME owner assigns
// each pompiste (client_staff / rôle POMPISTE) to one or more physical
// pumps for a given service day, before the shift starts. The "Relevé
// d'index de pompe" screen then restricts that pompiste's pump selection
// to exactly what is assigned here (single pump → pré-sélectionné et
// verrouillé, plusieurs pompes → menu filtré), and the server enforces the
// same restriction when the reading is saved.
export default function PumpAssignments() {
  const { user } = useAuth()
  const { toast } = useToast()
  const clientId = user?.clientId ?? 0

  const [date, setDate] = useState(todayISO())
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [pumpId, setPumpId] = useState<string>("")
  const [staffUserId, setStaffUserId] = useState<string>("")
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: pumps = [] } = useListPumps(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListPumpsQueryKey({ clientId }) } },
  )

  const { data: staff = [] } = useListStaff()
  // Only "POMPISTE"-role staff can be assigned to a pump.
  const pompistes = useMemo(
    () => staff.filter((s: StaffUser) => s.roleCode === "POMPISTE" && s.status === "active"),
    [staff],
  )

  const {
    data: assignments = [],
    isLoading,
    refetch,
  } = useListPumpAssignments(
    { clientId, date },
    { query: { enabled: !!clientId, queryKey: getListPumpAssignmentsQueryKey({ clientId, date }) } },
  )

  const createMutation = useCreatePumpAssignment({
    mutation: {
      onSuccess: () => {
        setIsCreateOpen(false)
        setPumpId("")
        setStaffUserId("")
        toast({ title: "Pompe attribuée avec succès" })
        refetch()
      },
      onError: (err: any) => {
        toast({
          title: "Erreur",
          description: err?.data?.error ?? "Impossible d'attribuer cette pompe.",
          variant: "destructive",
        })
      },
    },
  })

  const deleteMutation = useDeletePumpAssignment({
    mutation: {
      onSuccess: () => {
        setDeletingId(null)
        toast({ title: "Attribution supprimée" })
        refetch()
      },
    },
  })

  function handleCreate() {
    if (!pumpId || !staffUserId) return
    createMutation.mutate({
      data: {
        clientId,
        pumpId: Number(pumpId),
        staffUserId: Number(staffUserId),
        shiftDate: date,
      },
    })
  }

  const assignedPumpIds = new Set(assignments.map((a: PumpAssignmentItem) => a.pumpId))
  const availablePumps = pumps.filter((p: Pump) => !assignedPumpIds.has(p.id))

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
            <UserCog className="h-6 w-6 text-amber-600" />
            Attribution des pompes
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Désignez, pour chaque journée de service, la ou les pompes confiées à chaque pompiste.
            Un pompiste ne peut saisir de relevé que pour une pompe qui lui est attribuée ici.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={pompistes.length === 0 || pumps.length === 0}
          data-testid="button-add-assignment"
        >
          <Plus className="h-4 w-4 mr-2" />
          Attribuer une pompe
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Attributions du jour</CardTitle>
              <CardDescription>
                Liste des pompes attribuées pour la date sélectionnée.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-40"
                data-testid="input-assignment-date"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pumps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aucune pompe enregistrée. Ajoutez d'abord vos pompes depuis « Gestion des pompes ».
            </p>
          ) : pompistes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aucun pompiste actif. Ajoutez un collaborateur avec le rôle « Pompiste » depuis « Équipe ».
            </p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Chargement…</p>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aucune pompe attribuée pour cette date. Cliquez sur « Attribuer une pompe » pour commencer.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pompe</TableHead>
                  <TableHead>Carburant</TableHead>
                  <TableHead>Pompiste</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a: PumpAssignmentItem) => (
                  <TableRow key={a.id} data-testid={`row-assignment-${a.id}`}>
                    <TableCell className="font-medium flex items-center gap-1.5">
                      <Fuel className="h-3.5 w-3.5 text-amber-600" />
                      {a.pumpLabel}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{fuelLabel(a.fuelType)}</Badge>
                    </TableCell>
                    <TableCell>{a.staffName}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeletingId(a.id)}
                        data-testid={`button-delete-assignment-${a.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
            <DialogTitle>Attribuer une pompe</DialogTitle>
            <DialogDescription>
              Le pompiste sélectionné ne pourra saisir de relevé d'index que pour cette pompe, à
              la date du {new Date(date).toLocaleDateString("fr-FR")}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="assignment-pump">Pompe</Label>
              <Select value={pumpId} onValueChange={setPumpId}>
                <SelectTrigger id="assignment-pump" data-testid="select-assignment-pump">
                  <SelectValue placeholder="Sélectionner une pompe…" />
                </SelectTrigger>
                <SelectContent>
                  {availablePumps.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Toutes les pompes sont déjà attribuées pour cette date.
                    </div>
                  ) : (
                    availablePumps.map((p: Pump) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.label} — {fuelLabel(p.fuelType)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment-staff">Pompiste</Label>
              <Select value={staffUserId} onValueChange={setStaffUserId}>
                <SelectTrigger id="assignment-staff" data-testid="select-assignment-staff">
                  <SelectValue placeholder="Sélectionner un pompiste…" />
                </SelectTrigger>
                <SelectContent>
                  {pompistes.map((s: StaffUser) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleCreate}
              disabled={!pumpId || !staffUserId || createMutation.isPending}
              data-testid="button-confirm-assignment"
            >
              {createMutation.isPending ? "Enregistrement…" : "Attribuer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette attribution ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le pompiste concerné ne pourra plus saisir de relevé pour cette pompe à cette date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deletingId !== null && deleteMutation.mutate({ id: deletingId })}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
