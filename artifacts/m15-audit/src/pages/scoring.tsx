import { useEffect, useState } from "react"
import { useRoute, Link } from "wouter"
import {
  useGetClient,
  getGetClientQueryKey,
  useGetScoringDashboard,
  getGetScoringDashboardQueryKey,
  useSetValuation,
} from "@workspace/api-client-react"
import type { RiskCategory } from "@workspace/api-client-react"
import { getToken } from "@/lib/auth"
import {
  ChevronLeft,
  Loader2,
  AlertTriangle,
  Gauge,
  TrendingUp,
  Wallet,
  Scale,
  ShieldCheck,
  Download,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
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
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  RadarChart,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts"

// Module M27 — Scoring Financier & Évaluation d'Entreprise. Accessible at
// /cabinet/client/:clientId/scoring. Computes financial-health ratios and a
// Z-Score-based risk category live from the validated general ledger (see
// artifacts/api-server/src/lib/scoring-engine.ts), and lets the accountant
// run an interactive business-valuation scenario (Actif Net Réévalué vs.
// multiple de l'EBE) before exporting an executive-summary PDF.

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i)

const RISK_META: Record<RiskCategory, { label: string; badgeClass: string; color: string; gaugeValue: number }> = {
  FAIBLE_RISQUE: { label: "Risque Faible", badgeClass: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", color: "#16a34a", gaugeValue: 85 },
  RISQUE_MODERE: { label: "Risque Modéré", badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", color: "#d97706", gaugeValue: 50 },
  RISQUE_ELEVE: { label: "Risque Élevé", badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", color: "#dc2626", gaugeValue: 18 },
}

function formatFcfa(amount: number) {
  return amount.toLocaleString("fr-FR") + " FCFA"
}
function formatPct(value: number | null | undefined) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1).replace(".", ",")} %`
}
function formatRatio(value: number | null | undefined) {
  return value == null ? "n/a" : value.toFixed(2).replace(".", ",")
}

async function downloadScoringPdf(clientId: number, year: number): Promise<void> {
  const token = getToken()
  const params = new URLSearchParams({ clientId: String(clientId), year: String(year) })
  const response = await fetch(`/api/analytics/exports/scoring?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      (errorData as { error?: string }).error ?? "Erreur lors de la génération de la synthèse exécutive.",
    )
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const disposition = response.headers.get("content-disposition")
  const match = disposition?.match(/filename="([^"]+)"/)
  a.download = match?.[1] ?? `Scoring_Evaluation_${year}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function RiskGauge({ riskCategory, zScore }: { riskCategory: RiskCategory; zScore: number }) {
  const meta = RISK_META[riskCategory]
  const data = [{ name: "risque", value: meta.gaugeValue, fill: meta.color }]
  return (
    <div className="relative flex flex-col items-center">
      <ResponsiveContainer width="100%" height={180}>
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={data}
          startAngle={210}
          endAngle={-30}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={12} background={{ fill: "hsl(var(--muted))" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute top-[58%] flex -translate-y-1/2 flex-col items-center">
        <span className="text-3xl font-bold" style={{ color: meta.color }}>{zScore.toFixed(2)}</span>
        <span className="text-xs text-muted-foreground">Z-Score</span>
      </div>
      <Badge className={cn("mt-1 border-transparent", meta.badgeClass)} data-testid="badge-risk-category">
        {meta.label}
      </Badge>
    </div>
  )
}

function RatioCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <div className="rounded-full bg-primary/10 p-2 text-primary">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xl font-bold tabular-nums">{value}</p>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Scoring() {
  const { toast } = useToast()
  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/scoring")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [downloading, setDownloading] = useState(false)
  const [ebitdaMultiplier, setEbitdaMultiplier] = useState(6)
  const [capitalizationRatePct, setCapitalizationRatePct] = useState(10)
  const [comments, setComments] = useState("")

  const { data: client } = useGetClient(clientId ?? 0, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId ?? 0) },
  })

  const {
    data: dashboard,
    isLoading,
    isError,
    error,
  } = useGetScoringDashboard(clientId ?? 0, selectedYear, {
    query: { enabled: !!clientId, queryKey: getGetScoringDashboardQueryKey(clientId ?? 0, selectedYear) },
  })

  const setValuation = useSetValuation()

  // Sync the slider/comment state whenever a fresh scenario loads (new
  // client, new year, or after the accountant saves) — never fights with
  // in-progress edits because it only runs when the fetched values change.
  useEffect(() => {
    if (dashboard?.valuation) {
      setEbitdaMultiplier(dashboard.valuation.ebitdaMultiplierUsed)
      setCapitalizationRatePct(Math.round(dashboard.valuation.capitalizationRateUsed * 1000) / 10)
      setComments(dashboard.valuation.customComments ?? "")
    }
  }, [dashboard?.valuation])

  async function handleSaveValuation() {
    if (!clientId) return
    try {
      await setValuation.mutateAsync({
        clientId,
        year: selectedYear,
        data: {
          ebitdaMultiplier,
          capitalizationRate: capitalizationRatePct / 100,
          customComments: comments.trim() ? comments.trim() : null,
        },
      })
      toast({ title: "Scénario d'évaluation enregistré", description: `Exercice ${selectedYear}.` })
    } catch (err) {
      toast({
        title: "Échec de l'enregistrement",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      })
    }
  }

  async function handleDownload() {
    if (!clientId) return
    setDownloading(true)
    try {
      await downloadScoringPdf(clientId, selectedYear)
      toast({ title: "Synthèse exécutive téléchargée", description: `Exercice ${selectedYear}.` })
    } catch (err) {
      toast({
        title: "Échec du téléchargement",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      })
    } finally {
      setDownloading(false)
    }
  }

  if (!clientId) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Client introuvable.</p>
      </div>
    )
  }

  // Radar chart: normalize each ratio to a 0-100 "health" scale so wildly
  // different units (percentages, multiples) can share one visual — targets
  // chosen as accountant-recognizable "good" benchmarks (ROE 15%, Current
  // Ratio 1.5x, D/E ≤ 1x -> 100 pts, Solvency 30%).
  const radarData = dashboard
    ? [
        { metric: "Rentabilité (ROE)", value: dashboard.ratios.returnOnEquity == null ? 0 : Math.min(100, Math.max(0, (dashboard.ratios.returnOnEquity / 0.15) * 100)) },
        { metric: "Liquidité", value: dashboard.ratios.currentRatio == null ? 0 : Math.min(100, Math.max(0, (dashboard.ratios.currentRatio / 1.5) * 100)) },
        { metric: "Endettement maîtrisé", value: dashboard.ratios.debtToEquity == null ? 100 : Math.min(100, Math.max(0, (1 - dashboard.ratios.debtToEquity) * 100 + 50)) },
        { metric: "Autonomie financière", value: dashboard.ratios.solvencyRatio == null ? 0 : Math.min(100, Math.max(0, (dashboard.ratios.solvencyRatio / 0.3) * 100)) },
      ]
    : []

  const valuation = dashboard?.valuation
  const previewValuation = dashboard
    ? {
        equityValue: dashboard.metrics.totalEquity,
        ebitdaMultiplierValue: Math.round(dashboard.metrics.ebitda * ebitdaMultiplier),
        capitalizedEarningsValue:
          capitalizationRatePct > 0 ? Math.round(dashboard.metrics.netIncome / (capitalizationRatePct / 100)) : 0,
      }
    : null

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card px-6 py-3">
        <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Retour au cabinet
        </Link>
      </div>

      <ClientAccountingNav activeTab="scoring" />

      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tableau de Bord Diagnostic &amp; Évaluation</h1>
            <p className="text-sm text-muted-foreground">
              Scoring financier et valorisation de {client?.name ?? "…"}, calculés en direct à partir du grand livre validé.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-32" data-testid="select-scoring-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleDownload} disabled={downloading || !dashboard} data-testid="button-export-scoring">
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Exporter (PDF)
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Erreur</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Impossible de calculer le scoring financier."}
            </AlertDescription>
          </Alert>
        )}

        {dashboard && (
          <>
            {/* ---- Risk diagnostic ---- */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="h-5 w-5 text-primary" />
                  Diagnostic de Risque Financier — Exercice {selectedYear}
                </CardTitle>
                <CardDescription>
                  Score de solidité financière (adaptation du modèle Altman Z-Score aux PME africaines).
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <RiskGauge riskCategory={dashboard.riskCategory} zScore={dashboard.zScore} />
                <div className="flex flex-col justify-center gap-2">
                  <p className="text-sm leading-relaxed text-foreground" data-testid="text-risk-explanation">
                    {dashboard.riskExplanationFr}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* ---- Ratio cards + radar ---- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
                <RatioCard
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Rentabilité des capitaux propres (ROE)"
                  value={formatPct(dashboard.ratios.returnOnEquity)}
                  hint="Résultat net / Capitaux propres"
                />
                <RatioCard
                  icon={<Wallet className="h-4 w-4" />}
                  label="Ratio de liquidité générale"
                  value={formatRatio(dashboard.ratios.currentRatio)}
                  hint="Actif circulant / Passif circulant"
                />
                <RatioCard
                  icon={<Scale className="h-4 w-4" />}
                  label="Ratio d'endettement"
                  value={formatRatio(dashboard.ratios.debtToEquity)}
                  hint="Dettes totales / Capitaux propres"
                />
                <RatioCard
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Autonomie financière"
                  value={formatPct(dashboard.ratios.solvencyRatio)}
                  hint="Capitaux propres / Total bilan"
                />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Profil de Solidité</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <RadarChart data={radarData} outerRadius="75%">
                      <PolarGrid />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9 }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.35} />
                    </RadarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RatioCard
                icon={<Sparkles className="h-4 w-4" />}
                label="Besoin en Fonds de Roulement (BFR / FRNG)"
                value={formatFcfa(dashboard.ratios.netWorkingCapital)}
                hint="Actif circulant - Passif circulant"
              />
              <RatioCard
                icon={<Sparkles className="h-4 w-4" />}
                label="Chiffre d'affaires"
                value={formatFcfa(dashboard.metrics.sales)}
                hint="Ventes de marchandises + produits fabriqués"
              />
            </div>

            {/* ---- Valuation workbench ---- */}
            <Card>
              <CardHeader>
                <CardTitle>Évaluation d'Entreprise</CardTitle>
                <CardDescription>
                  Ajustez les hypothèses ci-dessous pour simuler la valorisation, puis enregistrez le scénario retenu.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Multiple de l'EBE (EBITDA)</span>
                      <span className="font-mono font-semibold" data-testid="text-ebitda-multiplier">{ebitdaMultiplier.toFixed(1)}x</span>
                    </div>
                    <Slider
                      value={[ebitdaMultiplier]}
                      onValueChange={([v]) => setEbitdaMultiplier(v)}
                      min={3}
                      max={10}
                      step={0.5}
                      data-testid="slider-ebitda-multiplier"
                    />
                    <p className="text-xs text-muted-foreground">Fourchette sectorielle usuelle pour les PME : 3x à 10x l'EBE.</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Taux de capitalisation</span>
                      <span className="font-mono font-semibold" data-testid="text-capitalization-rate">{capitalizationRatePct.toFixed(1)} %</span>
                    </div>
                    <Slider
                      value={[capitalizationRatePct]}
                      onValueChange={([v]) => setCapitalizationRatePct(v)}
                      min={5}
                      max={25}
                      step={0.5}
                      data-testid="slider-capitalization-rate"
                    />
                    <p className="text-xs text-muted-foreground">Taux utilisé pour la capitalisation du résultat net (vue complémentaire).</p>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Approche</TableHead>
                      <TableHead>Détail</TableHead>
                      <TableHead className="text-right">Valeur estimée</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Approche Patrimoniale</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Actif Net Réévalué (Capitaux propres)</TableCell>
                      <TableCell className="text-right font-mono font-semibold" data-testid="text-valuation-equity">
                        {formatFcfa(previewValuation?.equityValue ?? 0)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Approche Comparative</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Multiple de l'EBE — {ebitdaMultiplier.toFixed(1)}x</TableCell>
                      <TableCell className="text-right font-mono font-semibold" data-testid="text-valuation-ebitda">
                        {formatFcfa(previewValuation?.ebitdaMultiplierValue ?? 0)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Capitalisation du Résultat</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Taux de capitalisation — {capitalizationRatePct.toFixed(1)} %</TableCell>
                      <TableCell className="text-right font-mono font-semibold" data-testid="text-valuation-capitalized">
                        {formatFcfa(previewValuation?.capitalizedEarningsValue ?? 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="valuation-comments">Commentaire de l'expert-comptable</label>
                  <Textarea
                    id="valuation-comments"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Ex. : valorisation prudente compte tenu du contexte sectoriel..."
                    rows={3}
                    data-testid="textarea-valuation-comments"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Dernière sauvegarde : {valuation?.updatedAt ? new Date(valuation.updatedAt).toLocaleString("fr-FR") : "—"}
                  </p>
                  <Button onClick={handleSaveValuation} disabled={setValuation.isPending} data-testid="button-save-valuation">
                    {setValuation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Enregistrer le scénario
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
