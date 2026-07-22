import { useMemo, useState } from "react"
import {
  useGetBalanceDesComptes,
  getGetBalanceDesComptesQueryKey,
  useGetBilanSimplifie,
  getGetBilanSimplifieQueryKey,
  useGetCompteDeResultat,
  getGetCompteDeResultatQueryKey,
  useExportLiasseFiscale,
} from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import { formatFcfa } from "@/lib/status"
import { getToken, getApiBase } from "@/lib/auth"
import {
  FileText,
  Sheet,
  FileDown,
  Scale,
  LineChart as LineChartIcon,
  BookOpenCheck,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"

type ReportType = "balance" | "bilan" | "compte_resultat"

const REPORT_OPTIONS: { value: ReportType; label: string }[] = [
  { value: "balance", label: "Balance des Comptes" },
  { value: "bilan", label: "Bilan Simplifié" },
  { value: "compte_resultat", label: "Compte de Résultat Simplifié" },
]

// A fiscal year selector spanning the last 5 years through next year --
// wide enough to cover a cabinet's typical review window without needing
// server-driven bounds.
function buildYearOptions() {
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = currentYear + 1; y >= currentYear - 5; y--) years.push(y)
  return years
}

function AccountClassBadge({ accountClass }: { accountClass: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-mono font-semibold text-muted-foreground">
      {accountClass}
    </span>
  )
}

// ---------------------------------------------------------------------------
// File download helper – calls the binary export endpoint with the user's
// Bearer token, converts the response to a Blob, and triggers a browser
// download without leaving the page.
// ---------------------------------------------------------------------------
type DownloadEndpoint = "balance" | "financial-statements"
type ExportFormat = "pdf" | "excel"

async function downloadExport(
  endpoint: DownloadEndpoint,
  clientId: number,
  year: number,
  format: ExportFormat,
): Promise<void> {
  const token = getToken()
  const params = new URLSearchParams({
    clientId: String(clientId),
    year: String(year),
    format,
  })

  const response = await fetch(`${getApiBase()}/api/reports/exports/${endpoint}?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error((errorData as { error?: string }).error ?? "Erreur lors de la génération du document.")
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  // Derive filename from Content-Disposition if present, else fall back
  const disposition = response.headers.get("content-disposition")
  const match = disposition?.match(/filename="([^"]+)"/)
  a.download = match?.[1] ?? `export_${endpoint}_${year}.${format === "pdf" ? "pdf" : "xlsx"}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Export controls panel – rendered below the view toolbar.
// Shows a loading bar while the server compiles the document.
// ---------------------------------------------------------------------------
function ExportPanel({
  clientId,
  year,
  reportType,
}: {
  clientId: number
  year: number
  reportType: ReportType
}) {
  const { toast } = useToast()
  const [pending, setPending] = useState<"pdf" | "excel" | null>(null)

  // Which export endpoint maps to which report type
  const endpoint: DownloadEndpoint =
    reportType === "balance" ? "balance" : "financial-statements"

  // Keep the legacy audit-log mutation so every export attempt is still
  // traced in the M9 journal regardless of format.
  const auditMutation = useExportLiasseFiscale()

  async function handleExport(format: ExportFormat) {
    if (pending) return
    setPending(format)
    try {
      await downloadExport(endpoint, clientId, year, format)
      // Fire-and-forget audit log (non-blocking)
      auditMutation.mutate({
        data: {
          clientId,
          year,
          reportType: reportType === "compte_resultat" ? "compte_resultat" : reportType,
        },
      })
    } catch (err) {
      toast({
        title: "Échec de l'export",
        description: err instanceof Error ? err.message : "Une erreur inattendue s'est produite.",
        variant: "destructive",
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <Card className="shadow-sm border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          <FileDown className="h-4 w-4" />
          Exporter les États Financiers
        </CardTitle>
        <CardDescription className="text-xs">
          Génère un document réglementaire SYSCOHADA à partir des écritures validées de l'exercice.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Loading bar */}
        {pending && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Génération du document réglementaire en cours…
            </div>
            <Progress value={undefined} className="h-1.5 animate-pulse" />
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {/* PDF download */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-red-200 hover:border-red-400 hover:bg-red-50 text-foreground"
            disabled={!!pending}
            data-testid="button-export-pdf"
            onClick={() => handleExport("pdf")}
          >
            {pending === "pdf" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 text-red-500" />
            )}
            Télécharger le PDF (.pdf)
          </Button>

          {/* Excel download */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-green-200 hover:border-green-400 hover:bg-green-50 text-foreground"
            disabled={!!pending}
            data-testid="button-export-excel"
            onClick={() => handleExport("excel")}
          >
            {pending === "excel" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sheet className="h-4 w-4 text-green-600" />
            )}
            Télécharger le Fichier Excel (.xlsx)
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// Module M3 (Comptabilité & Travaux - Reporting): "États Financiers
// Automatiques" -- the accountant picks a fiscal year and a statement type,
// and the three standard SYSCOHADA statements are computed live from the
// client's validated general ledger (module M3's approval queue is what
// feeds this: only "Validé" entries ever show up here).
export function EtatsFinanciers({ clientId }: { clientId: number }) {
  const yearOptions = useMemo(() => buildYearOptions(), [])
  const [year, setYear] = useState(yearOptions[1] ?? new Date().getFullYear())
  const [reportType, setReportType] = useState<ReportType>("balance")

  const balanceQuery = useGetBalanceDesComptes(
    { clientId, year },
    {
      query: {
        enabled: !!clientId && reportType === "balance",
        queryKey: getGetBalanceDesComptesQueryKey({ clientId, year }),
      },
    },
  )
  const bilanQuery = useGetBilanSimplifie(
    { clientId, year },
    {
      query: {
        enabled: !!clientId && reportType === "bilan",
        queryKey: getGetBilanSimplifieQueryKey({ clientId, year }),
      },
    },
  )
  const compteResultatQuery = useGetCompteDeResultat(
    { clientId, year },
    {
      query: {
        enabled: !!clientId && reportType === "compte_resultat",
        queryKey: getGetCompteDeResultatQueryKey({ clientId, year }),
      },
    },
  )

  const isLoading =
    (reportType === "balance" && balanceQuery.isLoading) ||
    (reportType === "bilan" && bilanQuery.isLoading) ||
    (reportType === "compte_resultat" && compteResultatQuery.isLoading)

  return (
    <div className="space-y-6">
      {/* Toolbar card */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpenCheck className="h-5 w-5 text-primary" />
              États Financiers Automatiques
            </CardTitle>
            <CardDescription>
              Calculés en temps réel à partir des écritures validées du grand livre.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger className="w-[220px]" data-testid="select-report-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger className="w-[140px]" data-testid="select-fiscal-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    Exercice {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {/* Export controls */}
      <ExportPanel clientId={clientId} year={year} reportType={reportType} />

      {/* Report view */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <div className="h-4 w-4 mr-2 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Calcul des états financiers...
        </div>
      ) : reportType === "balance" ? (
        <BalanceTable rows={balanceQuery.data?.rows ?? []} />
      ) : reportType === "bilan" ? (
        <BilanTables data={bilanQuery.data} />
      ) : (
        <CompteResultatTables data={compteResultatQuery.data} />
      )}
    </div>
  )
}

function BalanceTable({
  rows,
}: {
  rows: {
    accountNumber: string
    accountName: string
    accountClass: number
    initialBalance: number
    totalDebit: number
    totalCredit: number
    finalBalance: number
    finalBalanceSide: "debiteur" | "crediteur"
  }[]
}) {
  if (rows.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Aucune écriture validée pour cet exercice. La balance apparaîtra dès que le cabinet aura comptabilisé des opérations.
        </CardContent>
      </Card>
    )
  }

  const totals = rows.reduce(
    (acc, r) => ({
      initial: acc.initial + r.initialBalance,
      debit: acc.debit + r.totalDebit,
      credit: acc.credit + r.totalCredit,
    }),
    { initial: 0, debit: 0, credit: 0 },
  )

  return (
    <Card className="shadow-sm" data-testid="table-balance-comptes">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-primary" />
          Balance des Comptes
        </CardTitle>
        <CardDescription>Un solde par compte SYSCOHADA : solde initial, mouvements de l'exercice, solde de clôture.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Compte</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Classe</TableHead>
              <TableHead className="text-right">Solde Initial</TableHead>
              <TableHead className="text-right">Total Débits</TableHead>
              <TableHead className="text-right">Total Crédits</TableHead>
              <TableHead className="text-right">Solde Débiteur</TableHead>
              <TableHead className="text-right">Solde Créditeur</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.accountNumber} data-testid={`row-account-${row.accountNumber}`}>
                <TableCell className="font-mono font-medium">{row.accountNumber}</TableCell>
                <TableCell>{row.accountName}</TableCell>
                <TableCell><AccountClassBadge accountClass={row.accountClass} /></TableCell>
                <TableCell className="text-right font-mono">{formatFcfa(row.initialBalance)}</TableCell>
                <TableCell className="text-right font-mono">{formatFcfa(row.totalDebit)}</TableCell>
                <TableCell className="text-right font-mono">{formatFcfa(row.totalCredit)}</TableCell>
                <TableCell className="text-right font-mono">
                  {row.finalBalanceSide === "debiteur" ? formatFcfa(row.finalBalance) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.finalBalanceSide === "crediteur" ? formatFcfa(row.finalBalance) : "—"}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold bg-muted/40">
              <TableCell colSpan={3}>Totaux</TableCell>
              <TableCell className="text-right font-mono">{formatFcfa(totals.initial)}</TableCell>
              <TableCell className="text-right font-mono">{formatFcfa(totals.debit)}</TableCell>
              <TableCell className="text-right font-mono">{formatFcfa(totals.credit)}</TableCell>
              <TableCell colSpan={2}></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function BilanTables({
  data,
}: {
  data?: {
    actif: { key: string; label: string; amount: number }[]
    passif: { key: string; label: string; amount: number }[]
    totalActif: number
    totalPassif: number
  }
}) {
  if (!data || (data.actif.length === 0 && data.passif.length === 0)) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Aucune écriture validée pour cet exercice. Le bilan apparaîtra dès que le cabinet aura comptabilisé des opérations.
        </CardContent>
      </Card>
    )
  }

  const isBalanced = data.totalActif === data.totalPassif

  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm" data-testid="table-bilan-actif">
          <CardHeader>
            <CardTitle className="text-base">Actif</CardTitle>
            <CardDescription>Ce que l'entreprise possède.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {data.actif.map((line) => (
                  <TableRow key={line.key}>
                    <TableCell>{line.label}</TableCell>
                    <TableCell className="text-right font-mono">{formatFcfa(line.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/40">
                  <TableCell>Total Actif</TableCell>
                  <TableCell className="text-right font-mono">{formatFcfa(data.totalActif)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm" data-testid="table-bilan-passif">
          <CardHeader>
            <CardTitle className="text-base">Passif</CardTitle>
            <CardDescription>Ce que l'entreprise doit et ses capitaux propres.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {data.passif.map((line) => (
                  <TableRow key={line.key}>
                    <TableCell>{line.label}</TableCell>
                    <TableCell className="text-right font-mono">{formatFcfa(line.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/40">
                  <TableCell>Total Passif</TableCell>
                  <TableCell className="text-right font-mono">{formatFcfa(data.totalPassif)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {!isBalanced && (
        <p className="text-xs text-destructive">
          Écart entre Actif ({formatFcfa(data.totalActif)}) et Passif ({formatFcfa(data.totalPassif)}) — vérifiez les écritures validées de l'exercice.
        </p>
      )}
    </div>
  )
}

function CompteResultatTables({
  data,
}: {
  data?: {
    charges: { accountNumber: string; label: string; amount: number }[]
    produits: { accountNumber: string; label: string; amount: number }[]
    totalCharges: number
    totalProduits: number
    resultatNet: number
  }
}) {
  if (!data || (data.charges.length === 0 && data.produits.length === 0)) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Aucune écriture validée pour cet exercice. Le compte de résultat apparaîtra dès que le cabinet aura comptabilisé des opérations.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm" data-testid="table-charges">
          <CardHeader>
            <CardTitle className="text-base">Charges (Classe 6)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {data.charges.map((line) => (
                  <TableRow key={line.accountNumber}>
                    <TableCell className="font-mono text-xs text-muted-foreground w-16">{line.accountNumber}</TableCell>
                    <TableCell>{line.label}</TableCell>
                    <TableCell className="text-right font-mono">{formatFcfa(line.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/40">
                  <TableCell colSpan={2}>Total Classe 6</TableCell>
                  <TableCell className="text-right font-mono">{formatFcfa(data.totalCharges)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm" data-testid="table-produits">
          <CardHeader>
            <CardTitle className="text-base">Produits (Classe 7)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {data.produits.map((line) => (
                  <TableRow key={line.accountNumber}>
                    <TableCell className="font-mono text-xs text-muted-foreground w-16">{line.accountNumber}</TableCell>
                    <TableCell>{line.label}</TableCell>
                    <TableCell className="text-right font-mono">{formatFcfa(line.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/40">
                  <TableCell colSpan={2}>Total Classe 7</TableCell>
                  <TableCell className="text-right font-mono">{formatFcfa(data.totalProduits)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className={`shadow-sm border-l-4 ${data.resultatNet >= 0 ? "border-l-green-500" : "border-l-destructive"}`} data-testid="card-resultat-net">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-2 font-semibold">
            <LineChartIcon className="h-4 w-4 text-primary" />
            Résultat Net de l'Exercice ({data.resultatNet >= 0 ? "Bénéfice" : "Perte"})
          </div>
          <div className={`text-xl font-bold font-mono ${data.resultatNet >= 0 ? "text-green-600" : "text-destructive"}`}>
            {formatFcfa(data.resultatNet)}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
