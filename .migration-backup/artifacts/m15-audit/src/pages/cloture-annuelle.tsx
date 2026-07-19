import { useState } from "react"
import { useRoute, Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetClosingStatus,
  getGetClosingStatusQueryKey,
  useClosePeriod,
  useGetBalanceDesComptes,
  getGetBalanceDesComptesQueryKey,
  useGetCompteDeResultat,
  getGetCompteDeResultatQueryKey,
  useGenerateDepreciationClosings,
  useGenerateFinanceJournalEntries,
} from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/hooks/use-auth"
import { cn, formatDate } from "@/lib/utils"
import {
  Lock,
  CheckCircle2,
  Circle,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Scale,
  ClipboardCheck,
  RefreshCw,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"

// Module M19 — Clôture Annuelle.
// Accessible at /cabinet/client/:clientId/cloture.
const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i)

function formatFcfa(amount: number) {
  return amount.toLocaleString("fr-FR") + " FCFA"
}

// Step status indicator component
type StepStatus = "idle" | "running" | "success" | "error"

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "running")
    return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
  if (status === "success")
    return <CheckCircle2 className="h-5 w-5 text-green-500" />
  if (status === "error")
    return <AlertTriangle className="h-5 w-5 text-destructive" />
  return <Circle className="h-5 w-5 text-muted-foreground" />
}

export default function ClotureAnnuelle() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/cloture")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [showConfirm, setShowConfirm] = useState(false)

  // Step 1 state
  const [step1Status, setStep1Status] = useState<StepStatus>("idle")
  const [step1Result, setStep1Result] = useState<{
    depGenerated: number
    finGenerated: number
  } | null>(null)

  // Step 2: run balance check on demand
  const [step2Enabled, setStep2Enabled] = useState(false)
  const balanceParams = { clientId: clientId ?? 0, year: selectedYear }
  const { data: balanceData, isLoading: balanceLoading } = useGetBalanceDesComptes(
    balanceParams,
    {
      query: {
        enabled: !!clientId && step2Enabled,
        queryKey: getGetBalanceDesComptesQueryKey(balanceParams),
      },
    },
  )

  // Step 3: compte de résultat (loaded when step 2 passes)
  const compteParams = { clientId: clientId ?? 0, year: selectedYear }
  const { data: compteData, isLoading: compteLoading } = useGetCompteDeResultat(
    compteParams,
    {
      query: {
        enabled: !!clientId && step2Enabled,
        queryKey: getGetCompteDeResultatQueryKey(compteParams),
      },
    },
  )

  // Closing status (OPEN / LOCKED)
  const { data: closingStatus, isLoading: statusLoading, refetch: refetchStatus } =
    useGetClosingStatus(clientId ?? 0, selectedYear, {
      query: {
        enabled: !!clientId,
        queryKey: getGetClosingStatusQueryKey(clientId ?? 0, selectedYear),
      },
    })

  // Mutations
  const depMutation = useGenerateDepreciationClosings({
    mutation: {
      onSuccess: (data) => {
        const d = data as { generated: unknown[]; skipped: unknown[] }
        toast({
          title: `Dotations générées`,
          description: `${d.generated.length} écriture(s) de dotation créée(s)${d.skipped.length ? `, ${d.skipped.length} ignorée(s)` : ""}.`,
        })
        return d
      },
    },
  })

  const finMutation = useGenerateFinanceJournalEntries({
    mutation: {
      onSuccess: (data) => {
        const d = data as { generated: unknown[]; skipped: unknown[] }
        toast({
          title: `Échéances financières générées`,
          description: `${d.generated.length} élément(s) traité(s)${d.skipped.length ? `, ${d.skipped.length} ignoré(s)` : ""}.`,
        })
        return d
      },
    },
  })

  const closeMutation = useClosePeriod({
    mutation: {
      onSuccess: (data) => {
        const d = data as {
          year: number
          step2: { netResult: number; resultAccount: string }
          step4: { accountsCarriedForward: number }
        }
        toast({
          title: `L'exercice ${d.year} a été clôturé`,
          description: `Les comptes de gestion ont été soldés et le résultat a été transféré dans les Capitaux Propres. Résultat net : ${formatFcfa(d.step2.netResult)} (compte ${d.step2.resultAccount}). ${d.step4.accountsCarriedForward} à-nouveau(x) générés.`,
        })
        queryClient.invalidateQueries({ queryKey: getGetClosingStatusQueryKey(clientId ?? 0, selectedYear) })
        refetchStatus()
        setShowConfirm(false)
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur est survenue."
        toast({ title: "Erreur lors de la clôture", description: msg, variant: "destructive" })
        setShowConfirm(false)
      },
    },
  })

  // -------------------------------------------------------------------------
  // Step 1 handler: generate all year-end adjustments
  // -------------------------------------------------------------------------
  async function handleStep1() {
    if (!clientId) return
    setStep1Status("running")
    setStep1Result(null)
    try {
      const depResult = await new Promise<{ generated: unknown[] }>((resolve, reject) => {
        depMutation.mutate(
          { clientId, year: selectedYear },
          { onSuccess: (d) => resolve(d as { generated: unknown[] }), onError: reject },
        )
      })
      const finResult = await new Promise<{ generated: unknown[] }>((resolve, reject) => {
        finMutation.mutate(
          { clientId },
          { onSuccess: (d) => resolve(d as { generated: unknown[] }), onError: reject },
        )
      })
      setStep1Status("success")
      setStep1Result({
        depGenerated: depResult.generated.length,
        finGenerated: finResult.generated.length,
      })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
    } catch {
      setStep1Status("error")
      toast({
        title: "Erreur lors de la génération des régularisations",
        variant: "destructive",
      })
    }
  }

  // -------------------------------------------------------------------------
  // Balance check helper
  // -------------------------------------------------------------------------
  const balanceRows = (balanceData as { rows?: { totalDebit?: number; totalCredit?: number }[] } | undefined)?.rows ?? []
  const totalDebits = balanceRows.reduce((s, r) => s + (r.totalDebit ?? 0), 0)
  const totalCredits = balanceRows.reduce((s, r) => s + (r.totalCredit ?? 0), 0)
  const balanceOk = step2Enabled && !balanceLoading && Math.abs(totalDebits - totalCredits) < 1

  // -------------------------------------------------------------------------
  // Net result helper
  // -------------------------------------------------------------------------
  const compteResult = compteData as
    | {
        totalRevenues?: number
        totalExpenses?: number
        netResult?: number
        revenues?: { total?: number }
        expenses?: { total?: number }
      }
    | undefined
  const netResult: number =
    (compteResult as { netResult?: number } | undefined)?.netResult ??
    ((compteResult?.totalRevenues ?? 0) - (compteResult?.totalExpenses ?? 0))
  const totalRevenues: number =
    (compteResult as { totalRevenues?: number } | undefined)?.totalRevenues ?? 0
  const totalExpenses: number =
    (compteResult as { totalExpenses?: number } | undefined)?.totalExpenses ?? 0

  // -------------------------------------------------------------------------
  // Access guard
  // -------------------------------------------------------------------------
  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <Lock className="h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Clôture Annuelle</h2>
        <p className="text-muted-foreground max-w-sm">
          Sélectionnez un client depuis le Registre des Clients pour accéder à
          l'assistant de clôture d'exercice.
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

  const isLocked = closingStatus?.status === "LOCKED"
  const canClose = user?.role === "expert_comptable"

  // -------------------------------------------------------------------------
  // Main view
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clôture Annuelle</h1>
          <p className="text-muted-foreground mt-1">
            Procédure officielle de clôture d'exercice SYSCOHADA — génération des
            écritures de régularisation, calcul du résultat net, verrouillage définitif et
            journal des à-nouveaux.
          </p>
        </div>

        {/* Year selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Exercice</span>
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => {
              setSelectedYear(Number(v))
              setStep1Status("idle")
              setStep1Result(null)
              setStep2Enabled(false)
            }}
          >
            <SelectTrigger className="w-28">
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
        </div>
      </div>

      {/* Navigation tabs */}
      <ClientAccountingNav activeTab="cloture" />

      {/* Loading state */}
      {statusLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Vérification du statut de l'exercice…</span>
        </div>
      )}

      {/* LOCKED banner */}
      {!statusLoading && isLocked && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800 font-semibold">
            Exercice {selectedYear} — Clôturé définitivement
          </AlertTitle>
          <AlertDescription className="text-green-700">
            <div className="mt-1 space-y-1">
              {closingStatus?.lockedAt && (
                <p>
                  Verrouillé le{" "}
                  <strong>{formatDate(new Date(closingStatus.lockedAt))}</strong>
                  {closingStatus.lockedByName ? ` par ${closingStatus.lockedByName}` : ""}
                  {"."}
                </p>
              )}
              {closingStatus?.netResult !== null && closingStatus?.netResult !== undefined && (
                <p>
                  Résultat net :{" "}
                  <strong>
                    {closingStatus.netResult >= 0 ? "Bénéfice" : "Perte"} de{" "}
                    {formatFcfa(Math.abs(closingStatus.netResult))}
                  </strong>{" "}
                  — compte {closingStatus.netResultAccount}.
                </p>
              )}
              {closingStatus?.openingBalanceGenerated && (
                <p>Journal des à-nouveaux généré pour l'exercice {selectedYear + 1}.</p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Role guard */}
      {!isLocked && !canClose && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Accès restreint</AlertTitle>
          <AlertDescription>
            Seul un expert-comptable peut procéder à la clôture définitive d'un exercice.
            Vous pouvez consulter et préparer les étapes, mais le bouton de clôture vous
            est inaccessible.
          </AlertDescription>
        </Alert>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step wizard (shown when period is OPEN)                            */}
      {/* ------------------------------------------------------------------ */}
      {!statusLoading && !isLocked && (
        <div className="space-y-4">

          {/* STEP 1 — Amortissements & Régularisations */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <StepIcon status={step1Status} />
                <div>
                  <CardTitle className="text-base">
                    Étape 1 — Amortissements &amp; Régularisations
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Génère et comptabilise automatiquement les dotations aux amortissements
                    (Cl. 68) et les échéances financières en suspens pour l'exercice{" "}
                    {selectedYear}.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {step1Result && step1Status === "success" && (
                <div className="mb-3 text-sm text-muted-foreground bg-muted/60 rounded-md px-3 py-2 space-y-1">
                  <p>
                    ✓ Dotations aux amortissements :{" "}
                    <strong>{step1Result.depGenerated}</strong> écriture(s) générée(s).
                  </p>
                  <p>
                    ✓ Échéances financières :{" "}
                    <strong>{step1Result.finGenerated}</strong> écriture(s) générée(s).
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ces écritures sont directement comptabilisées et n'apparaissent pas dans
                    la file de validation M3.
                  </p>
                </div>
              )}
              {step1Status === "error" && (
                <Alert variant="destructive" className="mb-3 py-2">
                  <AlertDescription className="text-sm">
                    Une erreur est survenue lors de la génération. Vérifiez les données
                    d'immobilisations et de financements.
                  </AlertDescription>
                </Alert>
              )}
              <Button
                onClick={handleStep1}
                disabled={step1Status === "running" || !canClose}
                variant={step1Status === "success" ? "outline" : "default"}
                size="sm"
                className="gap-2"
              >
                {step1Status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : step1Status === "success" ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <ClipboardCheck className="h-4 w-4" />
                )}
                {step1Status === "success"
                  ? "Régénérer les régularisations"
                  : "Générer les régularisations"}
              </Button>
            </CardContent>
          </Card>

          {/* STEP 2 — Vérification de la Balance */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <StepIcon
                  status={
                    step2Enabled && !balanceLoading
                      ? balanceOk
                        ? "success"
                        : "error"
                      : step2Enabled
                        ? "running"
                        : "idle"
                  }
                />
                <div>
                  <CardTitle className="text-base">
                    Étape 2 — Vérification de la Balance
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Contrôle l'égalité fondamentale de la partie double :{" "}
                    <em>Total Débit = Total Crédit</em>. Tout écart doit être investigué et
                    corrigé avant de procéder à la clôture.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {step2Enabled && !balanceLoading && balanceRows.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm bg-muted/60 rounded-md px-3 py-2">
                    <span className="text-muted-foreground">Total Débit</span>
                    <span className="font-mono font-medium">{formatFcfa(totalDebits)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm bg-muted/60 rounded-md px-3 py-2">
                    <span className="text-muted-foreground">Total Crédit</span>
                    <span className="font-mono font-medium">{formatFcfa(totalCredits)}</span>
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-2 text-sm rounded-md px-3 py-2",
                      balanceOk
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700",
                    )}
                  >
                    {balanceOk ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>
                          <strong>Balance équilibrée</strong> — les livres sont en
                          équilibre.
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>
                          <strong>Écart détecté :</strong>{" "}
                          {formatFcfa(Math.abs(totalDebits - totalCredits))} — investiguer
                          avant de clôturer.
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
              {step2Enabled && !balanceLoading && balanceRows.length === 0 && (
                <p className="text-sm text-muted-foreground mb-3">
                  Aucune écriture comptabilisée pour cet exercice.
                </p>
              )}
              <Button
                onClick={() => setStep2Enabled(true)}
                disabled={balanceLoading}
                variant={balanceOk ? "outline" : "default"}
                size="sm"
                className="gap-2"
              >
                {balanceLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scale className="h-4 w-4" />
                )}
                {step2Enabled && !balanceLoading ? "Rafraîchir la balance" : "Vérifier la balance"}
              </Button>
            </CardContent>
          </Card>

          {/* STEP 3 — Résultat Provisoire */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <StepIcon
                  status={
                    step2Enabled && !compteLoading && compteData
                      ? "success"
                      : step2Enabled && compteLoading
                        ? "running"
                        : "idle"
                  }
                />
                <div>
                  <CardTitle className="text-base">
                    Étape 3 — Calcul du Résultat Provisoire
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Résultat net prévisionnel calculé à partir des produits (Classe 7) et
                    des charges (Classe 6) de l'exercice {selectedYear}, avant l'écriture
                    définitive de clôture.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {step2Enabled && compteLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Calcul en cours…
                </div>
              )}
              {step2Enabled && !compteLoading && compteData && (
                <div className="mb-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm bg-muted/60 rounded-md px-3 py-2">
                    <span className="text-muted-foreground">Total Produits (Cl. 7)</span>
                    <span className="font-mono font-medium text-green-700">
                      {formatFcfa(totalRevenues)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm bg-muted/60 rounded-md px-3 py-2">
                    <span className="text-muted-foreground">Total Charges (Cl. 6)</span>
                    <span className="font-mono font-medium text-red-700">
                      {formatFcfa(totalExpenses)}
                    </span>
                  </div>
                  <Separator />
                  <div
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2.5",
                      netResult >= 0
                        ? "bg-green-50 border border-green-200"
                        : "bg-red-50 border border-red-200",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {netResult >= 0 ? (
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600" />
                      )}
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          netResult >= 0 ? "text-green-800" : "text-red-800",
                        )}
                      >
                        Résultat net provisoire —{" "}
                        {netResult >= 0 ? "Bénéfice" : "Perte"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-mono font-bold text-base",
                          netResult >= 0 ? "text-green-700" : "text-red-700",
                        )}
                      >
                        {formatFcfa(Math.abs(netResult))}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-mono",
                          netResult >= 0
                            ? "border-green-400 text-green-700"
                            : "border-red-400 text-red-700",
                        )}
                      >
                        {netResult >= 0 ? "→ Compte 1301" : "→ Compte 1309"}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}
              {!step2Enabled && (
                <p className="text-sm text-muted-foreground">
                  Effectuez d'abord la vérification de la balance (Étape 2) pour afficher
                  le résultat provisoire.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---------------------------------------------------------------- */}
          {/* Final action zone                                                */}
          {/* ---------------------------------------------------------------- */}
          <Card className="shadow-sm border-2 border-dashed border-muted">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <Lock className="h-4 w-4 text-destructive" />
                    Clôturer Définitivement l'Exercice {selectedYear}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-lg">
                    Cette action est <strong>irréversible</strong>. Elle verrouillera
                    définitivement les journaux de l'exercice, comptabilisera les
                    écritures de clôture et générera le journal des à-nouveaux pour{" "}
                    {selectedYear + 1}.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="lg"
                  disabled={!canClose || closeMutation.isPending}
                  onClick={() => setShowConfirm(true)}
                  className="shrink-0 gap-2"
                >
                  {closeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Clôturer Définitivement
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Confirmation dialog                                                 */}
      {/* ------------------------------------------------------------------ */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Confirmation de clôture — Exercice {selectedYear}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Cette action est <strong>irréversible</strong>. Elle verrouillera
                  définitivement les journaux de l'exercice et générera les écritures de
                  bilan de clôture et d'ouverture.
                </p>
                <div className="bg-muted/60 rounded-md p-3 space-y-1 text-muted-foreground">
                  <p>
                    ① Les écritures de régularisation (dotations, échéances) seront
                    générées et immédiatement comptabilisées.
                  </p>
                  <p>
                    ② Le résultat net sera calculé et affecté au compte{" "}
                    <strong>1301</strong> (bénéfice) ou <strong>1309</strong> (perte).
                  </p>
                  <p>
                    ③ L'exercice sera verrouillé — toute tentative d'ajout
                    d'écriture pour {selectedYear} sera refusée avec une erreur 403.
                  </p>
                  <p>
                    ④ Le journal des à-nouveaux sera généré pour l'exercice{" "}
                    {selectedYear + 1}.
                  </p>
                </div>
                <p className="font-medium text-foreground">
                  Confirmez-vous la clôture définitive de l'exercice {selectedYear} pour
                  ce client ?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!clientId) return
                closeMutation.mutate({ clientId, year: selectedYear })
              }}
              disabled={closeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              {closeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Clôture en cours…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Confirmer la clôture
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
