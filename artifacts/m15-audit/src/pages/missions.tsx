import { useState } from "react"
import { Link } from "wouter"
import {
  useListMissions,
  useListUsers,
  useListClients,
  useUpdateMission,
  useCreateMission,
  getListMissionsQueryKey,
  MissionStatus,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import { getStatusColor, getStatusLabel } from "@/lib/status"
import { formatCurrencyFCFA } from "@/lib/utils"
import { Stamp, Search, ArrowRight, Plus } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  DialogTrigger,
} from "@/components/ui/dialog"

const UNASSIGNED = "unassigned"

export default function Missions() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<MissionStatus | "ALL">("ALL")
  const [isNewMissionOpen, setIsNewMissionOpen] = useState(false)
  const [newMissionClientId, setNewMissionClientId] = useState<string>("")
  const [newMissionFiscalYear, setNewMissionFiscalYear] = useState<number>(new Date().getFullYear())

  const { data: missions, isLoading } = useListMissions()
  const { data: staff } = useListUsers()
  const { data: clients } = useListClients()

  const canAssign = user?.role === "expert_comptable" || user?.role === "collaborateur"
  const canCreate = canAssign

  const assignMutation = useUpdateMission({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMissionsQueryKey() })
      },
    },
  })

  const createMissionMutation = useCreateMission({
    mutation: {
      onSuccess: () => {
        toast({ title: "Mission créée avec succès" })
        setIsNewMissionOpen(false)
        setNewMissionClientId("")
        queryClient.invalidateQueries({ queryKey: getListMissionsQueryKey() })
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de créer la mission",
          variant: "destructive",
        })
      },
    },
  })

  const handleCreateMission = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMissionClientId) return
    createMissionMutation.mutate({
      data: {
        clientId: parseInt(newMissionClientId),
        fiscalYear: newMissionFiscalYear,
      },
    })
  }

  // Cabinet staff eligible to be put in charge of a dossier review --
  // Espace PME (client_pme) accounts are never assignees.
  const assignableStaff = (staff ?? []).filter((s) => s.role !== "client_pme")

  const filteredMissions = (missions ?? [])
    .filter((m) => statusFilter === "ALL" || m.status === statusFilter)
    .filter((m) => (m.clientName ?? "").toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Missions de Visa</h1>
          <p className="text-muted-foreground mt-1">
            Toutes les missions de visa SYSCOHADA du cabinet, tous clients confondus.
          </p>
        </div>

        {canCreate && (
          <Dialog open={isNewMissionOpen} onOpenChange={setIsNewMissionOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-mission">
                <Plus className="mr-2 h-4 w-4" />
                Nouvelle Mission
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Créer une mission de visa</DialogTitle>
                <DialogDescription>
                  Sélectionnez le client et l'exercice fiscal. La checklist SYSCOHADA sera générée
                  automatiquement selon la taille (CA) et le secteur d'activité du client.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateMission} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="client">Client</Label>
                  <Select value={newMissionClientId} onValueChange={setNewMissionClientId}>
                    <SelectTrigger id="client" data-testid="select-new-mission-client">
                      <SelectValue placeholder="Sélectionner un client..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(clients ?? []).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="year">Exercice fiscal</Label>
                  <Input
                    id="year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={newMissionFiscalYear}
                    onChange={(e) => setNewMissionFiscalYear(parseInt(e.target.value))}
                    required
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsNewMissionOpen(false)}
                    disabled={createMissionMutation.isPending}
                  >
                    Annuler
                  </Button>
                  <Button type="submit" disabled={createMissionMutation.isPending || !newMissionClientId}>
                    {createMissionMutation.isPending ? "Création..." : "Générer la mission"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Rechercher un client..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
          <Badge
            variant={statusFilter === "ALL" ? "default" : "outline"}
            className="cursor-pointer whitespace-nowrap"
            onClick={() => setStatusFilter("ALL")}
          >
            Toutes
          </Badge>
          {(Object.keys(MissionStatus) as Array<keyof typeof MissionStatus>).map((status) => (
            <Badge
              key={status}
              variant={statusFilter === MissionStatus[status] ? "default" : "outline"}
              className="cursor-pointer whitespace-nowrap"
              onClick={() => setStatusFilter(MissionStatus[status])}
            >
              {getStatusLabel(MissionStatus[status])}
            </Badge>
          ))}
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Exercice</TableHead>
                  <TableHead>Système</TableHead>
                  <TableHead>Chiffre d'Affaires</TableHead>
                  <TableHead>Chargé du dossier</TableHead>
                  <TableHead>Statut de la Mission</TableHead>
                  <TableHead className="w-40">Progression</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                      Chargement des missions...
                    </TableCell>
                  </TableRow>
                ) : filteredMissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Stamp className="h-8 w-8 mb-2 opacity-20" />
                        <p>Aucune mission trouvée.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMissions.map((mission) => {
                    const progress = mission.checklistTotal > 0
                      ? Math.round((mission.checklistCompleted / mission.checklistTotal) * 100)
                      : 0
                    return (
                      <TableRow key={mission.id} data-testid={`row-mission-${mission.id}`}>
                        <TableCell>
                          <div className="font-medium text-foreground">{mission.clientName ?? "—"}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {mission.clientLegalForm ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{mission.fiscalYear}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {mission.accountingSystem}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatCurrencyFCFA(mission.clientAnnualTurnover)}</TableCell>
                        <TableCell>
                          {canAssign ? (
                            <Select
                              value={mission.assignedToId ? String(mission.assignedToId) : UNASSIGNED}
                              onValueChange={(value) =>
                                assignMutation.mutate({
                                  id: mission.id,
                                  data: { assignedToId: value === UNASSIGNED ? null : parseInt(value) },
                                })
                              }
                            >
                              <SelectTrigger className="h-8 w-44" data-testid={`select-assign-${mission.id}`}>
                                <SelectValue placeholder="Non assigné" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNASSIGNED}>Non assigné</SelectItem>
                                {assignableStaff.map((s) => (
                                  <SelectItem key={s.id} value={String(s.id)}>
                                    {s.fullName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-sm">
                              {mission.assignedToName ?? (
                                <span className="text-muted-foreground italic">Non assigné</span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`border-transparent ${getStatusColor(mission.status)}`}>
                            {getStatusLabel(mission.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={progress} className="h-2" />
                            <span className="text-xs text-muted-foreground w-9 shrink-0">{progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/clients/${mission.clientId}/missions/${mission.id}`}>
                              Ouvrir le Dossier
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
