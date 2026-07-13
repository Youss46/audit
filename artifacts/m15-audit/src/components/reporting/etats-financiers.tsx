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
import { FileDown, Scale, LineChart as LineChartIcon, BookOpenCheck } from "lucide-react"
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

// Module M3 (Comptabilité & Travaux - Reporting): "États Financiers
// Automatiques" -- the accountant picks a fiscal year and a statement type,
// and the three standard SYSCOHADA statements are computed live from the
// client's validated general ledger (module M3's approval queue is what
// feeds this: only "Validé" entries ever show up here).
export function EtatsFinanciers({ clientId }: { clientId: number }) {
  const { toast } = useToast()
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

  const exportMutation = useExportLiasseFiscale({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Export enregistré",
          description: "La demande d'export a été consignée dans le journal d'audit (module M9).",
        })
      },
      onError: () => {
        toast({
          title: "Erreur",
          description: "Impossible d'enregistrer cette demande d'export.",
          variant: "destructive",
        })
      },
    },
  })

  const isLoading =
    (reportType === "balance" && balanceQuery.isLoading) ||
    (reportType === "bilan" && bilanQuery.isLoading) ||
    (reportType === "compte_resultat" && compteResultatQuery.isLoading)

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpenCheck className="h-5 w-5 text-primary" />
              États Financiers Automatiques
            </CardTitle>
            <CardDescription>
              Calculés en temps réel à partir des écritures validées du grand livre (module M3).
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
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={exportMutation.isPending}
              data-testid="button-export-liasse"
              onClick={() =>
                exportMutation.mutate({ data: { clientId, year, reportType } })
              }
            >
              <FileDown className="h-4 w-4" />
              Exporter au format liasse fiscale (PDF)
            </Button>
          </div>
        </CardHeader>
      </Card>

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
