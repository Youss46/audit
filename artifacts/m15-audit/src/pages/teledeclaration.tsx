import { useMemo, useState } from "react"
import { useRoute, Link } from "wouter"
import {
  useGetClient,
  getGetClientQueryKey,
  useGetVatDeclaration,
  getGetVatDeclarationQueryKey,
  useGetVatAnnex,
  getGetVatAnnexQueryKey,
  useUpdateVatSupplierInfo,
  usePostVatLiquidation,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/hooks/use-auth"
import { getToken } from "@/lib/auth"
import { cn } from "@/lib/utils"
import {
  Lock,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  FileSpreadsheet,
  Receipt,
  BadgeAlert,
  Pencil,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"

// Module M20 (M21 côté moteur backend) — Télédéclaration TVA, Formulaire
// D-201/VA. Accessible à /cabinet/client/:clientId/teledeclaration.

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function periodOptions(): { value: string; label: string }[] {
  const MOIS = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ]
  const now = new Date()
  const options: { value: string; label: string }[] = []
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    options.push({ value, label: `${MOIS[d.getMonth()]} ${d.getFullYear()}` })
  }
  return options
}

function formatFcfa(amount: number) {
  return amount.toLocaleString("fr-FR") + " FCFA"
}

async function downloadVatAnnexExcel(clientId: number, period: string): Promise<void> {
  const token = getToken()
  const params = new URLSearchParams({ clientId: String(clientId), period })
  const response = await fetch(`/api/tax/exports/vat-annex?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      (errorData as { error?: string }).error ?? "Erreur lors de la génération de l'annexe.",
    )
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const disposition = response.headers.get("content-disposition")
  const match = disposition?.match(/filename="([^"]+)"/)
  a.download = match?.[1] ?? `Annexe_D201VA_${period}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// A single line of the D-201/VA form
// ---------------------------------------------------------------------------
function FormLine({
  label,
  value,
  bold,
  accent,
}: {
  label: string
  value: string
  bold?: boolean
  accent?: "payer" | "credit"
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-2 rounded-md",
        bold ? "bg-[#fdf3e3]" : "odd:bg-white even:bg-[#fbf7ee]",
      )}
    >
      <span className={cn("text-sm", bold && "font-semibold text-[#1e3a5f]")}>{label}</span>
      <span
        className={cn(
          "font-mono text-sm",
          bold && "font-bold text-base",
          accent === "payer" && "text-red-700",
          accent === "credit" && "text-green-700",
        )}
      >
        {value}
      </span>
    </div>
  )
}

export default function Teledeclaration() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/teledeclaration")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [period, setPeriod] = useState(currentPeriod())
  const [showConfirmLiquidation, setShowConfirmLiquidation] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [editingRow, setEditingRow] = useState<{
    transactionId: number
    supplierName: string
    supplierNcc: string
    invoiceNumber: string
  } | null>(null)

  const { data: client } = useGetClient(clientId ?? 0, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId ?? 0) },
  })

  const declarationParams = { clientId: clientId ?? 0, period }
  const {
    data: declaration,
    isLoading: declarationLoading,
    refetch: refetchDeclaration,
  } = useGetVatDeclaration(declarationParams.clientId, declarationParams.period, {
    query: {
      enabled: !!clientId,
      queryKey: getGetVatDeclarationQueryKey(declarationParams.clientId, declarationParams.period),
    },
  })

  const {
    data: annexRows,
    isLoading: annexLoading,
    refetch: refetchAnnex,
  } = useGetVatAnnex(clientId ?? 0, period, {
    query: {
      enabled: !!clientId,
      queryKey: getGetVatAnnexQueryKey(clientId ?? 0, period),
    },
  })

  const updateSupplierMutation = useUpdateVatSupplierInfo({
    mutation: {
      onSuccess: () => {
        toast({ title: "Informations fournisseur mises à jour" })
        setEditingRow(null)
        refetchAnnex()
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur est survenue."
        toast({ title: "Erreur", description: msg, variant: "destructive" })
      },
    },
  })

  const liquidationMutation = usePostVatLiquidation({
    mutation: {
      onSuccess: (data) => {
        const netAPayer = data.sectionC.tvaNetteAPayer
        const credit = data.sectionC.creditATNouveauReporter
        toast({
          title: "Liquidation TVA comptabilisée",
          description:
            netAPayer > 0
              ? `TVA nette à payer : ${formatFcfa(netAPayer)} — écriture #${data.transactionId}.`
              : `Crédit de TVA à reporter : ${formatFcfa(credit)} — écriture #${data.transactionId}.`,
        })
        queryClient.invalidateQueries({
          queryKey: getGetVatDeclarationQueryKey(clientId ?? 0, period),
        })
        setShowConfirmLiquidation(false)
        refetchDeclaration()
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur est survenue."
        toast({ title: "Erreur lors de la liquidation", description: msg, variant: "destructive" })
        setShowConfirmLiquidation(false)
      },
    },
  })

  const rows = useMemo(() => annexRows ?? [], [annexRows])
  const missingNccCount = rows.filter((r) => r.missingNcc).length
  const canLiquidate = user?.role === "expert_comptable"

  async function handleDownload() {
    if (!clientId) return
    setDownloading(true)
    try {
      await downloadVatAnnexExcel(clientId, period)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors du téléchargement."
      toast({ title: "Erreur", description: msg, variant: "destructive" })
    } finally {
      setDownloading(false)
    }
  }

  function handleSaveSupplierInfo() {
    if (!editingRow) return
    updateSupplierMutation.mutate({
      id: editingRow.transactionId,
      data: {
        supplierName: editingRow.supplierName || null,
        supplierNcc: editingRow.supplierNcc || null,
        invoiceNumber: editingRow.invoiceNumber || null,
      },
    })
  }

  // -------------------------------------------------------------------------
  // Access guard
  // -------------------------------------------------------------------------
  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <Lock className="h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Télédéclaration TVA</h2>
        <p className="text-muted-foreground max-w-sm">
          Sélectionnez un client depuis le Registre des Clients pour accéder au formulaire
          D-201/VA.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/clients">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Voir les clients
          </Link>
        </Button>
      </div>
    )
  }

  const sectionA = declaration?.sectionA
  const sectionB = declaration?.sectionB
  const sectionC = declaration?.sectionC
  const isCreditPosition = (sectionC?.creditATNouveauReporter ?? 0) > 0

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Télédéclaration TVA</h1>
          <p className="text-muted-foreground mt-1">
            Formulaire D-201/VA — déclaration mensuelle de TVA et état annexé des taxes
            déductibles, conformes au dépôt sur e-impots.gouv.ci.
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Période</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="select-period"
          >
            {periodOptions().map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ClientAccountingNav activeTab="teledeclaration" />

      {declarationLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Calcul de la déclaration en cours…</span>
        </div>
      )}

      {!declarationLoading && missingNccCount > 0 && (
        <Alert variant="destructive">
          <BadgeAlert className="h-4 w-4" />
          <AlertTitle>NCC Fournisseur manquant !</AlertTitle>
          <AlertDescription>
            {missingNccCount} facture{missingNccCount > 1 ? "s" : ""} de l'état annexé
            {missingNccCount > 1 ? " n'ont" : " n'a"} pas de Numéro de Compte Contribuable
            fournisseur renseigné. La DGI peut rejeter la déduction de TVA correspondante en
            cas de contrôle — corrigez ces lignes dans l'onglet « État Annexé » avant de
            télécharger ou de comptabiliser la liquidation.
          </AlertDescription>
        </Alert>
      )}

      {!declarationLoading && declaration && (
        <Tabs defaultValue="formulaire">
          <TabsList>
            <TabsTrigger value="formulaire" data-testid="tab-formulaire">
              Formulaire D-201/VA
            </TabsTrigger>
            <TabsTrigger value="annexe" data-testid="tab-annexe">
              État Annexé
              {missingNccCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {missingNccCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ================================================================ */}
          {/* Formulaire D-201/VA                                              */}
          {/* ================================================================ */}
          <TabsContent value="formulaire" className="space-y-4 mt-4">
            <Card className="shadow-sm border-2 border-[#1e3a5f]/20 overflow-hidden">
              {/* DGI-style header band */}
              <div className="bg-[#1e3a5f] text-white px-5 py-3 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/70">
                    République de Côte d'Ivoire — Direction Générale des Impôts
                  </p>
                  <p className="text-lg font-bold">Formulaire D-201/VA — Déclaration de TVA</p>
                </div>
                <Badge className="bg-[#e8942c] text-white border-transparent">
                  Période {period}
                </Badge>
              </div>

              <CardContent className="p-5 space-y-5">
                {/* Entity header */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-3 border-b">
                  <div>
                    <p className="text-xs text-muted-foreground">Nom de l'entité</p>
                    <p className="font-semibold">{client?.name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      N° de Compte Contribuable (NCC)
                    </p>
                    <p className="font-mono font-semibold">{client?.taxId || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Période fiscale</p>
                    <p className="font-semibold">{period}</p>
                  </div>
                </div>

                {!client?.taxId && (
                  <Alert variant="destructive" className="py-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      Le NCC de l'entité n'est pas renseigné sur la fiche client — complétez-le
                      avant tout dépôt sur e-impots.gouv.ci.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Section A */}
                <div>
                  <h3 className="text-sm font-bold text-[#1e3a5f] mb-2 flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1e3a5f] text-white text-xs">A</span>
                    Opérations Réalisées
                  </h3>
                  <div className="space-y-0.5 rounded-md border overflow-hidden">
                    <FormLine
                      label="Chiffre d'affaires imposable à 18% (CA HT)"
                      value={formatFcfa(sectionA?.caHt18 ?? 0)}
                    />
                    <FormLine
                      label="TVA collectée à 18%"
                      value={formatFcfa(sectionA?.tvaCollectee18 ?? 0)}
                    />
                    <FormLine
                      label="Chiffre d'affaires imposable à 9% (CA HT)"
                      value={formatFcfa(sectionA?.caHt9 ?? 0)}
                    />
                    <FormLine
                      label="TVA collectée à 9%"
                      value={formatFcfa(sectionA?.tvaCollectee9 ?? 0)}
                    />
                    <FormLine
                      label="Exportations (CA HT, hors taxe)"
                      value={formatFcfa(sectionA?.caExport ?? 0)}
                    />
                    <FormLine
                      label="Opérations exonérées (CA HT)"
                      value={formatFcfa(sectionA?.caExoneree ?? 0)}
                    />
                  </div>
                </div>

                {/* Section B */}
                <div>
                  <h3 className="text-sm font-bold text-[#1e3a5f] mb-2 flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1e3a5f] text-white text-xs">B</span>
                    Déductions
                  </h3>
                  <div className="space-y-0.5 rounded-md border overflow-hidden">
                    <FormLine
                      label="TVA déductible sur immobilisations (445100)"
                      value={formatFcfa(sectionB?.tvaDeductibleImmo ?? 0)}
                    />
                    <FormLine
                      label="TVA déductible sur biens et services (445200)"
                      value={formatFcfa(sectionB?.tvaDeductibleBiensServices ?? 0)}
                    />
                    <FormLine
                      label="Crédit de TVA reporté du mois précédent (445400)"
                      value={formatFcfa(sectionC?.creditAnterieurReporte ?? 0)}
                    />
                  </div>
                </div>

                {/* Section C */}
                <div>
                  <h3 className="text-sm font-bold text-[#1e3a5f] mb-2 flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1e3a5f] text-white text-xs">C</span>
                    Résultat
                  </h3>
                  <div className="space-y-0.5 rounded-md border overflow-hidden">
                    <FormLine
                      label="Total TVA collectée"
                      value={formatFcfa(sectionC?.tvaCollecteeTotale ?? 0)}
                    />
                    <FormLine
                      label="Total TVA déductible"
                      value={formatFcfa(sectionC?.tvaDeductibleTotale ?? 0)}
                    />
                    <Separator />
                    {isCreditPosition ? (
                      <FormLine
                        label="Crédit de TVA à reporter au mois suivant (445400)"
                        value={formatFcfa(sectionC?.creditATNouveauReporter ?? 0)}
                        bold
                        accent="credit"
                      />
                    ) : (
                      <FormLine
                        label="TVA nette à payer (444100)"
                        value={formatFcfa(sectionC?.tvaNetteAPayer ?? 0)}
                        bold
                        accent="payer"
                      />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================================================================ */}
          {/* État Annexé                                                      */}
          {/* ================================================================ */}
          <TabsContent value="annexe" className="space-y-4 mt-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  État des Taxes Déductibles — Annexe D-201/VA
                </CardTitle>
                <CardDescription>
                  Détail des factures d'achat ayant généré de la TVA déductible pour la
                  période {period}. Les fournisseurs sans NCC valide sont surlignés — un
                  risque de rejet de la déduction lors d'un contrôle fiscal de la DGI.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {annexLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Chargement de l'annexe…</span>
                  </div>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    Aucune opération avec TVA déductible pour cette période.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Libellé</TableHead>
                          <TableHead>Fournisseur</TableHead>
                          <TableHead>N° CC Fournisseur</TableHead>
                          <TableHead>N° Facture</TableHead>
                          <TableHead className="text-right">Base HT</TableHead>
                          <TableHead className="text-center">Taux</TableHead>
                          <TableHead className="text-right">TVA Déductible</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow
                            key={row.transactionId}
                            className={cn(row.missingNcc && "bg-red-50/70 hover:bg-red-50")}
                            data-testid={`row-annexe-${row.transactionId}`}
                          >
                            <TableCell className="whitespace-nowrap text-sm">
                              {new Date(row.date).toLocaleDateString("fr-FR")}
                            </TableCell>
                            <TableCell className="text-sm max-w-56 truncate">{row.label}</TableCell>
                            <TableCell className="text-sm">{row.supplierName ?? "—"}</TableCell>
                            <TableCell>
                              {row.missingNcc ? (
                                <Badge variant="destructive" className="gap-1">
                                  <BadgeAlert className="h-3 w-3" />
                                  NCC manquant
                                </Badge>
                              ) : (
                                <span className="font-mono text-sm">{row.supplierNcc}</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {row.invoiceNumber ?? "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatFcfa(row.baseHt)}
                            </TableCell>
                            <TableCell className="text-center text-sm">{row.tauxTva}%</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatFcfa(row.tvaDeductible)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Corriger les informations fournisseur"
                                onClick={() =>
                                  setEditingRow({
                                    transactionId: row.transactionId,
                                    supplierName: row.supplierName ?? "",
                                    supplierNcc: row.supplierNcc ?? "",
                                    invoiceNumber: row.invoiceNumber ?? "",
                                  })
                                }
                                data-testid={`button-edit-${row.transactionId}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Actions panel                                                        */}
      {/* -------------------------------------------------------------------- */}
      {!declarationLoading && declaration && (
        <Card className="shadow-sm border-2 border-dashed border-muted">
          <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-base">Actions de Télédéclaration</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-lg">
                Téléchargez l'annexe pour l'importer sur e-impots.gouv.ci, puis comptabilisez
                la liquidation une fois la déclaration validée.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                variant="outline"
                onClick={handleDownload}
                disabled={downloading}
                className="gap-2"
                data-testid="button-download-annexe"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Télécharger l'Annexe D-201/VA (Excel)
              </Button>
              <Button
                variant="default"
                disabled={!canLiquidate || liquidationMutation.isPending}
                onClick={() => setShowConfirmLiquidation(true)}
                className="gap-2"
                data-testid="button-liquidation"
              >
                {liquidationMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Receipt className="h-4 w-4" />
                )}
                Générer l'écriture comptable de liquidation
              </Button>
            </div>
          </CardContent>
          {!canLiquidate && (
            <CardContent className="pt-0">
              <Alert variant="destructive" className="py-2">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Seul un expert-comptable peut comptabiliser la liquidation de TVA.
                </AlertDescription>
              </Alert>
            </CardContent>
          )}
        </Card>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Supplier-info edit dialog                                           */}
      {/* -------------------------------------------------------------------- */}
      <Dialog open={!!editingRow} onOpenChange={(open) => !open && setEditingRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Informations Fournisseur</DialogTitle>
            <DialogDescription>
              Complétez le NCC du fournisseur pour sécuriser la déduction de TVA sur cette
              opération.
            </DialogDescription>
          </DialogHeader>
          {editingRow && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="supplierName">Nom du fournisseur</Label>
                <Input
                  id="supplierName"
                  value={editingRow.supplierName}
                  onChange={(e) =>
                    setEditingRow({ ...editingRow, supplierName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="supplierNcc">N° de Compte Contribuable (NCC)</Label>
                <Input
                  id="supplierNcc"
                  value={editingRow.supplierNcc}
                  onChange={(e) => setEditingRow({ ...editingRow, supplierNcc: e.target.value })}
                  className="font-mono"
                  data-testid="input-supplier-ncc"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoiceNumber">N° de Facture</Label>
                <Input
                  id="invoiceNumber"
                  value={editingRow.invoiceNumber}
                  onChange={(e) =>
                    setEditingRow({ ...editingRow, invoiceNumber: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRow(null)}>
              Annuler
            </Button>
            <Button
              onClick={handleSaveSupplierInfo}
              disabled={updateSupplierMutation.isPending}
              data-testid="button-save-supplier-info"
            >
              {updateSupplierMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------------------------- */}
      {/* Liquidation confirmation                                            */}
      {/* -------------------------------------------------------------------- */}
      <AlertDialog open={showConfirmLiquidation} onOpenChange={setShowConfirmLiquidation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Confirmation de la liquidation TVA — {period}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Cette action comptabilise une écriture d'opérations diverses définitive :
                  débit des comptes 443100/443200 (TVA collectée), crédit des comptes
                  445100/445200 (TVA déductible) et, selon le solde, crédit du compte 444100
                  (TVA à payer) ou débit du compte 445400 (crédit de TVA à reporter).
                </p>
                {missingNccCount > 0 && (
                  <Alert variant="destructive" className="py-2">
                    <BadgeAlert className="h-4 w-4" />
                    <AlertDescription>
                      {missingNccCount} facture{missingNccCount > 1 ? "s" : ""} de l'état
                      annexé {missingNccCount > 1 ? "n'ont" : "n'a"} toujours pas de NCC
                      fournisseur. La comptabilisation reste possible, mais la déduction
                      correspondante pourrait être rejetée par la DGI en cas de contrôle.
                    </AlertDescription>
                  </Alert>
                )}
                <p className="font-medium text-foreground">
                  Confirmez-vous la comptabilisation de la liquidation TVA de la période{" "}
                  {period} pour ce client ?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={liquidationMutation.isPending}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clientId && liquidationMutation.mutate({ clientId, period })}
              disabled={liquidationMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-liquidation"
            >
              {liquidationMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Confirmer la liquidation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
