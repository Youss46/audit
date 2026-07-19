import { useMemo, useRef, useState } from "react"
import { Link } from "wouter"
import {
  useGetClient,
  getGetClientQueryKey,
  useListMissions,
  getListMissionsQueryKey,
  useListClientDocuments,
  getListClientDocumentsQueryKey,
  useUploadClientDocument,
  useListThreads,
  getListThreadsQueryKey,
  MissionStatus,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { formatDateTime } from "@/lib/utils"
import { getSystemDescription } from "@/lib/visa-engine"
import { Building2, UploadCloud, FileText, Stamp, Clock, Activity, CheckCircle2, AlertTriangle, MessageSquare, Fuel, MapPin, ArrowRight, Wallet, LogOut } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { CommentThreadSidebar } from "@/components/collaboration/CommentThreadSidebar"

// `status` is null when no mission has been opened for this client yet.
function getStatusLabel(status: MissionStatus | null | undefined) {
  switch (status) {
    case 'en_attente': return 'En attente'
    case 'en_cours': return 'En cours'
    case 'anomalie': return 'Anomalie'
    case 'valide': return 'Validé'
    case 'visa_emis': return 'Visa émis'
    default: return 'Aucune mission'
  }
}

function getStatusColor(status: MissionStatus | null | undefined) {
  switch (status) {
    case 'en_attente': return 'bg-orange-100 text-orange-800'
    case 'en_cours': return 'bg-blue-100 text-blue-800'
    case 'anomalie': return 'bg-red-100 text-red-800'
    case 'valide': return 'bg-teal-100 text-teal-800'
    case 'visa_emis': return 'bg-green-100 text-green-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

function getStatusIcon(status: MissionStatus | null | undefined) {
  switch (status) {
    case 'en_attente': return <Clock className="h-4 w-4" />
    case 'en_cours': return <Activity className="h-4 w-4" />
    case 'anomalie': return <AlertTriangle className="h-4 w-4" />
    case 'valide': return <CheckCircle2 className="h-4 w-4" />
    case 'visa_emis': return <Stamp className="h-4 w-4" />
    default: return null
  }
}

function bytesToSize(bytes: number) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  if (bytes === 0) return '0 Byte'
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString())
  return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i]
}

const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"]
const PORTAL_CATEGORY = "Procédure de Visa"

// Module P2 (Espace PME): the self-service portal a client_pme account lands
// on. It only ever shows this one client's dossier — the drag-and-drop zone
// lets the client hand off tax/financial documents to the firm, which
// automatically starts the visa procedure (module M4) on the active mission.
export default function ClientPortal() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const clientId = user?.clientId ?? 0

  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: client, isLoading: isClientLoading } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId) },
  })
  const { data: missions, refetch: refetchMissions } = useListMissions({ clientId }, {
    query: { enabled: !!clientId, queryKey: getListMissionsQueryKey({ clientId }) },
  })
  const { data: documents, refetch: refetchDocs } = useListClientDocuments(clientId, {
    query: { enabled: !!clientId, queryKey: getListClientDocumentsQueryKey(clientId) },
  })

  // Module M26: open discussions the cabinet has raised on this dossier —
  // the client's own view into "le Slack de la Révision Comptable".
  const { data: threads } = useListThreads(
    { clientId, unresolvedOnly: true },
    { query: { enabled: !!clientId, queryKey: getListThreadsQueryKey({ clientId, unresolvedOnly: true }) } },
  )
  const [openThread, setOpenThread] = useState<{ targetType: "TRANSACTION_LINE" | "PENDING_DOCUMENT" | "TAX_DECLARATION"; targetId: number; label: string } | null>(null)

  const uploadMutation = useUploadClientDocument({
    mutation: {
      onSuccess: () => {
        toast({ title: "Document envoyé avec succès", description: "Votre expert-comptable a été notifié." })
        refetchDocs()
        refetchMissions()
      },
      onError: (error) => {
        toast({
          title: "Échec de l'envoi",
          description: error.data?.error || "Une erreur est survenue.",
          variant: "destructive",
        })
      },
    },
  })

  // The mission driving the current visa procedure: the most recent one
  // that hasn't reached visa_emis yet, else simply the most recent.
  const activeMission = useMemo(() => {
    if (!missions || missions.length === 0) return null
    const sorted = [...missions].sort((a, b) => b.fiscalYear - a.fiscalYear)
    return sorted.find((m) => m.status !== 'visa_emis') ?? sorted[0]
  }, [missions])

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      toast({
        title: "Format non autorisé",
        description: "Seuls les fichiers PDF, PNG ou JPEG sont acceptés.",
        variant: "destructive",
      })
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const base64Data = event.target?.result?.toString().split(',')[1]
      if (!base64Data) return
      uploadMutation.mutate({
        id: clientId,
        data: {
          fileName: file.name,
          mimeType: file.type,
          fileData: base64Data,
          category: PORTAL_CATEGORY,
        },
      })
    }
    reader.readAsDataURL(file)
  }

  if (isClientLoading || !client) {
    return (
      <div className="h-[50vh] flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
          Chargement de votre espace...
        </div>
      </div>
    )
  }

  const portalDocuments = (documents ?? []).filter((d) => d.category === PORTAL_CATEGORY)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {user?.roleCode === 'POMPISTE' ? 'Espace Pompiste' : 'Espace PME'}
        </h1>
        <p className="text-muted-foreground mt-2">
          Bienvenue, <span className="font-medium text-foreground">{user?.fullName}</span>.{" "}
          {user?.role === 'client_staff'
            ? "Accédez rapidement à vos outils de travail."
            : "Déposez vos documents pour votre cabinet comptable."}
        </p>
      </div>

      {/* Module M29 — quick-access dashboard for client_staff accounts.
          Rendered above the visa-portal content so field agents land
          immediately on their primary tools without scrolling. */}
      {user?.role === 'client_staff' && user.roleCode === 'POMPISTE' && (
        <Card className="shadow-sm border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <Fuel className="h-5 w-5" />
              Actions du pompiste
            </CardTitle>
            <CardDescription>
              Saisie des relevés et des ventes — vos outils de travail quotidien.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button asChild size="lg" className="justify-between bg-amber-600 hover:bg-amber-700 text-white h-auto py-4">
                <Link href="/releve-index">
                  <div className="text-left">
                    <div className="font-semibold">Relevé d'index de pompe</div>
                    <div className="text-xs opacity-80 font-normal mt-0.5">Saisir les compteurs en début / fin de service</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 ml-2" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="justify-between border-amber-300 dark:border-amber-700 h-auto py-4">
                <Link href="/ventes-carburant">
                  <div className="text-left">
                    <div className="font-semibold">Ventes de carburant</div>
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">Enregistrer les recettes de la pompe</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 ml-2" />
                </Link>
              </Button>
              {user?.roleCode !== 'POMPISTE' && (
                <Button asChild size="sm" variant="ghost" className="sm:col-span-2 text-muted-foreground justify-start">
                  <Link href="/caisse">
                    <Wallet className="h-4 w-4 mr-2" />
                    Ouvrir la Caisse Terrain complète
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {user?.role === 'client_staff' && user.roleCode === 'AGENT_TERRAIN' && (
        <Card className="shadow-sm border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
              <MapPin className="h-5 w-5" />
              Actions de terrain
            </CardTitle>
            <CardDescription>
              Suivi des mouvements et déclarations — vos outils de saisie quotidienne.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button asChild size="lg" className="justify-between h-auto py-4">
                <Link href="/caisse">
                  <div className="text-left">
                    <div className="font-semibold">Saisir un mouvement de caisse</div>
                    <div className="text-xs opacity-80 font-normal mt-0.5">Recette ou dépense en espèces</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 ml-2" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="justify-between h-auto py-4">
                <Link href="/mes-operations">
                  <div className="text-left">
                    <div className="font-semibold">Déclarer une opération</div>
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">Achats, ventes ou autres opérations</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {user?.roleCode !== 'POMPISTE' && (
        <Card className="shadow-sm" data-testid="card-client-summary">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>{client.name}</CardTitle>
                <CardDescription>{client.legalForm} — {getSystemDescription(client.accountingSystem ?? 'SMT' as any)}</CardDescription>
              </div>
            </div>
            <Badge className={`${getStatusColor(client.missionStatus)} border-0 flex items-center gap-1.5`}>
              {getStatusIcon(client.missionStatus)}
              {getStatusLabel(client.missionStatus)}
            </Badge>
          </CardHeader>
          {activeMission && (
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Mission en cours : exercice <span className="font-medium text-foreground">{activeMission.fiscalYear}</span> — {activeMission.checklistCompleted}/{activeMission.checklistTotal} points de contrôle traités par votre cabinet.
              </p>
            </CardContent>
          )}
        </Card>
      )}

      {threads && threads.length > 0 && (
        <Card className="shadow-sm border-blue-200 dark:border-blue-900" data-testid="card-pending-requests">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Demandes du Cabinet en cours ({threads.length})
            </CardTitle>
            <CardDescription>
              Votre expert-comptable attend une réponse sur ces points. Cliquez pour répondre directement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="list-pending-requests">
              {threads.map((thread) => (
                <li key={thread.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{thread.targetLabel}</p>
                    {thread.lastMessage && (
                      <p className="text-xs text-muted-foreground truncate">{thread.lastMessage}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() =>
                      setOpenThread({ targetType: thread.targetType, targetId: thread.targetId, label: thread.targetLabel })
                    }
                    data-testid={`button-open-thread-${thread.id}`}
                  >
                    Répondre
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {user?.roleCode !== 'POMPISTE' && (
        <>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Déposer un document</CardTitle>
              <CardDescription>
                Glissez-déposez votre liasse fiscale ou vos états financiers (PDF, PNG, JPEG). Le dépôt lance automatiquement la procédure de visa auprès de votre cabinet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                data-testid="dropzone-upload"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  handleFiles(e.dataTransfer.files)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
                } ${uploadMutation.isPending ? "opacity-60 pointer-events-none" : ""}`}
              >
                <UploadCloud className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">
                    {uploadMutation.isPending ? "Envoi en cours..." : "Glissez-déposez votre fichier ici"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">ou cliquez pour parcourir vos fichiers</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Vos documents envoyés</CardTitle>
              <CardDescription>Historique des dépôts pour la procédure de visa en cours.</CardDescription>
            </CardHeader>
            <CardContent>
              {portalDocuments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Aucun document envoyé pour le moment.</p>
              ) : (
                <ul className="divide-y" data-testid="list-portal-documents">
                  {portalDocuments.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="truncate font-medium text-sm">{doc.fileName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0 ml-4">
                        {bytesToSize(doc.fileSize)} · {formatDateTime(doc.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {user?.roleCode === 'POMPISTE' && (
        <div className="pt-4 pb-2">
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between px-1 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{user.fullName}</p>
                <p className="text-xs text-muted-foreground">Pompiste</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    title="Se déconnecter"
                    data-testid="button-pompiste-logout"
                  >
                    <LogOut className="h-5 w-5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Vous devrez vous reconnecter avec votre identifiant et votre mot de passe pour accéder à nouveau à votre espace.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={logout}>Se déconnecter</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}

      {clientId && openThread && (
        <CommentThreadSidebar
          open={!!openThread}
          onOpenChange={(open) => !open && setOpenThread(null)}
          clientId={clientId}
          targetType={openThread.targetType}
          targetId={openThread.targetId}
          targetSummary={<div className="text-xs text-muted-foreground">{openThread.label}</div>}
        />
      )}
    </div>
  )
}
