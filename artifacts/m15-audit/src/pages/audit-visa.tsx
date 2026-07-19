/**
 * Module M16 — Audit IA (Mission Visa)
 * Route : /cabinet/client/:clientId/audit-visa
 *
 * Launches an AI-powered compliance review against the client's Grand Livre,
 * Balance des Comptes, and anomaly log for the chosen fiscal year.
 * Renders a checklist of vigilance points and an executive audit summary.
 */
import { useState } from "react"
import { useRoute, Link } from "wouter"
import {
  useGetClient,
  getGetClientQueryKey,
} from "@workspace/api-client-react"
import { getToken, getApiBase } from "@/lib/auth"
import {
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
  FileText,
  ShieldCheck,
  Loader2,
  CalendarDays,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"

// ---------------------------------------------------------------------------
// Types — mirror the JSON schema defined in the backend route.
// ---------------------------------------------------------------------------
type CheckpointStatus   = "PASSED" | "WARNING" | "CRITICAL"
type CheckpointSeverity = "OK" | "ATTENTION" | "CRITIQUE"
type CheckpointCategory = "Cash" | "Fiscal" | "Coherence" | "SYSCOHADA" | "Anomalies"

interface Checkpoint {
  id:       string
  category: CheckpointCategory
  title:    string
  status:   CheckpointStatus
  severity: CheckpointSeverity
  details:  string
}

interface AuditVisaResult {
  clientId:          number
  clientName:        string
  year:              number
  checkpoints:       Checkpoint[]
  executive_summary: string
  generated_at:      string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i)

const STATUS_META: Record<CheckpointStatus, {
  icon:        React.ReactNode
  badgeClass:  string
  rowClass:    string
  label:       string
}> = {
  PASSED: {
    icon:       <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    badgeClass: "bg-emerald-100 text-emerald-800 border-transparent dark:bg-emerald-900/30 dark:text-emerald-300",
    rowClass:   "border-l-4 border-emerald-400 dark:border-emerald-600",
    label:      "Conforme",
  },
  WARNING: {
    icon:       <AlertTriangle className="h-4 w-4 text-amber-600" />,
    badgeClass: "bg-amber-100 text-amber-800 border-transparent dark:bg-amber-900/30 dark:text-amber-300",
    rowClass:   "border-l-4 border-amber-400 dark:border-amber-500",
    label:      "Attention",
  },
  CRITICAL: {
    icon:       <XCircle className="h-4 w-4 text-red-600" />,
    badgeClass: "bg-red-100 text-red-800 border-transparent dark:bg-red-900/30 dark:text-red-300",
    rowClass:   "border-l-4 border-red-500 dark:border-red-600",
    label:      "Critique",
  },
}

const CATEGORY_LABELS: Record<CheckpointCategory, string> = {
  Cash:       "Trésorerie",
  Fiscal:     "Risque Fiscal",
  Coherence:  "Cohérence",
  SYSCOHADA:  "SYSCOHADA",
  Anomalies:  "Anomalies",
}

// ---------------------------------------------------------------------------
// Radar scanning loader — pure CSS animation
// ---------------------------------------------------------------------------
function RadarLoader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      {/* Radar rings */}
      <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>
        {/* Static rings */}
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="absolute rounded-full border border-primary/20"
            style={{
              width:  `${i * 60}px`,
              height: `${i * 60}px`,
            }}
          />
        ))}
        {/* Pulsing outer ring */}
        <span className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
        {/* Rotating sweep */}
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, transparent 75%, hsl(var(--primary) / 0.5) 100%)",
            animation:  "spin 2.4s linear infinite",
          }}
        />
        {/* Centre dot */}
        <span className="relative z-10 h-3 w-3 rounded-full bg-primary shadow-lg" />
        {/* Cross-hairs */}
        <span className="absolute top-1/2 left-0 right-0 h-px bg-primary/15 -translate-y-px" />
        <span className="absolute left-1/2 top-0 bottom-0 w-px bg-primary/15 -translate-x-px" />
      </div>

      <p className="mt-8 text-center text-sm font-semibold tracking-wide text-primary animate-pulse">
        Analyse critique du Grand Livre et de la Balance en cours par l'IA…
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground max-w-xs">
        Examen des comptes SYSCOHADA, des mouvements de trésorerie, des
        ratios charges/produits et des anomalies système.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vigilance checkpoint card
// ---------------------------------------------------------------------------
function CheckpointCard({ cp }: { cp: Checkpoint }) {
  const meta = STATUS_META[cp.status]
  return (
    <div className={cn("rounded-lg bg-card p-4 shadow-sm", meta.rowClass)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{meta.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-foreground">{cp.title}</span>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", meta.badgeClass)}>
              {meta.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
              {CATEGORY_LABELS[cp.category] ?? cp.category}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{cp.details}</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60 mt-0.5">{cp.id}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary stats bar
// ---------------------------------------------------------------------------
function SummaryBar({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const critical = checkpoints.filter((c) => c.status === "CRITICAL").length
  const warning  = checkpoints.filter((c) => c.status === "WARNING").length
  const passed   = checkpoints.filter((c) => c.status === "PASSED").length

  const overallStatus =
    critical > 0 ? "CRITIQUE" : warning > 0 ? "ATTENTION" : "CONFORME"
  const overallClass =
    critical > 0
      ? "bg-red-100 text-red-800 border-transparent dark:bg-red-900/30 dark:text-red-300"
      : warning > 0
      ? "bg-amber-100 text-amber-800 border-transparent dark:bg-amber-900/30 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-800 border-transparent dark:bg-emerald-900/30 dark:text-emerald-300"

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="outline" className={cn("text-sm px-3 py-1 font-semibold", overallClass)}>
        {overallStatus}
      </Badge>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <XCircle className="h-3.5 w-3.5 text-red-500" />
        <span>{critical} critique{critical !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        <span>{warning} avertissement{warning !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        <span>{passed} conforme{passed !== 1 ? "s" : ""}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AuditVisa() {
  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/audit-visa")
  const clientId   = params?.clientId ? Number(params.clientId) : null

  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [isLoading,    setIsLoading]    = useState(false)
  const [result,       setResult]       = useState<AuditVisaResult | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  const { data: client } = useGetClient(clientId ?? 0, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId ?? 0) },
  })

  async function handleRunAudit() {
    if (!clientId) return
    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const token    = getToken()
      const response = await fetch(
        `${getApiBase()}/api/audit/visa-check/${clientId}?year=${selectedYear}`,
        {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      )

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `Erreur serveur (${response.status}).`,
        )
      }

      const data: AuditVisaResult = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue.")
    } finally {
      setIsLoading(false)
    }
  }

  // Sorted: CRITICAL first, then WARNING, then PASSED
  const sortedCheckpoints = result
    ? [...result.checkpoints as Checkpoint[]].sort((a, b) => {
        const order: Record<CheckpointStatus, number> = { CRITICAL: 0, WARNING: 1, PASSED: 2 }
        return order[a.status] - order[b.status]
      })
    : []

  if (!clientId) {
    return (
      <div className="min-h-screen bg-background">
        <ClientAccountingNav activeTab="audit-visa" />
        <div className="mx-auto max-w-5xl p-6">
          <Card className="shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-4 p-16 text-center text-muted-foreground">
              <ShieldCheck className="h-10 w-10 opacity-20" />
              <div>
                <p className="font-medium">Sélectionnez un client</p>
                <p className="mt-1 text-sm">
                  Choisissez un client dans le menu ci-dessus pour lancer l'audit IA.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Full-screen radar overlay while the AI is running */}
      {isLoading && <RadarLoader />}

      <div className="border-b bg-card px-6 py-3">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Retour au cabinet
        </Link>
      </div>

      <ClientAccountingNav activeTab="audit-visa" />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Mission Visa — Audit IA de Conformité
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {client
                ? `Revue de conformité SYSCOHADA pour ${client.name}, pilotée par l'intelligence artificielle.`
                : "Analyse complète du Grand Livre et de la Balance des comptes par l'IA."}
            </p>
          </div>
          {result && (
            <div className="text-right text-xs text-muted-foreground">
              <CalendarDays className="inline-block h-3.5 w-3.5 mr-1 -mt-0.5" />
              Généré le {new Date(result.generated_at).toLocaleString("fr-FR")}
            </div>
          )}
        </div>

        {/* ── Launch card ── */}
        <Card className="border-2 border-dashed border-primary/30 bg-primary/5 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-primary/10 p-3">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">
                  Lancer l'audit de conformité par l'IA
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  L'IA analyse le Grand Livre, la Balance des comptes, et les
                  anomalies système pour produire un rapport préparatoire au Visa
                  National SYSCOHADA.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Select
                value={String(selectedYear)}
                onValueChange={(v) => setSelectedYear(Number(v))}
                disabled={isLoading}
              >
                <SelectTrigger className="w-28" data-testid="select-audit-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                size="lg"
                onClick={handleRunAudit}
                disabled={isLoading}
                data-testid="button-run-audit"
                className="gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyse en cours…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {result ? "Relancer l'audit" : "Lancer l'audit IA"}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Error state ── */}
        {error && !isLoading && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Erreur lors de l'audit</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ── Results ── */}
        {result && !isLoading && (
          <>
            {/* Summary stats */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold">
                Résultats — Exercice {result.year}
              </h2>
              <SummaryBar checkpoints={result.checkpoints as Checkpoint[]} />
            </div>

            {/* Section 1: Tableau des Points de Vigilance */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Tableau des Points de Vigilance
                </CardTitle>
                <CardDescription>
                  {sortedCheckpoints.length} point{sortedCheckpoints.length !== 1 ? "s" : ""} de contrôle
                  analysé{sortedCheckpoints.length !== 1 ? "s" : ""} — classés par niveau de criticité.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sortedCheckpoints.map((cp) => (
                  <CheckpointCard key={cp.id} cp={cp} />
                ))}
              </CardContent>
            </Card>

            {/* Section 2: Rapport Préparatoire au Visa */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-5 w-5 text-primary" />
                  Rapport Préparatoire au Visa
                </CardTitle>
                <CardDescription>
                  Synthèse exécutive générée par l'IA — prête à être annexée au dossier permanent d'audit.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border bg-muted/40 p-5">
                  {/* Formal header */}
                  <div className="mb-4 border-b pb-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Note d'Audit Préparatoire — Confidentiel
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {result.clientName} — Exercice clos le 31 décembre {result.year}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Généré le {new Date(result.generated_at).toLocaleString("fr-FR", {
                        dateStyle: "long",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  {/* AI-generated text */}
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {result.executive_summary.split("\n").filter(Boolean).map((para, i) => (
                      <p key={i} className="text-sm leading-relaxed text-foreground mb-3 last:mb-0">
                        {para}
                      </p>
                    ))}
                  </div>
                  {/* Signature block */}
                  <div className="mt-5 border-t pt-4 text-xs text-muted-foreground">
                    <p className="font-medium">Note de synthèse générée par le moteur d'audit IA M15-AUDIT (Module M16)</p>
                    <p className="mt-0.5">Ce rapport a valeur indicative. Il doit être validé et signé par l'Expert-Comptable responsable avant toute transmission officielle.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

      </div>
    </div>
  )
}
