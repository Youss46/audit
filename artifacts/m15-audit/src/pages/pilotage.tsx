import { useMemo, useState } from "react"
import { useGetPilotageDashboard, getGetPilotageDashboardQueryKey } from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { formatFcfa } from "@/lib/status"
import { Wallet, TrendingUp, PieChart as PieChartIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
} from "recharts"

function buildYearOptions() {
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = currentYear; y >= currentYear - 4; y--) years.push(y)
  return years
}

const PIE_COLORS = ["#2563eb", "#0891b2", "#7c3aed", "#d97706", "#dc2626", "#059669", "#4f46e5", "#db2777"]

// Module P4 (Pilotage Dirigeant): the PME director's own dashboard --
// plain business French, no accounting jargon (no "débit/crédit" anywhere
// here). It answers the three questions a boss actually asks: "Combien j'ai
// en caisse aujourd'hui ?", "Comment évolue mon chiffre d'affaires ?" et
// "Où part mon argent ?".
export default function Pilotage() {
  const { user } = useAuth()
  const clientId = user?.clientId ?? 0
  const yearOptions = useMemo(() => buildYearOptions(), [])
  const [year, setYear] = useState(yearOptions[0] ?? new Date().getFullYear())

  const { data, isLoading } = useGetPilotageDashboard(
    { clientId, year },
    {
      query: {
        enabled: !!clientId,
        queryKey: getGetPilotageDashboardQueryKey({ clientId, year }),
      },
    },
  )

  const revenueChartData = (data?.chiffreAffairesParMois ?? []).map((point) => ({
    label: point.label,
    total: point.total,
  }))

  const expenseChartData = (data?.topDepenses ?? []).map((entry) => ({
    name: entry.label,
    value: entry.total,
  }))

  if (isLoading || !data) {
    return (
      <div className="h-[50vh] flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
          Chargement de votre tableau de pilotage...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pilotage</h1>
          <p className="text-muted-foreground mt-2">
            Vue simple et claire de la santé financière de votre entreprise.
          </p>
        </div>
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

      <Card className="shadow-sm border-l-4 border-l-primary" data-testid="card-tresorerie-nette">
        <CardContent className="flex items-center justify-between py-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Argent disponible aujourd'hui</p>
              <p className="text-xs text-muted-foreground/70">Caisses et comptes bancaires réunis, à l'instant présent.</p>
            </div>
          </div>
          <div className={`text-3xl font-bold ${data.tresorerieNette >= 0 ? "text-foreground" : "text-destructive"}`}>
            {formatFcfa(data.tresorerieNette)}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-primary" />
              Évolution du Chiffre d'Affaires
            </CardTitle>
            <CardDescription>Vos ventes, mois par mois, pour l'année {year}.</CardDescription>
          </CardHeader>
          <CardContent>
            {revenueChartData.length === 0 || revenueChartData.every((d) => d.total === 0) ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Aucune vente enregistrée et validée pour l'année {year}.
              </p>
            ) : (
              <div className="h-[300px]" data-testid="chart-chiffre-affaires">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                    <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                    />
                    <Tooltip formatter={(value: number) => formatFcfa(value)} labelClassName="font-medium" />
                    <Bar dataKey="total" name="Chiffre d'affaires" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PieChartIcon className="h-5 w-5 text-primary" />
              Où Part Votre Argent
            </CardTitle>
            <CardDescription>Vos plus grosses dépenses par catégorie, pour l'année {year}.</CardDescription>
          </CardHeader>
          <CardContent>
            {expenseChartData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Aucune dépense enregistrée et validée pour l'année {year}.
              </p>
            ) : (
              <div className="h-[300px]" data-testid="chart-top-depenses">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={expenseChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
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
    </div>
  )
}
