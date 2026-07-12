import { useRoute, Link } from "wouter"
import { 
  useGetMission,
  getGetMissionQueryKey,
  useUpdateMission, 
  useListMissionChecklistItems,
  getListMissionChecklistItemsQueryKey,
  useUpdateMissionChecklistItem,
  MissionStatus,
  ChecklistItemStatus
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useState, useMemo } from "react"
import { 
  Building2, 
  ChevronLeft, 
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Stamp,
  MessageSquare,
  FileCheck
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function getStatusLabel(status: MissionStatus) {
  switch (status) {
    case 'en_attente': return 'En attente'
    case 'en_cours': return 'En cours'
    case 'anomalie': return 'Anomalie'
    case 'valide': return 'Validé'
    case 'visa_emis': return 'Visa émis'
    default: return status
  }
}

function getStatusColor(status: MissionStatus) {
  switch (status) {
    case 'en_attente': return 'bg-orange-100 text-orange-800'
    case 'en_cours': return 'bg-blue-100 text-blue-800'
    case 'anomalie': return 'bg-red-100 text-red-800'
    case 'valide': return 'bg-teal-100 text-teal-800'
    case 'visa_emis': return 'bg-green-100 text-green-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

function getItemStatusIcon(status: ChecklistItemStatus) {
  switch (status) {
    case 'a_verifier': return <Clock className="h-5 w-5 text-muted-foreground" />
    case 'conforme': return <CheckCircle2 className="h-5 w-5 text-teal-500" />
    case 'anomalie': return <AlertTriangle className="h-5 w-5 text-destructive" />
  }
}

export default function MissionDetail() {
  const [match, params] = useRoute("/clients/:id/missions/:missionId")
  const clientId = match ? parseInt(params.id) : 0
  const missionId = match ? parseInt(params.missionId) : 0
  
  const { user } = useAuth()
  const { toast } = useToast()
  
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null)
  const [noteContent, setNoteContent] = useState("")

  const { data: mission, isLoading: isMissionLoading, refetch: refetchMission } = useGetMission(missionId, {
    query: { enabled: !!missionId, queryKey: getGetMissionQueryKey(missionId) }
  })
  
  const { data: checklist, isLoading: isChecklistLoading, refetch: refetchChecklist } = useListMissionChecklistItems(missionId, {
    query: { enabled: !!missionId, queryKey: getListMissionChecklistItemsQueryKey(missionId) }
  })

  const updateMissionMutation = useUpdateMission({
    mutation: {
      onSuccess: () => {
        toast({ title: "Statut de la mission mis à jour" })
        refetchMission()
      }
    }
  })

  const updateItemMutation = useUpdateMissionChecklistItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Point de contrôle mis à jour" })
        refetchChecklist()
        refetchMission() // Refresh progress
        setActiveNoteId(null)
      }
    }
  })

  const handleStatusChange = (newStatus: MissionStatus) => {
    updateMissionMutation.mutate({
      id: missionId,
      data: { status: newStatus }
    })
  }

  const handleItemStatusChange = (itemId: number, newStatus: ChecklistItemStatus) => {
    updateItemMutation.mutate({
      id: missionId,
      itemId: itemId,
      data: { status: newStatus }
    })
  }

  const handleSaveNote = (itemId: number) => {
    updateItemMutation.mutate({
      id: missionId,
      itemId: itemId,
      data: { note: noteContent }
    })
  }

  const progress = useMemo(() => {
    if (!mission || mission.checklistTotal === 0) return 0
    return Math.round((mission.checklistCompleted / mission.checklistTotal) * 100)
  }, [mission])

  const isCompleted = progress === 100
  const hasAnomalies = checklist?.some(item => item.status === 'anomalie')

  if (isMissionLoading) {
    return <div className="h-[50vh] flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
        Chargement de la mission...
      </div>
    </div>
  }

  if (!mission) {
    return <div className="p-8 text-center text-muted-foreground">Mission introuvable</div>
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clients/${clientId}`}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Building2 className="h-4 w-4" />
              <Link href={`/clients/${clientId}`} className="hover:underline">
                {mission.clientName || 'Client'}
              </Link>
              <span>/</span>
              <span>Mission de Visa</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              Exercice {mission.fiscalYear}
              <Badge variant="outline" className={`border-transparent ${getStatusColor(mission.status)}`}>
                {getStatusLabel(mission.status)}
              </Badge>
            </h1>
          </div>
        </div>
        
        {user?.role !== 'client_pme' && (
          <div className="flex items-center gap-2 bg-card p-2 rounded-lg border shadow-sm">
            <span className="text-sm font-medium text-muted-foreground mr-2">Workflow :</span>
            <Select 
              value={mission.status} 
              onValueChange={(v) => handleStatusChange(v as MissionStatus)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en_attente">En attente</SelectItem>
                <SelectItem value="en_cours">En cours</SelectItem>
                <SelectItem value="anomalie">Anomalie signalée</SelectItem>
                <SelectItem value="valide" disabled={!isCompleted || hasAnomalies}>Validé (Prêt pour visa)</SelectItem>
                <SelectItem value="visa_emis" disabled={mission.status !== 'valide' && mission.status !== 'visa_emis'}>Visa Émis</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 shadow-sm border-border/50">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Avancement du Visa</CardTitle>
                <CardDescription>
                  Référentiel : <Badge variant="secondary" className="font-mono text-xs ml-1">{mission.accountingSystem}</Badge>
                </CardDescription>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-primary">{progress}%</div>
                <div className="text-sm text-muted-foreground">
                  {mission.checklistCompleted} sur {mission.checklistTotal} points contrôlés
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="h-3" />
            
            {progress === 100 && !hasAnomalies && mission.status !== 'visa_emis' && mission.status !== 'valide' && (
              <div className="mt-6 p-4 bg-teal-50 border border-teal-200 rounded-lg flex items-start gap-3 text-teal-800 dark:bg-teal-900/20 dark:border-teal-900/50 dark:text-teal-200">
                <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm">Tous les contrôles sont conformes</h4>
                  <p className="text-sm mt-1">Vous pouvez maintenant valider le dossier pour l'émission du visa.</p>
                  {user?.role === 'expert_comptable' && (
                    <Button 
                      size="sm" 
                      className="mt-3 bg-teal-600 hover:bg-teal-700 text-white"
                      onClick={() => handleStatusChange('valide')}
                      disabled={updateMissionMutation.isPending}
                    >
                      Valider le dossier
                    </Button>
                  )}
                </div>
              </div>
            )}
            
            {hasAnomalies && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-800 dark:bg-red-900/20 dark:border-red-900/50 dark:text-red-200">
                <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm">Anomalies bloquantes détectées</h4>
                  <p className="text-sm mt-1">Le visa ne peut pas être émis tant que les points en anomalie ne sont pas résolus.</p>
                </div>
              </div>
            )}

            {mission.status === 'visa_emis' && (
              <div className="mt-6 p-6 bg-primary border-primary rounded-lg flex items-center justify-between text-primary-foreground shadow-inner">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                    <Stamp className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">Visa Comptable Émis</h4>
                    <p className="text-primary-foreground/80 text-sm">La procédure est clôturée pour cet exercice.</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="pb-4">
            <CardTitle>Dossier Permanent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link href={`/clients/${clientId}?tab=documents`}>
                <FileCheck className="mr-2 h-4 w-4" />
                Accéder aux documents
              </Link>
            </Button>
            <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg">
              Le visa nécessite la vérification des états financiers téléversés dans la GED du client.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Grille de Contrôle SYSCOHADA</h2>
        
        {isChecklistLoading ? (
          <div className="py-8 text-center text-muted-foreground border rounded-lg bg-card">Chargement des contrôles...</div>
        ) : !checklist || checklist.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground border rounded-lg bg-card">Aucun point de contrôle configuré.</div>
        ) : (
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden divide-y">
            {checklist.map((item) => (
              <div key={item.id} className={`p-4 transition-colors ${item.status === 'anomalie' ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                <div className="flex flex-col sm:flex-row gap-4 justify-between sm:items-start">
                  <div className="flex-1 flex gap-3">
                    <div className="mt-0.5">{getItemStatusIcon(item.status)}</div>
                    <div>
                      <h4 className={`font-medium ${item.status === 'anomalie' ? 'text-destructive' : 'text-foreground'}`}>
                        {item.orderIndex}. {item.label}
                      </h4>
                      
                      {item.note && activeNoteId !== item.id && (
                        <div className="mt-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md border-l-2 border-l-primary/50">
                          {item.note}
                        </div>
                      )}
                      
                      {activeNoteId === item.id && (
                        <div className="mt-3 space-y-2 max-w-2xl">
                          <Textarea 
                            placeholder="Saisir une observation, une référence de document..."
                            className="min-h-[100px] text-sm"
                            value={noteContent}
                            onChange={(e) => setNoteContent(e.target.value)}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              onClick={() => handleSaveNote(item.id)}
                              disabled={updateItemMutation.isPending}
                            >
                              Enregistrer la note
                            </Button>
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              onClick={() => setActiveNoteId(null)}
                              disabled={updateItemMutation.isPending}
                            >
                              Annuler
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {user?.role !== 'client_pme' && mission.status !== 'visa_emis' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className={item.note || activeNoteId === item.id ? 'text-primary' : 'text-muted-foreground'}
                        onClick={() => {
                          if (activeNoteId === item.id) {
                            setActiveNoteId(null)
                          } else {
                            setNoteContent(item.note || "")
                            setActiveNoteId(item.id)
                          }
                        }}
                        title="Ajouter une observation"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                      
                      <div className="flex bg-muted/50 p-1 rounded-md">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={`h-8 px-2 ${item.status === 'a_verifier' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                          onClick={() => handleItemStatusChange(item.id, 'a_verifier')}
                        >
                          À valider
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={`h-8 px-2 ${item.status === 'conforme' ? 'bg-teal-100 text-teal-800 hover:bg-teal-100 dark:bg-teal-900/50 dark:text-teal-300' : 'text-muted-foreground hover:text-teal-600'}`}
                          onClick={() => handleItemStatusChange(item.id, 'conforme')}
                        >
                          Conforme
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={`h-8 px-2 ${item.status === 'anomalie' ? 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/50 dark:text-red-300' : 'text-muted-foreground hover:text-destructive'}`}
                          onClick={() => handleItemStatusChange(item.id, 'anomalie')}
                        >
                          Anomalie
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}