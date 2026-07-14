import { useState } from "react"
import { useRoute, Link } from "wouter"
import { useGetClient, getGetClientQueryKey, useGetDsf, getGetDsfQueryKey } from "@workspace/api-client-react"
import type { DsfBilanActifLine, DsfBilanPassifLine, DsfCompteResultatLine, DsfTftLine } from "@workspace/api-client-react"
import { getToken } from "@/lib/auth"
import {
  ChevronLeft,
  Loader2,
  AlertTriangle,
  Scale,
  CheckCircle2,
  Download,
  FileSpreadsheet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"

// Module M24 — Générateur de Liasse Fiscale / DSF SYSCOHADA Révisé.
// Accessible at /cabinet/client/:clientId/dsf. Computes the full DSF
// (Bilan Actif/Passif, Compte de Résultat, TFT) live from the validated
// general ledger (see artifacts/api-server/src/lib/dsf-engine.ts) and lets
// the cabinet download the official-style liasse as a 3-sheet Excel file.

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i)

function formatFcfa(amount: number) {
  return amount.toLocaleString("fr-FR") + " FCFA"
}

async function downloadDsfExcel(clientId: number, year: number): Promise<void> {
  const token = getToken()
  const params = new URLSearchParams({ clientId: String(clientId), year: String(year) })
  const response = await fetch(`/api/tax/exports/dsf?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      (errorData as { error?: string }).error ?? "Erreur lors de la génération de la liasse fiscale.",
    )
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const disposition = response.headers.get("content-disposition")
  const match = disposition?.match(/filename="([^"]+)"/)
  a.download = match?.[1] ?? `LiasseFiscale_DSF_${year}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function StatusCard({
  ok,
  okLabel,
  errorLabel,
  icon,
}: {
  ok: boolean
  okLabel: string
  errorLabel: string
  icon: React.ReactNode
}) {
  return (
    <Card className={cn("border-2", ok ? "border-green-200 bg-green-50/50 dark:bg-green-950/20" : "border-red-200 bg-red-50/50 dark:bg-red-950/20")}>
      <CardContent className="flex items-center gap-3 py-4">
        <div className={cn("rounded-full p-2", ok ? "bg-green-100 text-green-700 dark:bg-green-900/40" : "bg-red-100 text-red-700 dark:bg-red-900/40")}>
          {icon}
        </div>
        <div>
          <p className={cn("text-sm font-semibold", ok ? "text-green-800 dark:text-green-300" : "text-red-800 dark:text-red-300")}>
            {ok ? okLabel : errorLabel}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function BilanActifTable({ lines, total }: { lines: DsfBilanActifLine[]; total: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Réf.</TableHead>
          <TableHead>ACTIF</TableHead>
          <TableHead className="text-right">Brut</TableHead>
          <TableHead className="text-right">Amort.</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) =>
          l.isSectionHeader ? (
            <TableRow key={i} className="bg-muted/50">
              <TableCell colSpan={5} className="font-semibold text-primary">{l.label}</TableCell>
            </TableRow>
          ) : (
            <TableRow key={i} className={cn(l.isSubtotal && "bg-muted/40 font-semibold")}>
              <TableCell className="font-mono text-xs text-muted-foreground">{l.lineCode}</TableCell>
              <TableCell>{l.label}</TableCell>
              <TableCell className="text-right font-mono text-sm">{formatFcfa(l.brut)}</TableCell>
              <TableCell className="text-right font-mono text-sm">{formatFcfa(l.amortissements)}</TableCell>
              <TableCell className="text-right font-mono text-sm">{formatFcfa(l.netN)}</TableCell>
            </TableRow>
          ),
        )}
        <TableRow className="border-t-2 font-bold">
          <TableCell />
          <TableCell>TOTAL ACTIF</TableCell>
          <TableCell />
          <TableCell />
          <TableCell className="text-right font-mono">{formatFcfa(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

function BilanPassifTable({ lines, total }: { lines: DsfBilanPassifLine[]; total: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Réf.</TableHead>
          <TableHead>PASSIF</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) =>
          l.isSectionHeader ? (
            <TableRow key={i} className="bg-muted/50">
              <TableCell colSpan={3} className="font-semibold text-primary">{l.label}</TableCell>
            </TableRow>
          ) : (
            <TableRow key={i} className={cn(l.isSubtotal && "bg-muted/40 font-semibold")}>
              <TableCell className="font-mono text-xs text-muted-foreground">{l.lineCode}</TableCell>
              <TableCell>{l.label}</TableCell>
              <TableCell className="text-right font-mono text-sm">{formatFcfa(l.montantN)}</TableCell>
            </TableRow>
          ),
        )}
        <TableRow className="border-t-2 font-bold">
          <TableCell />
          <TableCell>TOTAL PASSIF</TableCell>
          <TableCell className="text-right font-mono">{formatFcfa(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

function CompteResultatTable({ lines }: { lines: DsfCompteResultatLine[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Réf.</TableHead>
          <TableHead>Libellé</TableHead>
          <TableHead className="text-right">Produits</TableHead>
          <TableHead className="text-right">Charges</TableHead>
          <TableHead className="text-right">Solde</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) =>
          l.isSectionHeader ? (
            <TableRow key={i} className="bg-muted/50">
              <TableCell colSpan={5} className="font-semibold text-primary">{l.label}</TableCell>
            </TableRow>
          ) : (
            <TableRow key={i} className={cn(l.isIntermediate && "bg-muted/40 font-semibold")}>
              <TableCell className="font-mono text-xs text-muted-foreground">{l.lineCode}</TableCell>
              <TableCell>{l.label}</TableCell>
              <TableCell className="text-right font-mono text-sm">{l.produits ? formatFcfa(l.produits) : ""}</TableCell>
              <TableCell className="text-right font-mono text-sm">{l.charges ? formatFcfa(l.charges) : ""}</TableCell>
              <TableCell className={cn("text-right font-mono text-sm", l.solde < 0 && "text-red-600")}>{formatFcfa(l.solde)}</TableCell>
            </TableRow>
          ),
        )}
      </TableBody>
    </Table>
  )
}

function TftTable({ lines }: { lines: DsfTftLine[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">Réf.</TableHead>
          <TableHead>Libellé</TableHead>
          <TableHead className="text-right">Montant N</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) =>
          l.isSectionHeader ? (
            <TableRow key={i} className="bg-muted/50">
              <TableCell colSpan={3} className="font-semibold text-primary">{l.label}</TableCell>
            </TableRow>
          ) : (
            <TableRow key={i} className={cn(l.isSubtotal && "bg-muted/40 font-semibold")}>
              <TableCell className="font-mono text-xs text-muted-foreground">{l.lineCode}</TableCell>
              <TableCell>{l.label}</TableCell>
              <TableCell className={cn("text-right font-mono text-sm", l.montantN < 0 && "text-red-600")}>{formatFcfa(l.montantN)}</TableCell>
            </TableRow>
          ),
        )}
      </TableBody>
    </Table>
  )
}

export default function Dsf() {
  const { toast } = useToast()
  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/dsf")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [downloading, setDownloading] = useState(false)

  const { data: client } = useGetClient(clientId ?? 0, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId ?? 0) },
  })

  const { data: dsf, isLoading, isError, error } = useGetDsf(clientId ?? 0, selectedYear, {
    query: { enabled: !!clientId, queryKey: getGetDsfQueryKey(clientId ?? 0, selectedYear) },
  })

  async function handleDownload() {
    if (!clientId) return
    setDownloading(true)
    try {
      await downloadDsfExcel(clientId, selectedYear)
      toast({ title: "Liasse fiscale téléchargée", description: `Exercice ${selectedYear}.` })
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

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card px-6 py-3">
        <Link href="/cabinet" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Retour au cabinet
        </Link>
      </div>

      <ClientAccountingNav activeTab="dsf" />

      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Liasse Fiscale — DSF SYSCOHADA Révisé</h1>
            <p className="text-sm text-muted-foreground">
              Déclaration Statistique et Fiscale générée automatiquement depuis le grand livre validé de {client?.name ?? "…"}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-32" data-testid="select-dsf-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleDownload} disabled={downloading || !dsf} data-testid="button-export-dsf">
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Exporter (Excel)
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
              {error instanceof Error ? error.message : "Impossible de calculer la liasse fiscale."}
            </AlertDescription>
          </Alert>
        )}

        {dsf && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatusCard
                ok={dsf.balanceEquilibre}
                okLabel={`Balance équilibrée — ${formatFcfa(dsf.totalDebits)}`}
                errorLabel={`Écart de balance : Débit ${formatFcfa(dsf.totalDebits)} ≠ Crédit ${formatFcfa(dsf.totalCredits)}`}
                icon={<Scale className="h-5 w-5" />}
              />
              <StatusCard
                ok={dsf.bilanEquilibre}
                okLabel={`Bilan équilibré — ${formatFcfa(dsf.totalBilanActif)}`}
                errorLabel={`Écart bilan : Actif ${formatFcfa(dsf.totalBilanActif)} ≠ Passif ${formatFcfa(dsf.totalBilanPassif)}`}
                icon={<CheckCircle2 className="h-5 w-5" />}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  États financiers — Exercice {selectedYear}
                </CardTitle>
                <CardDescription>
                  Calculés en direct à partir des écritures validées. Aucune donnée fictive : toute anomalie de la balance ou du bilan est signalée ci-dessus.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="bilan-actif">
                  <TabsList className="flex-wrap h-auto">
                    <TabsTrigger value="bilan-actif" data-testid="tab-bilan-actif">Bilan Actif</TabsTrigger>
                    <TabsTrigger value="bilan-passif" data-testid="tab-bilan-passif">Bilan Passif</TabsTrigger>
                    <TabsTrigger value="compte-resultat" data-testid="tab-compte-resultat">Compte de Résultat</TabsTrigger>
                    <TabsTrigger value="tft" data-testid="tab-tft">TFT</TabsTrigger>
                  </TabsList>
                  <TabsContent value="bilan-actif" className="mt-4">
                    <BilanActifTable lines={dsf.bilanActif} total={dsf.totalBilanActif} />
                  </TabsContent>
                  <TabsContent value="bilan-passif" className="mt-4">
                    <BilanPassifTable lines={dsf.bilanPassif} total={dsf.totalBilanPassif} />
                  </TabsContent>
                  <TabsContent value="compte-resultat" className="mt-4">
                    <CompteResultatTable lines={dsf.compteResultat} />
                  </TabsContent>
                  <TabsContent value="tft" className="mt-4">
                    <TftTable lines={dsf.tft} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
