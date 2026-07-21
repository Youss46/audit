/**
 * Widget Prévisionnel de Trésorerie (30/60 jours)
 *
 * Renders a Recharts AreaChart showing projected daily closing balance,
 * cumulative expected inflows (green) and outflows (red) over 30 or 60 days.
 * All amounts are in FCFA. Toggle between the two horizons is inline.
 */
import { useState } from "react"
import {
  useGetCashflowForecast,
  getGetCashflowForecastQueryKey,
} from "@workspace/api-client-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertTriangle,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFCFA(amount: number) {
  if (Math.abs(amount) >= 1_000_000)
    return (amount / 1_000_000).toFixed(1).replace(".", ",") + " M FCFA"
  if (Math.abs(amount) >= 1_000)
    return Math.round(amount / 1_000).toLocaleString("fr-FR") + " k FCFA"
  return amount.toLocaleString("fr-FR") + " FCFA"
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}

// Custom Recharts tooltip
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-card shadow-lg p-3 text-sm space-y-1 max-w-[220px]">
      <p className="font-semibold text-foreground mb-2">
        {label ? formatDateShort(label) : ""}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4">
          <span style={{ color: entry.color }} className="font-medium">
            {entry.name === "closingBalance"
              ? "Solde"
              : entry.name === "inflows"
              ? "Encaissements"
              : "Décaissements"}
          </span>
          <span className="font-mono text-xs">
            {entry.value.toLocaleString("fr-FR")}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Summary stat card ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold leading-tight">{formatFCFA(value)}</p>
    </div>
  )
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function CashflowForecastWidget({ clientId }: { clientId: number }) {
  const [horizon, setHorizon] = useState<30 | 60>(30)

  const params = { clientId, days: horizon }
  const {
    data: forecast,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetCashflowForecast(params, {
    query: {
      enabled: !!clientId,
      queryKey: getGetCashflowForecastQueryKey(params),
      staleTime: 5 * 60 * 1000,
    },
  })

  // Sample every Nth day to keep the X-axis readable
  const projections = forecast?.projections ?? []
  const samplingStep = horizon === 60 ? 3 : 2
  const chartData = projections
    .filter((_, i) => i % samplingStep === 0 || i === projections.length - 1)
    .map((p) => ({
      date: p.date,
      closingBalance: p.closingBalance,
      inflows: p.inflows,
      outflows: p.outflows,
    }))

  const minBalance = Math.min(...projections.map((p) => p.closingBalance))
  const goesNegative = minBalance < 0

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Prévisionnel de Trésorerie
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-52 text-muted-foreground animate-pulse">
          Calcul du prévisionnel en cours…
        </CardContent>
      </Card>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError || !forecast) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Prévisionnel de Trésorerie
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 text-destructive/60" />
          <p className="text-sm">
            {error instanceof Error ? error.message : "Impossible de calculer le prévisionnel."}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Réessayer
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Rendered ──────────────────────────────────────────────────────────────
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5 text-primary" />
            Prévisionnel de Trésorerie
          </CardTitle>
          <CardDescription className="mt-0.5">
            Projection sur les prochains {horizon} jours — flux entrants et sortants prévisionnels
          </CardDescription>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant={horizon === 30 ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setHorizon(30)}
          >
            30 j
          </Button>
          <Button
            variant={horizon === 60 ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setHorizon(60)}
          >
            60 j
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPI summary row */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Solde actuel"
            value={forecast.currentBalance}
            icon={<Wallet className="h-4 w-4 text-blue-500" />}
            color={forecast.currentBalance >= 0 ? "border-blue-200" : "border-destructive/50 bg-destructive/5"}
          />
          <StatCard
            label={`Encaissements (${horizon}j)`}
            value={forecast.totalExpectedInflows}
            icon={<ArrowUpCircle className="h-4 w-4 text-green-500" />}
            color="border-green-200"
          />
          <StatCard
            label={`Décaissements (${horizon}j)`}
            value={forecast.totalExpectedOutflows}
            icon={<ArrowDownCircle className="h-4 w-4 text-red-500" />}
            color="border-red-200"
          />
        </div>

        {/* Trésorerie nette finale */}
        {(() => {
          const netEnd = forecast.currentBalance + forecast.totalExpectedInflows - forecast.totalExpectedOutflows
          const trend = netEnd >= forecast.currentBalance
          return (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${trend ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"}`}>
              {trend
                ? <TrendingUp className="h-4 w-4 shrink-0" />
                : <TrendingDown className="h-4 w-4 shrink-0" />}
              <span>
                Trésorerie estimée dans {horizon} jours :{" "}
                <strong>{formatFCFA(netEnd)}</strong>
                {trend ? " (+)" : " (−)"}
              </span>
              {goesNegative && (
                <Badge variant="destructive" className="ml-auto shrink-0 text-xs">
                  Solde négatif détecté
                </Badge>
              )}
            </div>
          )
        })()}

        {/* Chart */}
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cfBalanceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="cfInflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cfOutflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v) =>
                  Math.abs(v) >= 1_000_000
                    ? (v / 1_000_000).toFixed(1) + "M"
                    : Math.abs(v) >= 1_000
                    ? Math.round(v / 1_000) + "k"
                    : String(v)
                }
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip content={<CustomTooltip />} />
              {/* Zero reference line */}
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              {/* Inflows */}
              <Area
                type="monotone"
                dataKey="inflows"
                stroke="#22c55e"
                strokeWidth={1.5}
                fill="url(#cfInflowGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              {/* Outflows */}
              <Area
                type="monotone"
                dataKey="outflows"
                stroke="#ef4444"
                strokeWidth={1.5}
                fill="url(#cfOutflowGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              {/* Balance — on top */}
              <Area
                type="monotone"
                dataKey="closingBalance"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#cfBalanceGrad)"
                dot={false}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
            Solde prévisionnel
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
            Encaissements attendus
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            Décaissements prévus
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
