import { useMemo, useState } from "react"
import { useRoute } from "wouter"
import { useGetPilotageDashboard, getGetPilotageDashboardQueryKey } from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { formatFcfa } from "@/lib/status"
import { cn } from "@/lib/utils"
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PieChart as PieChartIcon,
  Minus,
  AlertTriangle,
  Percent,
  Scale,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts"

function buildYearOptions() {
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = currentYear; y >= currentYear - 4; y--) years.push(y)
  return years
}

const MOIS_OPTIONS = [
  { value: 1, label: "Janvier" },
  { value: 2, label: "Février" },
  { value: 3, label: "Mars" },
  { value: 4, label: "Avril" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juin" },
  { value: 7, label: "Juillet" },
  { value: 8, label: "Août" },
  { value: 9, label: "Septembre" },
  { value: 10, label: "Octobre" },
  { value: 11, label: "Novembre" },
  { value: 12, label: "Décembre" },
]

const PIE_COLORS = ["#2563eb", "#0891b2", "#7c3aed", "#d97706", "#dc2626", "#059669", "#4f46e5", "#db2777"]

function VariationBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> vs mois précédent : n/a
      </span>
    )
  }
  const isUp = pct > 0
  const isFlat = Math.abs(pct) < 0.05
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isFlat ? "text-muted-foreground" : isUp ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
      )}
    >
      {isFlat ? <Minus className="h-3 w-3" /> : isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isFlat ? "stable" : `${isUp ? "+" : ""}${pct.toFixed(1)}%`} vs mois précédent
    </span>
  )
}

// Module P4/M21 (Tableau de Bord Dirigeant): the PME director's own
// executive dashboard -- plain business French, no accounting jargon (no
// "débit/crédit" anywhere here). Answers "Combien je gagne ?", "Est-ce que
// je gagne assez ?", "Combien j'ai en caisse ?" et "Où part mon argent ?".
//
// Reused at two URLs:
//   /pilotage                              -- the PME director's own view
//   /cabinet/client/:clientId/pilotage     -- read-only monitoring by the cabinet
export default function Pilotage() {
  const { user } = useAuth()
  const [, cabinetParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/pilotage")
  const isCabinetView = !!cabinetParams
  const clientId = isCabinetView ? Number(cabinetParams!.clientId) : (user?.clientId ?? 0)

  const yearOptions = useMemo(() => buildYearOptions(), [])
  const [year, setYear] = useState(yearOptions[0] ?? new Date().getFullYear())
  const [basis, setBasis] = useState<"engagement" | "tresorerie">("engagement")
  // undefined = "Mois en cours (auto)" -- the backend then falls back to the
  // most recent month with any booked activity in the selected year.
  const [month, setMonth] = useState<number | undefined>(undefined)

  const { data, isLoading } = useGetPilotageDashboard(
    { clientId, year, basis, month },
    {
      query: {
        enabled: !!clientId,
        queryKey: getGetPilotageDashboardQueryKey({ clientId, year, basis, month }),
      },
    },
  )

  const revenueVsChargesData = useMemo(() => {
    const chargesByKey = new Map((data?.chargesParMois ?? []).map((p) => [`${p.year}-${p.month}`, p.total]))
    return (data?.chiffreAffairesParMois ?? []).map((point) => ({
      label: point.label,
      "Chiffre d'affaires": point.total,
      "Charges d'exploitation": chargesByKey.get(`${point.year}-${point.month}`) ?? 0,
    }))
  }, [data])

  const periodeLabel = month != null ? MOIS_OPTIONS.find((m) => m.value === month)?.label ?? "" : null

  const tresorerieChartData = (data?.tresorerieParMois ?? []).map((point) => ({
    label: point.label,
    total: point.total,
  }))

  const expenseChartData = (data?.depensesParNature ?? []).map((entry) => ({
    name: entry.label,
    value: entry.total,
  }))

  const dashboard = (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isCabinetView ? "Tableau de bord dirigeant" : "Pilotage"}
          </h1>
          <p className="text-muted-foreground mt-2">
            Vue simple et claire de la santé financière {isCabinetView ? "du client" : "de votre entreprise"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="basis-toggle" className="text-sm text-muted-foreground whitespace-nowrap">
              Trésorerie (encaissements réels)
            </Label>
            <Switch
              id="basis-toggle"
              data-testid="switch-basis-tresorerie"
              checked={basis === "tresorerie"}
              onCheckedChange={(checked) => setBasis(checked ? "tresorerie" : "engagement")}
            />
          </div>
          <Select
            value={month != null ? String(month) : "auto"}
            onValueChange={(v) => setMonth(v === "auto" ? undefined : parseInt(v))}
          >
            <SelectTrigger className="w-[180px]" data-testid="select-pilotage-month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Mois en cours</SelectItem>
              {MOIS_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-[160px]" data-testid="select-pilotage-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  Année {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {basis === "tresorerie" && (
        <Alert data-testid="banner-basis-tresorerie">
          <Scale className="h-4 w-4" />
          <AlertTitle>Vue en comptabilité de trésorerie</AlertTitle>
          <AlertDescription>
            Les ventes et achats à crédit ne sont comptés qu'une fois réellement encaissés ou payés. Les opérations à
            crédit non encore réglées n'apparaissent pas dans ce tableau tant qu'elles ne sont pas soldées.
          </AlertDescription>
        </Alert>
      )}

      {isLoading || !data ? (
        <div className="h-[50vh] flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
            Chargement de votre tableau de pilotage...
          </div>
        </div>
      ) : (
        <>
          {/* ---- KPI card grid ---- */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="shadow-sm" data-testid="card-kpi-ca">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                    <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Chiffre d'affaires {periodeLabel ? `de ${periodeLabel}` : "du mois"}
                  </p>
                </div>
                <p className="text-2xl font-bold">{formatFcfa(data.kpis.chiffreAffaires.moisCourant)}</p>
                <div className="mt-2">
                  <VariationBadge pct={data.kpis.chiffreAffaires.variationPct} />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm" data-testid="card-kpi-marge">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                    <Percent className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Marge brute {periodeLabel ? `de ${periodeLabel}` : "du mois"}
                  </p>
                </div>
                <p className="text-2xl font-bold">{formatFcfa(data.kpis.margeBrute.moisCourant)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Taux de marge :{" "}
                  {data.kpis.margeBrute.tauxMargeMoisCourant != null
                    ? `${data.kpis.margeBrute.tauxMargeMoisCourant.toFixed(1)}%`
                    : "—"}
                </p>
                <div className="mt-2">
                  <VariationBadge pct={data.kpis.margeBrute.variationPct} />
                </div>
              </CardContent>
            </Card>

            <Card
              className={cn("shadow-sm", data.kpis.tresorerie.enAlerte && "border-destructive/60")}
              data-testid="card-kpi-tresorerie"
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center shrink-0",
                      data.kpis.tresorerie.enAlerte ? "bg-destructive/10" : "bg-emerald-100 dark:bg-emerald-900/30",
                    )}
                  >
                    <Wallet
                      className={cn(
                        "h-5 w-5",
                        data.kpis.tresorerie.enAlerte ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                      )}
                    />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Trésorerie disponible</p>
                </div>
                <p className={cn("text-2xl font-bold", data.tresorerieNette < 0 && "text-destructive")}>
                  {formatFcfa(data.tresorerieNette)}
                </p>
                <div className="mt-2">
                  <VariationBadge pct={data.kpis.tresorerie.variationPct} />
                </div>
                {data.kpis.tresorerie.enAlerte && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive" data-testid="warning-tresorerie-critique">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Sous le seuil critique ({formatFcfa(data.kpis.tresorerie.seuilCritique)}, soit ~1 mois de charges)
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---- Seuil de rentabilité ---- */}
          <Card className="shadow-sm border-l-4 border-l-amber-500" data-testid="card-seuil-rentabilite">
            <CardContent className="flex flex-col gap-1 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Seuil de rentabilité prévisionnel (année {year})</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Chiffre d'affaires minimum à réaliser dans l'année pour couvrir toutes vos charges, fixes et
                  variables.
                </p>
              </div>
              <div className="text-2xl font-bold whitespace-nowrap">
                {data.seuilRentabilite.seuilRentabilite != null
                  ? formatFcfa(Math.round(data.seuilRentabilite.seuilRentabilite))
                  : "Non calculable"}
              </div>
            </CardContent>
          </Card>

          {/* ---- Charts ---- */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Chiffre d'Affaires vs Charges
                </CardTitle>
                <CardDescription>Vos ventes comparées à vos charges d'exploitation, mois par mois.</CardDescription>
              </CardHeader>
              <CardContent>
                {revenueVsChargesData.length === 0 ||
                revenueVsChargesData.every((d) => d["Chiffre d'affaires"] === 0 && d["Charges d'exploitation"] === 0) ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    Aucune opération validée pour l'année {year}.
                  </p>
                ) : (
                  <div className="h-[300px]" data-testid="chart-ca-vs-charges">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={revenueVsChargesData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                        <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                        />
                        <Tooltip formatter={(value: number) => formatFcfa(value)} labelClassName="font-medium" />
                        <Legend />
                        <Bar dataKey="Chiffre d'affaires" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Charges d'exploitation" fill="#dc2626" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Wallet className="h-5 w-5 text-primary" />
                  Évolution de la Trésorerie
                </CardTitle>
                <CardDescription>Solde caisses et comptes bancaires en fin de mois, pour l'année {year}.</CardDescription>
              </CardHeader>
              <CardContent>
                {tresorerieChartData.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    Aucun mouvement de trésorerie validé pour l'année {year}.
                  </p>
                ) : (
                  <div className="h-[300px]" data-testid="chart-tresorerie">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={tresorerieChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="tresorerieGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#059669" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                        <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                        />
                        <Tooltip formatter={(value: number) => formatFcfa(value)} labelClassName="font-medium" />
                        <Area
                          type="monotone"
                          dataKey="total"
                          name="Trésorerie"
                          stroke="#059669"
                          fill="url(#tresorerieGradient)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <PieChartIcon className="h-5 w-5 text-primary" />
                  Répartition des Charges par Nature
                </CardTitle>
                <CardDescription>
                  Achats, services extérieurs, personnel et impôts &amp; taxes, pour l'année {year}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {expenseChartData.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    Aucune charge enregistrée et validée pour l'année {year}.
                  </p>
                ) : (
                  <div className="h-[320px]" data-testid="chart-depenses-nature">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={expenseChartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={70}
                          outerRadius={110}
                          label={({ name, percent }) => `${name} (${Math.round((percent ?? 0) * 100)}%)`}
                        >
                          {expenseChartData.map((_, index) => (
                            <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatFcfa(value)} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )

  if (isCabinetView) {
    return (
      <div className="space-y-6">
        <ClientAccountingNav activeTab="pilotage" />
        {dashboard}
      </div>
    )
  }

  return dashboard
}
