import { useRoute, Link } from "wouter"
import {
  useGetMission,
  getGetMissionQueryKey,
  useUpdateMission,
  useListMissionChecklistItems,
  getListMissionChecklistItemsQueryKey,
  useUpdateMissionChecklistItem,
  MissionStatus,
  ChecklistItemStatus,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useState, useMemo } from "react"
import {
  Building2,
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Stamp,
  MessageSquare,
  FileCheck,
  Sparkles,
  Loader2,
  XCircle,
  Info,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { cn } from "@/lib/utils"
import { getToken } from "@/lib/auth"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AIStatus = "CONFORME" | "ALERTE" | "NON_APPLICABLE"

interface AIChecklistResult {
  checklist_item_id: number
  label: string
  status: AIStatus
  justification: string
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
function getMissionStatusLabel(status: MissionStatus) {
  switch (status) {
    case "en_attente": return "En attente"
    case "en_cours":   return "En cours"
    case "anomalie":   return "Anomalie"
    case "valide":     return "Validé"
    case "visa_emis":  return "Visa émis"
    default:           return status
  }
}

function getMissionStatusColor(status: MissionStatus) {
  switch (status) {
    case "en_attente": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
    case "en_cours":   return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
    case "anomalie":   return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
    case "valide":     return "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300"
    case "visa_emis":  return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
    default:           return "bg-gray-100 text-gray-800"
  }
}

function getItemStatusIcon(status: ChecklistItemStatus) {
  switch (status) {
    case "a_verifier": return <Clock       className="h-5 w-5 text-muted-foreground" />
    case "conforme":   return <CheckCircle2 className="h-5 w-5 text-teal-500" />
    case "anomalie":   return <AlertTriangle className="h-5 w-5 text-destructive" />
  }
}

// ---------------------------------------------------------------------------
// AI scanning overlay — displayed while Gemini is running
// ---------------------------------------------------------------------------
function ScanningOverlay({ fiscalYear }: { fiscalYear: number }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-lg bg-background/90 backdrop-blur-sm">
      {/* Animated rings */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/40" />
        <span className="absolute inset-2 animate-ping rounded-full border border-primary/25 [animation-delay:200ms]" />
        <span className="absolute inset-4 animate-ping rounded-full border border-primary/15 [animation-delay:400ms]" />
        <Sparkles className="relative h-7 w-7 text-primary" />
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-primary">
          L&rsquo;IA analyse les comptes du Grand Livre
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Exercice {fiscalYear} — vérification de chaque point de contrôle SYSCOHADA&hellip;
        </p>
      </div>

      {/* Sweeping progress bar */}
      <div className="h-1 w-48 overflow-hidden rounded-full bg-primary/15">
        <div className="h-full w-1/3 rounded-full bg-primary animate-[scan_1.8s_ease-in-out_infinite]" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI result pill — shown beneath each checklist item label
// ---------------------------------------------------------------------------
function AIResultPill({ result }: { result: AIChecklistResult }) {
  if (result.status === "CONFORME") {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 dark:border-teal-900/50 dark:bg-teal-900/20">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
        <p className="text-xs leading-relaxed text-teal-800 dark:text-teal-300">
          <span className="font-semibold">IA — Conforme&nbsp;: </span>
          {result.justification}
        </p>
      </div>
    )
  }

  if (result.status === "ALERTE") {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800/50 dark:bg-amber-900/20">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-300">
          <span className="font-semibold">⚠️ Attention&nbsp;: </span>
          {result.justification}
        </p>
      </div>
    )
  }

  // NON_APPLICABLE
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold">Non applicable&nbsp;: </span>
        {result.justification}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI results summary strip
// ---------------------------------------------------------------------------
function AIResultsSummary({
  results,
  onDismiss,
}: {
  results: Map<number, AIChecklistResult>
  onDismiss: () => void
}) {
  const arr = Array.from(results.values())
  const conforme      = arr.filter((r) => r.status === "CONFORME").length
  const alerte        = arr.filter((r) => r.status === "ALERTE").length
  const nonApplicable = arr.filter((r) => r.status === "NON_APPLICABLE").length

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium">Pré-remplissage IA appliqué</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {conforme} conforme{conforme !== 1 ? "s" : ""} appliqué{conforme !== 1 ? "s" : ""}
          </span>
          {alerte > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {alerte} alerte{alerte !== 1 ? "s" : ""} à examiner
            </span>
          )}
          {nonApplicable > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              {nonApplicable} non applicable{nonApplicable !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Masquer les annotations IA
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function MissionDetail() {
  const [match, params] = useRoute("/clients/:id/missions/:missionId")
  const clientId  = match ? parseInt(params.id)         : 0
  const missionId = match ? parseInt(params.missionId)  : 0

  const { user }  = useAuth()
  const { toast } = useToast()

  // Manual note editor state
  const [activeNoteId,  setActiveNoteId]  = useState<number | null>(null)
  const [noteContent,   setNoteContent]   = useState("")

  // AI analysis state
  const [isAnalyzing,   setIsAnalyzing]   = useState(false)
  const [aiResults,     setAiResults]     = useState<Map<number, AIChecklistResult> | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────
  const {
    data: mission,
    isLoading: isMissionLoading,
    refetch: refetchMission,
  } = useGetMission(missionId, {
    query: { enabled: !!missionId, queryKey: getGetMissionQueryKey(missionId) },
  })

  const {
    data: checklist,
    isLoading: isChecklistLoading,
    refetch: refetchChecklist,
  } = useListMissionChecklistItems(missionId, {
    query: { enabled: !!missionId, queryKey: getListMissionChecklistItemsQueryKey(missionId) },
  })

  const updateMissionMutation = useUpdateMission({
    mutation: {
      onSuccess: () => {
        toast({ title: "Statut de la mission mis à jour" })
        refetchMission()
      },
    },
  })

  const updateItemMutation = useUpdateMissionChecklistItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Point de contrôle mis à jour" })
        refetchChecklist()
        refetchMission()
        setActiveNoteId(null)
      },
    },
  })

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleStatusChange = (newStatus: MissionStatus) => {
    updateMissionMutation.mutate({ id: missionId, data: { status: newStatus } })
  }

  const handleItemStatusChange = (itemId: number, newStatus: ChecklistItemStatus) => {
    if (newStatus === "anomalie") {
      const item = checklist?.find((i) => i.id === itemId)
      setNoteContent(item?.note || "")
      setActiveNoteId(itemId)
      return
    }
    updateItemMutation.mutate({ id: missionId, itemId, data: { status: newStatus } })
  }

  const handleSaveNote = (itemId: number, markAsAnomaly?: boolean) => {
    if (markAsAnomaly && !noteContent.trim()) {
      toast({
        title: "Commentaire obligatoire",
        description: "Décrivez l'anomalie constatée avant d'enregistrer.",
        variant: "destructive",
      })
      return
    }
    updateItemMutation.mutate({
      id: missionId,
      itemId,
      data: markAsAnomaly ? { status: "anomalie", note: noteContent } : { note: noteContent },
    })
  }

  // ── AI analysis trigger ────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!missionId) return
    setIsAnalyzing(true)
    setAiResults(null)

    try {
      const token    = getToken()
      const response = await fetch(`/api/missions/${missionId}/analyze`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `Erreur serveur (${response.status}).`,
        )
      }

      const data: { results: AIChecklistResult[] } = await response.json()

      // Build lookup map
      const map = new Map<number, AIChecklistResult>()
      for (const r of data.results) map.set(r.checklist_item_id, r)
      setAiResults(map)

      // Refetch checklist — backend already wrote CONFORME items to DB
      await Promise.all([refetchChecklist(), refetchMission()])

      const conformeCount = data.results.filter((r) => r.status === "CONFORME").length
      const alerteCount   = data.results.filter((r) => r.status === "ALERTE").length
      toast({
        title: "Analyse IA terminée",
        description: `${conformeCount} point${conformeCount !== 1 ? "s" : ""} conforme${conformeCount !== 1 ? "s" : ""} appliqué${conformeCount !== 1 ? "s" : ""}${alerteCount > 0 ? `, ${alerteCount} alerte${alerteCount !== 1 ? "s" : ""} à examiner` : ""}.`,
      })
    } catch (err) {
      toast({
        title: "Erreur d'analyse IA",
        description: err instanceof Error ? err.message : "Une erreur inattendue est survenue.",
        variant: "destructive",
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const progress = useMemo(() => {
    if (!mission || mission.checklistTotal === 0) return 0
    return Math.round((mission.checklistCompleted / mission.checklistTotal) * 100)
  }, [mission])

  const isCompleted  = progress === 100
  const hasAnomalies = checklist?.some((item) => item.status === "anomalie")
  const isLocked     = mission?.status === "visa_emis"
  const canWrite     = (user?.role === "expert_comptable" || user?.role === "collaborateur") && !isLocked

  // ── Loading / not-found states ─────────────────────────────────────────────
  if (isMissionLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement de la mission&hellip;
        </div>
      </div>
    )
  }
  if (!mission) {
    return <div className="p-8 text-center text-muted-foreground">Mission introuvable</div>
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">

      {/* ── Top bar ── */}
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
                {mission.clientName ?? "Client"}
              </Link>
              <span>/</span>
              <span>Mission de Visa</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              Exercice {mission.fiscalYear}
              <Badge
                variant="outline"
                className={`border-transparent ${getMissionStatusColor(mission.status)}`}
              >
                {getMissionStatusLabel(mission.status)}
              </Badge>
            </h1>
          </div>
        </div>

        {/* Workflow selector — cabinet staff only */}
        {(user?.role === "expert_comptable" || user?.role === "collaborateur") && (
          <div className="flex items-center gap-2 bg-card p-2 rounded-lg border shadow-sm">
            <span className="text-sm font-medium text-muted-foreground mr-2">Workflow&nbsp;:</span>
            {mission.status === "anomalie" ? (
              <Badge
                variant="outline"
                className="border-transparent bg-red-100 text-red-800 px-3 py-1.5"
              >
                Anomalie — résolvez les points signalés pour reprendre
              </Badge>
            ) : (
              <Select
                value={mission.status}
                onValueChange={(v) => handleStatusChange(v as MissionStatus)}
                disabled={isLocked}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en_attente" disabled={mission.status !== "en_attente"}>
                    En attente
                  </SelectItem>
                  <SelectItem
                    value="en_cours"
                    disabled={mission.status !== "en_attente" && mission.status !== "en_cours"}
                  >
                    En cours
                  </SelectItem>
                  <SelectItem
                    value="valide"
                    disabled={mission.status !== "en_cours" || !isCompleted || !!hasAnomalies}
                  >
                    Validé (Prêt pour visa)
                  </SelectItem>
                  <SelectItem
                    value="visa_emis"
                    disabled={mission.status !== "valide" || user?.role !== "expert_comptable"}
                  >
                    Émettre le visa
                    {user?.role !== "expert_comptable" && " (Expert-comptable requis)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        )}
        {user?.role === "stagiaire" && (
          <Badge
            variant="outline"
            className="bg-muted/50 text-muted-foreground border-transparent px-3 py-1.5"
          >
            Accès en lecture seule
          </Badge>
        )}
      </div>

      {/* ── Progress card ── */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 shadow-sm border-border/50">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Avancement du Visa</CardTitle>
                <CardDescription>
                  Référentiel&nbsp;:{" "}
                  <Badge variant="secondary" className="font-mono text-xs ml-1">
                    {mission.accountingSystem}
                  </Badge>
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

            {progress === 100 && !hasAnomalies && mission.status !== "visa_emis" && mission.status !== "valide" && (
              <div className="mt-6 p-4 bg-teal-50 border border-teal-200 rounded-lg flex items-start gap-3 text-teal-800 dark:bg-teal-900/20 dark:border-teal-900/50 dark:text-teal-200">
                <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm">Tous les contrôles sont conformes</h4>
                  <p className="text-sm mt-1">
                    Vous pouvez maintenant valider le dossier pour l'émission du visa.
                  </p>
                  {user?.role === "expert_comptable" && (
                    <Button
                      size="sm"
                      className="mt-3 bg-teal-600 hover:bg-teal-700 text-white"
                      onClick={() => handleStatusChange("valide")}
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
                  <p className="text-sm mt-1">
                    Le visa ne peut pas être émis tant que les points en anomalie ne sont pas résolus.
                  </p>
                </div>
              </div>
            )}

            {mission.status === "valide" && (
              <div className="mt-6 p-4 bg-teal-50 border border-teal-200 rounded-lg flex items-start gap-3 text-teal-800 dark:bg-teal-900/20 dark:border-teal-900/50 dark:text-teal-200">
                <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm">Dossier validé</h4>
                  <p className="text-sm mt-1">
                    Le dossier est prêt&nbsp;: l'expert-comptable peut désormais émettre le visa.
                  </p>
                  {user?.role === "expert_comptable" && (
                    <Button
                      size="sm"
                      className="mt-3 bg-teal-600 hover:bg-teal-700 text-white"
                      onClick={() => handleStatusChange("visa_emis")}
                      disabled={updateMissionMutation.isPending}
                    >
                      <Stamp className="mr-2 h-4 w-4" />
                      Émettre le visa
                    </Button>
                  )}
                </div>
              </div>
            )}

            {isLocked && (
              <div className="mt-6 p-6 bg-primary border-primary rounded-lg flex items-center justify-between text-primary-foreground shadow-inner">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                    <Stamp className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">Visa Comptable Émis</h4>
                    <p className="text-primary-foreground/80 text-sm">
                      La procédure est clôturée pour cet exercice.
                      {mission.visaStampCode && (
                        <>
                          {" "}Cachet numérique&nbsp;:{" "}
                          <span className="font-mono">{mission.visaStampCode}</span>
                        </>
                      )}
                    </p>
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
              Le visa nécessite la vérification des états financiers téléversés dans la GED du
              client.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Checklist section ── */}
      <div className="space-y-4">
        {/* Header row with AI trigger */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight">Grille de Contrôle SYSCOHADA</h2>

          {/* "Pré-remplir par l'IA" button — cabinet write access, mission not locked */}
          {canWrite && (
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || isChecklistLoading}
              className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-sm"
              data-testid="button-ai-analyze"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyse en cours&hellip;
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {aiResults ? "Relancer l'analyse IA" : "Pré-remplir la checklist par l'IA"}
                </>
              )}
            </Button>
          )}
        </div>

        {/* AI results summary strip */}
        {aiResults && !isAnalyzing && (
          <AIResultsSummary results={aiResults} onDismiss={() => setAiResults(null)} />
        )}

        {/* Checklist body */}
        {isChecklistLoading ? (
          <div className="py-8 text-center text-muted-foreground border rounded-lg bg-card">
            Chargement des contrôles&hellip;
          </div>
        ) : !checklist || checklist.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground border rounded-lg bg-card">
            Aucun point de contrôle configuré.
          </div>
        ) : (
          <div className="relative rounded-lg border shadow-sm bg-card overflow-hidden divide-y">
            {/* Scanning overlay */}
            {isAnalyzing && mission && (
              <ScanningOverlay fiscalYear={mission.fiscalYear} />
            )}

            {checklist.map((item) => {
              const aiResult  = aiResults?.get(item.id)
              const isAlerte  = aiResult?.status === "ALERTE"
              const isNA      = aiResult?.status === "NON_APPLICABLE"

              return (
                <div
                  key={item.id}
                  className={cn(
                    "p-4 transition-colors",
                    // DB-driven anomaly state
                    item.status === "anomalie" && "bg-red-50/50 dark:bg-red-900/10",
                    // AI ALERTE overlay — amber border on left
                    isAlerte && item.status !== "anomalie" &&
                      "border-l-4 border-l-amber-400 dark:border-l-amber-500 bg-amber-50/30 dark:bg-amber-900/10",
                    // NON_APPLICABLE — subtle grey tint
                    isNA && "bg-muted/30",
                  )}
                >
                  <div className="flex flex-col sm:flex-row gap-4 justify-between sm:items-start">
                    <div className="flex-1 flex gap-3">
                      <div className="mt-0.5 shrink-0">{getItemStatusIcon(item.status)}</div>
                      <div className="min-w-0 flex-1">
                        <h4
                          className={cn(
                            "font-medium",
                            item.status === "anomalie"
                              ? "text-destructive"
                              : "text-foreground",
                          )}
                        >
                          {item.orderIndex}. {item.label}
                        </h4>

                        {/* AI result annotation (shown unless the accountant hid it) */}
                        {aiResult && (
                          <AIResultPill result={aiResult} />
                        )}

                        {/* Manual note — only when note editor is NOT open */}
                        {item.note && activeNoteId !== item.id && !aiResult && (
                          <div className="mt-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md border-l-2 border-l-primary/50">
                            {item.note}
                          </div>
                        )}

                        {/* AI conforme note preview (DB note = AI justification) */}
                        {item.status === "conforme" && item.note && aiResult?.status === "CONFORME" && activeNoteId !== item.id && (
                          <div className="mt-2 text-xs text-muted-foreground italic pl-1">
                            Justification enregistrée dans la note du point.
                          </div>
                        )}

                        {/* Note / anomaly editor */}
                        {activeNoteId === item.id && (
                          <div className="mt-3 space-y-2 max-w-2xl">
                            {item.status !== "anomalie" && (
                              <p className="text-xs font-medium text-destructive flex items-center gap-1">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Commentaire obligatoire pour signaler une anomalie
                              </p>
                            )}
                            <Textarea
                              placeholder="Décrire l'anomalie constatée, une référence de document…"
                              className="min-h-[100px] text-sm"
                              value={noteContent}
                              onChange={(e) => setNoteContent(e.target.value)}
                              autoFocus
                            />
                            <div className="flex gap-2">
                              {item.status !== "anomalie" ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleSaveNote(item.id, true)}
                                  disabled={updateItemMutation.isPending || !noteContent.trim()}
                                >
                                  Signaler l'anomalie
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveNote(item.id)}
                                  disabled={updateItemMutation.isPending}
                                >
                                  Enregistrer la note
                                </Button>
                              )}
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

                    {/* Action controls — cabinet staff, non-locked mission */}
                    {canWrite && user?.role !== "client_pme" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={
                            item.note || activeNoteId === item.id
                              ? "text-primary"
                              : "text-muted-foreground"
                          }
                          onClick={() => {
                            if (activeNoteId === item.id) {
                              setActiveNoteId(null)
                            } else {
                              setNoteContent(item.note ?? "")
                              setActiveNoteId(item.id)
                            }
                          }}
                          title="Ajouter une observation"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>

                        {/* Status toggle — not for stagiaire */}
                        {user?.role !== "stagiaire" && (
                          <div className="flex bg-muted/50 p-1 rounded-md">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-8 px-2",
                                item.status === "a_verifier"
                                  ? "bg-background shadow-sm text-foreground"
                                  : "text-muted-foreground",
                              )}
                              onClick={() => handleItemStatusChange(item.id, "a_verifier")}
                            >
                              À valider
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-8 px-2",
                                item.status === "conforme"
                                  ? "bg-teal-100 text-teal-800 hover:bg-teal-100 dark:bg-teal-900/50 dark:text-teal-300"
                                  : "text-muted-foreground hover:text-teal-600",
                              )}
                              onClick={() => handleItemStatusChange(item.id, "conforme")}
                            >
                              Conforme
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-8 px-2",
                                item.status === "anomalie"
                                  ? "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/50 dark:text-red-300"
                                  : "text-muted-foreground hover:text-destructive",
                              )}
                              onClick={() => handleItemStatusChange(item.id, "anomalie")}
                            >
                              Anomalie
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
