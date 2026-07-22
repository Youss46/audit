import { useState } from "react"
import { useRoute } from "wouter"
import { useAuth } from "@/hooks/use-auth"
import { getToken, getApiBase } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"
import {
  BrainCircuit,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  BookOpen,
  ShieldAlert,
  ReceiptText,
  ArrowDownUp,
  Loader2,
  ChevronRight,
  Info,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Anomaly {
  id: string
  severity: "high" | "medium" | "low"
  account_code: string
  description: string
  recommendation: string
}

interface EntryLine {
  account_code: string
  account_label: string
  debit: number
  credit: number
}

interface ProposedEntry {
  id: string
  journal_code: "OD"
  label: string
  justification: string
  category: "depreciation" | "provision" | "cutoff" | "other"
  lines: EntryLine[]
  _posted?: boolean
  _posting?: boolean
}

interface SummaryStats {
  total_revenue: number
  total_expenses: number
  net_income: number
  flagged_risks_count: number
}

interface ReviewResult {
  readiness_score: number
  summary_stats: SummaryStats
  anomalies: Anomaly[]
  proposed_adjusting_entries: ProposedEntry[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i)

function formatFcfa(n: number) {
  return n.toLocaleString("fr-FR") + " FCFA"
}

function severityColor(s: Anomaly["severity"]) {
  if (s === "high")   return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800"
  if (s === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800"
  return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800"
}

function severityLabel(s: Anomaly["severity"]) {
  if (s === "high")   return "Critique"
  if (s === "medium") return "Modéré"
  return "Faible"
}

function categoryIcon(cat: ProposedEntry["category"]) {
  if (cat === "depreciation") return <ArrowDownUp className="h-4 w-4 text-violet-600" />
  if (cat === "provision")    return <ShieldAlert className="h-4 w-4 text-amber-600" />
  if (cat === "cutoff")       return <Clock className="h-4 w-4 text-blue-600" />
  return <BookOpen className="h-4 w-4 text-muted-foreground" />
}

function categoryLabel(cat: ProposedEntry["category"]) {
  if (cat === "depreciation") return "Amortissement"
  if (cat === "provision")    return "Provision"
  if (cat === "cutoff")       return "Régularisation (CCA)"
  return "Divers"
}

// ---------------------------------------------------------------------------
// Circular readiness gauge
// ---------------------------------------------------------------------------

function ReadinessGauge({ score }: { score: number }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444"
  const label = score >= 80 ? "Prêt" : score >= 60 ? "À réviser" : "Risqué"

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="140" height="140" viewBox="0 0 140 140" className="block">
        <circle cx="70" cy="70" r={r} fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="13" />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={color} strokeWidth="13" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
        <text x="70" y="64" textAnchor="middle" fontSize="26" fontWeight="700" fill={color}>{score}</text>
        <text x="70" y="82" textAnchor="middle" fontSize="11" fill="#9ca3af">/100</text>
      </svg>
      <span className="text-sm font-semibold" style={{ color }}>{label}</span>
      <p className="text-xs text-muted-foreground text-center max-w-[140px]">Score de préparation à la clôture</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary KPI cards
// ---------------------------------------------------------------------------

function KpiCard({ label, value, trend }: { label: string; value: string; trend?: "up" | "down" | "neutral" }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold mt-0.5 break-all">{value}</p>
        {trend === "up"   && <TrendingUp   className="h-4 w-4 text-green-500 mt-1" />}
        {trend === "down" && <TrendingDown  className="h-4 w-4 text-red-500 mt-1" />}
        {trend === "neutral" && <Minus className="h-4 w-4 text-muted-foreground mt-1" />}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Proposed entry card
// ---------------------------------------------------------------------------

function EntryCard({
  entry,
  clientId,
  year,
  onPosted,
}: {
  entry: ProposedEntry
  clientId: number
  year: number
  onPosted: (id: string) => void
}) {
  const { toast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [posting, setPosting] = useState(false)

  const totalDebit  = entry.lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = entry.lines.reduce((s, l) => s + l.credit, 0)

  async function handlePost() {
    setPosting(true)
    setConfirmOpen(false)
    try {
      const base  = getApiBase()
      const token = getToken()
      const res = await fetch(`${base}/api/audit/year-end-review/post-entry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clientId, year, entry }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? "Erreur lors de la comptabilisation.")
      }
      toast({ title: "Écriture comptabilisée", description: `${entry.label} → Journal OD (statut : à valider)` })
      onPosted(entry.id)
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur inconnue.", variant: "destructive" })
    } finally {
      setPosting(false)
    }
  }

  return (
    <Card className={cn("shadow-sm border transition-colors", entry._posted ? "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10" : "")}>
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2">
            {categoryIcon(entry.category)}
            <div>
              <CardTitle className="text-sm font-semibold leading-snug">{entry.label}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{categoryLabel(entry.category)} · Journal {entry.journal_code}</p>
            </div>
          </div>
          {entry._posted ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 shrink-0">
              <CheckCircle2 className="h-3 w-3 mr-1" />Comptabilisé
            </Badge>
          ) : (
            <Button
              size="sm"
              className="shrink-0 bg-primary hover:bg-primary/90"
              onClick={() => setConfirmOpen(true)}
              disabled={posting}
            >
              {posting ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Comptabilisation…</> : "Valider & Comptabiliser"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4 space-y-3">
        <p className="text-xs text-muted-foreground italic leading-relaxed">{entry.justification}</p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="py-2 pl-3">Compte</TableHead>
                <TableHead className="py-2">Intitulé</TableHead>
                <TableHead className="py-2 text-right">Débit</TableHead>
                <TableHead className="py-2 pr-3 text-right">Crédit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((l, i) => (
                <TableRow key={i} className="text-xs">
                  <TableCell className="py-1.5 pl-3 font-mono font-semibold">{l.account_code}</TableCell>
                  <TableCell className="py-1.5 text-muted-foreground">{l.account_label}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">{l.debit > 0 ? formatFcfa(l.debit) : "—"}</TableCell>
                  <TableCell className="py-1.5 pr-3 text-right tabular-nums">{l.credit > 0 ? formatFcfa(l.credit) : "—"}</TableCell>
                </TableRow>
              ))}
              <TableRow className="text-xs font-semibold bg-muted/30">
                <TableCell colSpan={2} className="py-1.5 pl-3 text-muted-foreground">Total</TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">{formatFcfa(totalDebit)}</TableCell>
                <TableCell className="py-1.5 pr-3 text-right tabular-nums">{formatFcfa(totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Valider & Comptabiliser cette écriture ?</AlertDialogTitle>
            <AlertDialogDescription>
              L'écriture <strong>{entry.label}</strong> sera enregistrée dans le Journal OD au 31/12/{year} avec le statut <em>"À valider"</em>. Vous pourrez la vérifier et la valider définitivement depuis la page de saisie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handlePost}>Oui, comptabiliser</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function YearEndReview() {
  const { user } = useAuth()
  const { toast } = useToast()

  // Detect clientId from URL
  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/examen")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [year, setYear]             = useState(CURRENT_YEAR - 1)
  const [isLoading, setIsLoading]   = useState(false)
  const [result, setResult]         = useState<ReviewResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [entries, setEntries]       = useState<ProposedEntry[]>([])

  const canRun = user?.role === "expert_comptable" || user?.role === "collaborateur"

  async function runAnalysis() {
    if (!clientId) return
    setIsLoading(true)
    setError(null)
    setResult(null)
    try {
      const base  = getApiBase()
      const token = getToken()
      const res = await fetch(`${base}/api/audit/year-end-review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clientId, year }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? "Erreur lors de l'analyse.")
      }
      const data = await res.json() as ReviewResult
      setResult(data)
      setEntries((data.proposed_adjusting_entries ?? []).map(e => ({ ...e, _posted: false, _posting: false })))
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue."
      setError(msg)
      toast({ title: "Analyse échouée", description: msg, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  function markPosted(id: string) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, _posted: true } : e))
  }

  // Partition entries by category for the tabs
  const deprecEntries   = entries.filter(e => e.category === "depreciation")
  const provisionEntries = entries.filter(e => e.category === "provision")
  const cutoffEntries   = entries.filter(e => e.category === "cutoff")
  const otherEntries    = entries.filter(e => e.category === "other")

  const highAnomalies   = (result?.anomalies ?? []).filter(a => a.severity === "high")
  const mediumAnomalies = (result?.anomalies ?? []).filter(a => a.severity === "medium")
  const lowAnomalies    = (result?.anomalies ?? []).filter(a => a.severity === "low")

  return (
    <div className="space-y-6">
      {/* ── Accounting nav ── */}
      <ClientAccountingNav activeTab="examen" />

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-primary shrink-0" />
            <h1 className="text-2xl font-bold tracking-tight">Examen de Fin d'Exercice</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Audit IA complet selon SYSCOHADA Révisé · Détection d'anomalies · Écritures de régularisation
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={String(year)} onValueChange={v => { setYear(Number(v)); setResult(null); setError(null) }}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map(y => (
                <SelectItem key={y} value={String(y)}>Exercice {y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={runAnalysis}
            disabled={isLoading || !clientId || !canRun}
            className="gap-2"
          >
            {isLoading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Analyse en cours…</>
              : <><RefreshCw className="h-4 w-4" />{result ? "Relancer" : "Lancer l'analyse"}</>
            }
          </Button>
        </div>
      </div>

      {/* ── Role notice ── */}
      {!canRun && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Accès restreint</AlertTitle>
          <AlertDescription>Seuls les rôles Expert-Comptable et Collaborateur peuvent lancer l'examen de fin d'exercice.</AlertDescription>
        </Alert>
      )}

      {/* ── No client selected ── */}
      {!clientId && (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
            <ReceiptText className="h-12 w-12 opacity-20" />
            <div>
              <p className="font-medium">Sélectionnez un dossier client</p>
              <p className="text-sm mt-1">Choisissez un client dans la barre de navigation ci-dessus pour lancer l'analyse.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Error ── */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Erreur d'analyse</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Loading skeleton ── */}
      {isLoading && (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-semibold text-foreground">Analyse en cours…</p>
              <p className="text-sm mt-1">L'IA examine les journaux, les balances et les immobilisations.</p>
              <p className="text-xs mt-1 opacity-70">Cela prend généralement 15 à 30 secondes.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Results ── */}
      {result && !isLoading && (
        <div className="space-y-6">
          {/* Cockpit banner */}
          <Card className="shadow-sm border-primary/20 bg-gradient-to-br from-primary/5 to-background">
            <CardContent className="pt-6 pb-6">
              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* Gauge */}
                <div className="shrink-0">
                  <ReadinessGauge score={result.readiness_score} />
                </div>

                <Separator orientation="vertical" className="hidden sm:block h-32" />

                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
                  <KpiCard
                    label="Chiffre d'affaires"
                    value={formatFcfa(result.summary_stats.total_revenue)}
                    trend={result.summary_stats.total_revenue > 0 ? "up" : "neutral"}
                  />
                  <KpiCard
                    label="Charges totales"
                    value={formatFcfa(result.summary_stats.total_expenses)}
                    trend="neutral"
                  />
                  <KpiCard
                    label="Résultat net"
                    value={formatFcfa(result.summary_stats.net_income)}
                    trend={result.summary_stats.net_income > 0 ? "up" : "down"}
                  />
                  <KpiCard
                    label="Risques détectés"
                    value={String(result.summary_stats.flagged_risks_count)}
                    trend={result.summary_stats.flagged_risks_count === 0 ? "up" : result.summary_stats.flagged_risks_count > 5 ? "down" : "neutral"}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main tabs */}
          <Tabs defaultValue="anomalies">
            <TabsList className="flex-wrap h-auto mb-2">
              <TabsTrigger value="anomalies" className="gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Anomalies Détectées
                {result.anomalies.length > 0 && (
                  <span className={cn("ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                    highAnomalies.length > 0 ? "bg-red-500 text-white" : "bg-amber-500 text-white"
                  )}>
                    {result.anomalies.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="provisions" className="gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                Provisions &amp; Créances
                {(provisionEntries.length > 0) && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{provisionEntries.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="cutoff" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Régularisations (Cut-off)
                {(cutoffEntries.length > 0) && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">{cutoffEntries.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="depreciation" className="gap-1.5">
                <ArrowDownUp className="h-3.5 w-3.5" />
                Amortissements
                {(deprecEntries.length > 0) && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">{deprecEntries.length}</span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── Tab: Anomalies ── */}
            <TabsContent value="anomalies" className="space-y-3 mt-2">
              {result.anomalies.length === 0 ? (
                <Card className="shadow-sm">
                  <CardContent className="flex items-center gap-3 py-10 justify-center text-green-600">
                    <CheckCircle2 className="h-8 w-8" />
                    <div>
                      <p className="font-semibold">Aucune anomalie détectée</p>
                      <p className="text-sm text-muted-foreground">Les journaux de l'exercice {year} sont conformes aux normes SYSCOHADA.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Severity summary */}
                  <div className="flex flex-wrap gap-2 text-sm">
                    {highAnomalies.length > 0   && <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200">{highAnomalies.length} critique{highAnomalies.length > 1 ? "s" : ""}</Badge>}
                    {mediumAnomalies.length > 0  && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200">{mediumAnomalies.length} modéré{mediumAnomalies.length > 1 ? "s" : ""}</Badge>}
                    {lowAnomalies.length > 0     && <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200">{lowAnomalies.length} faible{lowAnomalies.length > 1 ? "s" : ""}</Badge>}
                  </div>

                  {/* Anomaly cards */}
                  {result.anomalies.map(anomaly => (
                    <Card key={anomaly.id} className={cn("shadow-sm border", severityColor(anomaly.severity))}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start gap-3 flex-wrap">
                          <div className="shrink-0 mt-0.5">
                            {anomaly.severity === "high"   && <AlertTriangle className="h-5 w-5 text-red-600" />}
                            {anomaly.severity === "medium" && <AlertTriangle className="h-5 w-5 text-amber-600" />}
                            {anomaly.severity === "low"    && <Info className="h-5 w-5 text-blue-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge variant="outline" className={cn("text-xs border-transparent", severityColor(anomaly.severity))}>
                                {severityLabel(anomaly.severity)}
                              </Badge>
                              {anomaly.account_code && (
                                <span className="font-mono text-xs font-semibold opacity-80">{anomaly.account_code}</span>
                              )}
                              <span className="text-xs text-muted-foreground opacity-70">{anomaly.id}</span>
                            </div>
                            <p className="text-sm font-medium leading-snug">{anomaly.description}</p>
                            <div className="flex items-start gap-1.5 mt-2">
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-60" />
                              <p className="text-xs opacity-80">{anomaly.recommendation}</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </TabsContent>

            {/* ── Tab: Provisions & Créances ── */}
            <TabsContent value="provisions" className="space-y-3 mt-2">
              {provisionEntries.length === 0 ? (
                <Card className="shadow-sm">
                  <CardContent className="flex items-center gap-3 py-10 justify-center text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 opacity-40" />
                    <div>
                      <p className="font-semibold">Aucune provision suggérée</p>
                      <p className="text-sm">Aucune créance douteuse détectée pour l'exercice {year}.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-amber-800 dark:text-amber-300">Provisions pour créances douteuses (Classe 4)</AlertTitle>
                    <AlertDescription className="text-amber-700 dark:text-amber-400">
                      Les écritures ci-dessous correspondent à des créances 411xxx en retard &gt;180 jours.
                      Débit 685100 / Crédit 491100 selon SYSCOHADA Révisé.
                    </AlertDescription>
                  </Alert>
                  {provisionEntries.map(e => (
                    <EntryCard key={e.id} entry={e} clientId={clientId!} year={year} onPosted={markPosted} />
                  ))}
                </>
              )}
            </TabsContent>

            {/* ── Tab: Régularisations Cut-off ── */}
            <TabsContent value="cutoff" className="space-y-3 mt-2">
              {cutoffEntries.length === 0 && otherEntries.length === 0 ? (
                <Card className="shadow-sm">
                  <CardContent className="flex items-center gap-3 py-10 justify-center text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 opacity-40" />
                    <div>
                      <p className="font-semibold">Aucune régularisation cut-off suggérée</p>
                      <p className="text-sm">Aucune charge constatée d'avance (CCA) ou produit constaté d'avance (PCA) détecté.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {cutoffEntries.length > 0 && (
                    <>
                      <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/10">
                        <Clock className="h-4 w-4 text-blue-600" />
                        <AlertTitle className="text-blue-800 dark:text-blue-300">Charges Constatées d'Avance (CCA) — Compte 476100</AlertTitle>
                        <AlertDescription className="text-blue-700 dark:text-blue-400">
                          Ces écritures régularisent les charges à cheval sur deux exercices (loyers, assurances, etc.).
                        </AlertDescription>
                      </Alert>
                      {cutoffEntries.map(e => (
                        <EntryCard key={e.id} entry={e} clientId={clientId!} year={year} onPosted={markPosted} />
                      ))}
                    </>
                  )}
                  {otherEntries.map(e => (
                    <EntryCard key={e.id} entry={e} clientId={clientId!} year={year} onPosted={markPosted} />
                  ))}
                </>
              )}
            </TabsContent>

            {/* ── Tab: Amortissements ── */}
            <TabsContent value="depreciation" className="space-y-3 mt-2">
              {deprecEntries.length === 0 ? (
                <Card className="shadow-sm">
                  <CardContent className="flex items-center gap-3 py-10 justify-center text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 opacity-40" />
                    <div>
                      <p className="font-semibold">Aucun amortissement suggéré</p>
                      <p className="text-sm">Aucune immobilisation active à amortir pour l'exercice {year}, ou tous les amortissements sont déjà enregistrés.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Alert className="border-violet-200 bg-violet-50 dark:border-violet-800/40 dark:bg-violet-900/10">
                    <ArrowDownUp className="h-4 w-4 text-violet-600" />
                    <AlertTitle className="text-violet-800 dark:text-violet-300">Dotations aux Amortissements — Méthode Linéaire SYSCOHADA</AlertTitle>
                    <AlertDescription className="text-violet-700 dark:text-violet-400">
                      Débit 681200 (Dotations aux amortissements) / Crédit 28xxxx. Prorata temporis appliqué pour l'année d'acquisition.
                    </AlertDescription>
                  </Alert>
                  {deprecEntries.map(e => (
                    <EntryCard key={e.id} entry={e} clientId={clientId!} year={year} onPosted={markPosted} />
                  ))}
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* ── Initial state (no result yet) ── */}
      {!result && !isLoading && !error && clientId && (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-4">
            <BrainCircuit className="h-14 w-14 opacity-20" />
            <div>
              <p className="font-semibold text-foreground">Cockpit de Clôture — Exercice {year}</p>
              <p className="text-sm mt-1">
                Cliquez sur <strong>"Lancer l'analyse"</strong> pour démarrer l'examen IA complet de l'exercice.
              </p>
              <p className="text-xs mt-3 opacity-70">
                L'IA analysera les balances de comptes, les créances douteuses, les immobilisations
                et proposera des écritures de régularisation conformes à SYSCOHADA Révisé.
              </p>
            </div>
            {canRun && (
              <Button onClick={runAnalysis} className="gap-2 mt-2">
                <BrainCircuit className="h-4 w-4" />
                Lancer l'analyse IA
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
