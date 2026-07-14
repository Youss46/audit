import { useGetDashboardSummary, useListMissions } from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { Link } from "wouter"
import { 
  Building2, 
  Files, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Stamp,
  Activity,
  Users,
  ArrowRight
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getStatusColor, getStatusLabel } from "@/lib/status"
import { formatCurrencyFCFA } from "@/lib/utils"

export default function Dashboard() {
  const { user } = useAuth()
  const { data: summary, isLoading } = useGetDashboardSummary()
  const { data: missions, isLoading: isLoadingMissions } = useListMissions()

  // The control center only tracks dossiers still under review -- a mission
  // that already reached "visa_emis" moves out of the active tracker.
  const activeMissions = (missions ?? [])
    .filter((m) => m.status !== "visa_emis")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  if (isLoading || !summary) {
    return (
      <div className="space-y-6 animate-pulse">
        <div>
          <div className="h-8 w-48 bg-muted rounded mb-2"></div>
          <div className="h-4 w-64 bg-muted rounded"></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="h-4 w-24 bg-muted rounded"></div>
                <div className="h-4 w-4 bg-muted rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const statCards = [
    {
      title: "Total Clients",
      value: summary.totalClients,
      icon: <Building2 className="h-5 w-5 text-muted-foreground" />,
      color: "border-l-4 border-l-blue-500",
    },
    {
      title: "Missions en cours",
      value: summary.missionsEnCours,
      icon: <Activity className="h-5 w-5 text-blue-500" />,
      color: "border-l-4 border-l-indigo-500",
    },
    {
      title: "Visas Émis",
      value: summary.visaEmis,
      icon: <Stamp className="h-5 w-5 text-green-500" />,
      color: "border-l-4 border-l-green-500",
    },
    {
      title: "Alertes Anomalies",
      value: summary.anomalyAlerts,
      icon: <AlertTriangle className="h-5 w-5 text-destructive" />,
      color: "border-l-4 border-l-destructive",
    }
  ]

  const workflowStats = [
    {
      label: "En attente",
      count: summary.enAttente,
      icon: <Clock className="h-4 w-4 text-orange-500" />
    },
    {
      label: "En cours",
      count: summary.enCours,
      icon: <Activity className="h-4 w-4 text-blue-500" />
    },
    {
      label: "Anomalie",
      count: summary.anomalie,
      icon: <AlertTriangle className="h-4 w-4 text-destructive" />
    },
    {
      label: "Validé",
      count: summary.valide,
      icon: <CheckCircle2 className="h-4 w-4 text-teal-500" />
    },
    {
      label: "Visa Émis",
      count: summary.visaEmis,
      icon: <Stamp className="h-4 w-4 text-green-500" />
    }
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-muted-foreground mt-2">
          Bienvenue, <span className="font-medium text-foreground">{user?.fullName}</span>. Voici la situation du cabinet.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat, index) => (
          <Card key={index} className={`shadow-sm ${stat.color}`} data-testid={`card-stat-${index}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              {stat.icon}
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-sm" data-testid="card-workflow">
          <CardHeader>
            <CardTitle>Pipeline des Missions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {workflowStats.map((item, idx) => {
                const percentage = summary.totalMissions > 0 
                  ? Math.round((item.count / summary.totalMissions) * 100) 
                  : 0;
                  
                return (
                  <div key={idx} className="flex items-center">
                    <div className="flex w-36 items-center gap-2">
                      {item.icon}
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <div className="flex-1 ml-4">
                      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-500" 
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                    <div className="ml-4 w-12 text-right">
                      <span className="text-sm font-bold">{item.count}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
        
        <Card className="col-span-3 shadow-sm bg-primary text-primary-foreground" data-testid="card-quick-actions">
          <CardHeader>
            <CardTitle className="text-primary-foreground">Actions Rapides</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-primary-foreground/80 text-sm">
              Accédez rapidement aux fonctions principales de la plateforme.
            </p>
            <div className="grid grid-cols-1 gap-2 mt-4">
              <Link href="/clients" className="flex items-center gap-3 p-3 rounded-md bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors">
                <Building2 className="h-5 w-5" />
                <span className="font-medium">Consulter les dossiers clients</span>
              </Link>
              {user?.role !== 'client_pme' && (
                <Link href="/users" className="flex items-center gap-3 p-3 rounded-md bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors">
                  <Users className="h-5 w-5" />
                  <span className="font-medium">Inviter un collaborateur</span>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm" data-testid="card-mission-tracker">
        <CardHeader>
          <CardTitle>Suivi des Missions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Activité</TableHead>
                  <TableHead>Chiffre d'Affaires</TableHead>
                  <TableHead>Chargé du dossier</TableHead>
                  <TableHead>Statut de la Mission</TableHead>
                  <TableHead className="w-40">Progression</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingMissions ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                      Chargement des missions...
                    </TableCell>
                  </TableRow>
                ) : activeMissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Stamp className="h-8 w-8 mb-2 opacity-20" />
                        <p>Aucune mission active pour le moment.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  activeMissions.map((mission) => {
                    const progress = mission.checklistTotal > 0
                      ? Math.round((mission.checklistCompleted / mission.checklistTotal) * 100)
                      : 0
                    return (
                      <TableRow key={mission.id} data-testid={`row-mission-${mission.id}`}>
                        <TableCell>
                          <div className="font-medium text-foreground">{mission.clientName ?? "—"}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {mission.clientLegalForm ?? "—"} • Exercice {mission.fiscalYear}
                          </div>
                        </TableCell>
                        <TableCell className="capitalize text-sm">{mission.clientSector ?? "—"}</TableCell>
                        <TableCell className="text-sm">{formatCurrencyFCFA(mission.clientAnnualTurnover)}</TableCell>
                        <TableCell className="text-sm">
                          {mission.assignedToName ?? (
                            <span className="text-muted-foreground italic">Non assigné</span>
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