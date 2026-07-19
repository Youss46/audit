import { useState } from "react"
import { useRoute } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListEmployees,
  getListEmployeesQueryKey,
  useCreateEmployee,
  useUpdateEmployee,
  useListPayslips,
  getListPayslipsQueryKey,
  useCalculatePayroll,
  usePostPayrollLedger,
} from "@workspace/api-client-react"
import type { MaritalStatus, Employee } from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import { getMaritalStatusLabel, getEmployeeStatusLabel, getEmployeeStatusColor } from "@/lib/status"
import { cn } from "@/lib/utils"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { useAuth } from "@/hooks/use-auth"
import { getToken } from "@/lib/auth"
import {
  Users,
  Plus,
  Loader2,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  Wallet,
  Landmark,
  TrendingDown,
  Receipt,
  Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

// ---------------------------------------------------------------------------
// Module M20 — Gestion de la Paie, ITS & CNPS.
// Accessible at /cabinet/client/:clientId/paie.
// Two tabs: "Employés" (registre CRUD) and "Traitement de la Paie" (calcul
// mensuel en masse -> aperçu -> comptabilisation).
// ---------------------------------------------------------------------------

function fcfa(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("fr-FR")
}

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

interface EmployeeFormState {
  firstName: string
  lastName: string
  cnpsNumber: string
  hireDate: string
  maritalStatus: MaritalStatus
  dependentChildren: string
  baseSalary: string
  transportAllowance: string
  otherTaxablePrimes: string
  workAccidentRate: string
}

function emptyEmployeeForm(): EmployeeFormState {
  return {
    firstName: "",
    lastName: "",
    cnpsNumber: "",
    hireDate: "",
    maritalStatus: "CELIBATAIRE",
    dependentChildren: "0",
    baseSalary: "",
    transportAllowance: "0",
    otherTaxablePrimes: "0",
    workAccidentRate: "2",
  }
}

function formFromEmployee(e: Employee): EmployeeFormState {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    cnpsNumber: e.cnpsNumber ?? "",
    hireDate: e.hireDate ?? "",
    maritalStatus: e.maritalStatus,
    dependentChildren: String(e.dependentChildren),
    baseSalary: String(e.baseSalary),
    transportAllowance: String(e.transportAllowance),
    otherTaxablePrimes: String(e.otherTaxablePrimes),
    workAccidentRate: String(e.workAccidentRate),
  }
}

export default function Paie() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/paie")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const [activeTab, setActiveTab] = useState<"employes" | "traitement">("employes")

  // -- Employee CRUD dialog state --
  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false)
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null)
  const [employeeForm, setEmployeeForm] = useState<EmployeeFormState>(emptyEmployeeForm())
  const [employeeError, setEmployeeError] = useState<string | null>(null)

  // -- Bulk payroll processing state --
  const [period, setPeriod] = useState<string>(currentPeriod())
  const [isExportingCnps, setIsExportingCnps] = useState(false)

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const employeesParams = { clientId: clientId ?? 0 }
  const { data: employees, isLoading: employeesLoading } = useListEmployees(employeesParams, {
    query: { enabled: !!clientId, queryKey: getListEmployeesQueryKey(employeesParams) },
  })

  const payslipsParams = { clientId: clientId ?? 0, period }
  const { data: payslips, isLoading: payslipsLoading } = useListPayslips(payslipsParams, {
    query: { enabled: !!clientId, queryKey: getListPayslipsQueryKey(payslipsParams) },
  })

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const invalidateEmployees = () =>
    queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() })
  const invalidatePayslips = () =>
    queryClient.invalidateQueries({ queryKey: getListPayslipsQueryKey() })

  const createEmployeeMutation = useCreateEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employé enregistré" })
        setShowEmployeeDialog(false)
        invalidateEmployees()
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur s'est produite."
        setEmployeeError(msg)
      },
    },
  })

  const updateEmployeeMutation = useUpdateEmployee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Employé mis à jour" })
        setShowEmployeeDialog(false)
        invalidateEmployees()
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur s'est produite."
        setEmployeeError(msg)
      },
    },
  })

  const calculateMutation = useCalculatePayroll({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Paie calculée",
          description: `${data.payslips.length} bulletin(s) calculé(s)${data.skipped.length ? `, ${data.skipped.length} déjà comptabilisé(s)` : ""}.`,
        })
        invalidatePayslips()
      },
      onError: (err: unknown) => {
        toast({
          title: "Erreur lors du calcul",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        })
      },
    },
  })

  const postLedgerMutation = usePostPayrollLedger({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Paie comptabilisée dans le journal OD",
          description: `La paie du mois a été calculée et comptabilisée dans le journal OD. Écriture #${data.transactionId} — ${data.payslipsPosted} bulletin(s).`,
        })
        invalidatePayslips()
        queryClient.invalidateQueries({ queryKey: ["transactions"] })
      },
      onError: (err: unknown) => {
        toast({
          title: "Erreur lors de la comptabilisation",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        })
      },
    },
  })

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const activeEmployees = employees?.filter((e) => e.status === "ACTIF") ?? []
  const slip = payslips ?? []

  // Summary totals for the consolidated bulletin
  const totalGross = slip.reduce((s, p) => s + p.grossSalary, 0)
  const totalGrossTaxable = slip.reduce((s, p) => s + p.grossTaxable, 0)
  const totalPrimeAnciennete = slip.reduce((s, p) => s + p.primeAnciennete, 0)
  const totalNet = slip.reduce((s, p) => s + p.netSalary, 0)
  const totalCnpsEmployee = slip.reduce((s, p) => s + p.cnpsEmployeeAmount, 0)
  const totalCnpsEmployer = slip.reduce(
    (s, p) =>
      s +
      p.cnpsEmployerRetraite +
      p.cnpsEmployerPrestationsFamiliales +
      p.cnpsEmployerAccidentTravail,
    0,
  )
  const totalCnps = totalCnpsEmployee + totalCnpsEmployer
  const totalIts = slip.reduce((s, p) => s + p.itsAmount, 0)
  const totalFdfp = slip.reduce((s, p) => s + p.taxeApprentissage + p.taxeFormationContinue, 0)
  const totalTaxes = totalIts + totalFdfp                // → crédit 4471
  const totalEmployerCharges = slip.reduce(            // → débit 664
    (s, p) =>
      s +
      p.cnpsEmployerRetraite +
      p.cnpsEmployerPrestationsFamiliales +
      p.cnpsEmployerAccidentTravail +
      p.taxeApprentissage +
      p.taxeFormationContinue,
    0,
  )

  const allPosted = slip.length > 0 && slip.every((p) => p.postedTransactionId)
  const anyPosted = slip.some((p) => p.postedTransactionId)
  const isExpertComptable = user?.role === "expert_comptable"

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  async function handleExportCnps() {
    if (!clientId || slip.length === 0) return
    setIsExportingCnps(true)
    try {
      const token = getToken()
      const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? ""
      const url = `${apiBase}/api/payroll/cnps-bordereau/${clientId}/${period}`
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? "Erreur lors de la génération du bordereau CNPS.")
      }
      const blob = await res.blob()
      const anchor = document.createElement("a")
      anchor.href = URL.createObjectURL(blob)
      anchor.download = `bordereau-cnps-${period}.pdf`
      anchor.click()
      URL.revokeObjectURL(anchor.href)
    } catch (err) {
      toast({
        title: "Export CNPS impossible",
        description: err instanceof Error ? err.message : "Une erreur s'est produite.",
        variant: "destructive",
      })
    } finally {
      setIsExportingCnps(false)
    }
  }

  function openCreateEmployee() {
    setEditingEmployeeId(null)
    setEmployeeForm(emptyEmployeeForm())
    setEmployeeError(null)
    setShowEmployeeDialog(true)
  }

  function openEditEmployee(employee: Employee) {
    setEditingEmployeeId(employee.id)
    setEmployeeForm(formFromEmployee(employee))
    setEmployeeError(null)
    setShowEmployeeDialog(true)
  }

  function handleEmployeeSubmit() {
    setEmployeeError(null)
    if (!clientId) return
    if (!employeeForm.firstName.trim() || !employeeForm.lastName.trim()) {
      setEmployeeError("Le prénom et le nom sont requis.")
      return
    }
    if (!employeeForm.hireDate) {
      setEmployeeError("La date d'embauche est obligatoire.")
      return
    }
    const baseSalary = parseInt(employeeForm.baseSalary, 10)
    if (!baseSalary || baseSalary <= 0) {
      setEmployeeError("Le salaire de base doit être un entier positif.")
      return
    }

    const payload = {
      firstName: employeeForm.firstName.trim(),
      lastName: employeeForm.lastName.trim(),
      cnpsNumber: employeeForm.cnpsNumber.trim() || null,
      hireDate: employeeForm.hireDate,
      maritalStatus: employeeForm.maritalStatus,
      dependentChildren: parseInt(employeeForm.dependentChildren, 10) || 0,
      baseSalary,
      transportAllowance: parseInt(employeeForm.transportAllowance, 10) || 0,
      otherTaxablePrimes: parseInt(employeeForm.otherTaxablePrimes, 10) || 0,
      workAccidentRate: parseFloat(employeeForm.workAccidentRate) || 0,
    }

    if (editingEmployeeId) {
      updateEmployeeMutation.mutate({ id: editingEmployeeId, data: payload })
    } else {
      createEmployeeMutation.mutate({ data: { clientId, ...payload } })
    }
  }

  function toggleEmployeeStatus(employee: Employee) {
    updateEmployeeMutation.mutate({
      id: employee.id,
      data: { status: employee.status === "ACTIF" ? "INACTIF" : "ACTIF" },
    })
  }

  function handleCalculate() {
    if (!clientId) return
    calculateMutation.mutate({ clientId, period })
  }

  function handlePostLedger() {
    if (!clientId) return
    postLedgerMutation.mutate({ clientId, period })
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <ClientAccountingNav activeTab="paie" />

      {!clientId ? (
        <Card className="shadow-sm">
          <CardContent className="p-16 flex flex-col items-center justify-center gap-4 text-center text-muted-foreground">
            <Wallet className="h-10 w-10 opacity-20" />
            <div>
              <p className="font-medium">Sélectionnez un client</p>
              <p className="text-sm mt-1">
                Choisissez un client dans le menu ci-dessus pour accéder à sa gestion de la paie.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Gestion de la Paie</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Module M20 — Salaires, ITS &amp; CNPS (Côte d&apos;Ivoire)
              </p>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList>
              <TabsTrigger value="employes">Employés</TabsTrigger>
              <TabsTrigger value="traitement">Traitement de la Paie</TabsTrigger>
            </TabsList>

            {/* ================================================================ */}
            {/* Tab: Employés (CRUD)                                             */}
            {/* ================================================================ */}
            <TabsContent value="employes" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {activeEmployees.length} employé(s) actif(s) sur {employees?.length ?? 0}
                </p>
                <Button onClick={openCreateEmployee}>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter un employé
                </Button>
              </div>

              <Card>
                <CardContent className="p-0">
                  {employeesLoading ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Chargement…
                    </div>
                  ) : !employees || employees.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
                      <Users className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Aucun employé enregistré.</p>
                      <p className="text-xs">Cliquez sur «&nbsp;Ajouter&nbsp;» pour commencer.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-6">Nom</TableHead>
                            <TableHead>N° CNPS</TableHead>
                            <TableHead>Situation</TableHead>
                            <TableHead>Date d&apos;embauche</TableHead>
                            <TableHead className="text-right">Salaire de base</TableHead>
                            <TableHead className="text-right">Prime transport</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead className="pr-6 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employees.map((employee) => (
                            <TableRow key={employee.id}>
                              <TableCell className="pl-6 font-medium">
                                {employee.firstName} {employee.lastName}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {employee.cnpsNumber ?? "—"}
                              </TableCell>
                              <TableCell className="text-sm">
                                {getMaritalStatusLabel(employee.maritalStatus)}
                              </TableCell>
                              <TableCell className="text-sm tabular-nums">
                                {employee.hireDate
                                  ? new Date(employee.hireDate).toLocaleDateString("fr-FR")
                                  : <span className="text-muted-foreground italic text-xs">Non renseignée</span>}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-mono text-sm">
                                {fcfa(employee.baseSalary)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-mono text-sm">
                                {fcfa(employee.transportAllowance)}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={cn("border-transparent text-xs", getEmployeeStatusColor(employee.status))}
                                >
                                  {getEmployeeStatusLabel(employee.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="pr-6 text-right space-x-1">
                                <Button variant="ghost" size="sm" onClick={() => openEditEmployee(employee)}>
                                  Modifier
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-destructive"
                                  disabled={updateEmployeeMutation.isPending}
                                  onClick={() => toggleEmployeeStatus(employee)}
                                >
                                  {employee.status === "ACTIF" ? "Désactiver" : "Réactiver"}
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

            {/* ================================================================ */}
            {/* Tab: Traitement de la Paie (bulk processing)                     */}
            {/* ================================================================ */}
            <TabsContent value="traitement" className="space-y-4 mt-4">
              <Card>
                <CardContent className="pt-4 pb-4 flex flex-wrap items-end gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
                      Période
                    </Label>
                    <Input
                      type="month"
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                      className="w-44"
                    />
                  </div>
                  <Button
                    onClick={handleCalculate}
                    disabled={calculateMutation.isPending || activeEmployees.length === 0}
                  >
                    {calculateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Calculator className="h-4 w-4 mr-2" />
                    )}
                    Calculer la paie
                  </Button>
                  {slip.length > 0 && (
                    <Button
                      variant="outline"
                      onClick={handleExportCnps}
                      disabled={isExportingCnps}
                      title="Télécharger le bordereau CNPS mensuel en PDF"
                    >
                      {isExportingCnps ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Bordereau CNPS
                    </Button>
                  )}
                  {activeEmployees.length === 0 && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Aucun employé actif — ajoutez des employés dans l&apos;onglet «&nbsp;Employés&nbsp;».
                    </p>
                  )}
                </CardContent>
              </Card>

              {payslipsLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Chargement…
                </div>
              ) : slip.length > 0 ? (
                <>
                  {/* ---- KPI summary cards ---- */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Bulletins</p>
                        <p className="text-2xl font-bold mt-1">{slip.length}</p>
                        <p className="text-xs text-muted-foreground">{activeEmployees.length} employé(s) actif(s)</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Salaire brut total</p>
                        <p className="text-xl font-bold mt-1 tabular-nums">{fcfa(totalGross)}</p>
                        <p className="text-xs text-muted-foreground">dont brut imposable {fcfa(totalGrossTaxable)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Net à payer</p>
                        <p className="text-xl font-bold mt-1 tabular-nums text-primary">{fcfa(totalNet)}</p>
                        <p className="text-xs text-muted-foreground">FCFA — Cpte 422</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Charges patronales</p>
                        <p className="text-xl font-bold mt-1 tabular-nums text-orange-600">{fcfa(totalEmployerCharges)}</p>
                        <p className="text-xs text-muted-foreground">FCFA — Cpte 664</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* ---- Récapitulatif fiscal & social ---- */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Card className="border-dashed">
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">CNPS salarié (6,3 %)</p>
                        <p className="text-lg font-semibold mt-1 tabular-nums">{fcfa(totalCnpsEmployee)}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-dashed">
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">CNPS patronale (AT + retraite + PF)</p>
                        <p className="text-lg font-semibold mt-1 tabular-nums">{fcfa(totalCnpsEmployer)}</p>
                        <p className="text-xs text-muted-foreground">Total CNPS à reverser : {fcfa(totalCnps)}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-dashed">
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">ITS / IGR (État)</p>
                        <p className="text-lg font-semibold mt-1 tabular-nums">{fcfa(totalIts)}</p>
                        <p className="text-xs text-muted-foreground">+ FDFP {fcfa(totalFdfp)} → Cpte 4471</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* ---- Tableau des bulletins individuels ---- */}
                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 flex-wrap">
                      <div>
                        <CardTitle className="text-base">Récapitulatif des bulletins — {period}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Centralisation de la paie — Journal OD
                        </p>
                      </div>
                      {allPosted ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-transparent">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Comptabilisé dans le journal OD
                        </Badge>
                      ) : isExpertComptable ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button disabled={postLedgerMutation.isPending}>
                              {postLedgerMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Landmark className="h-4 w-4 mr-2" />
                              )}
                              Générer les écritures de paie
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Comptabiliser la paie de {period} dans le journal OD ?
                              </AlertDialogTitle>
                              <AlertDialogDescription asChild>
                                <div className="space-y-3 text-sm">
                                  <p>
                                    Une écriture OD unique et équilibrée sera générée pour{" "}
                                    <strong>{slip.length} bulletin(s)</strong> :
                                  </p>
                                  <div className="rounded-md border text-xs font-mono divide-y">
                                    <div className="flex justify-between px-3 py-1.5">
                                      <span className="text-muted-foreground">Débit 6611 — Salaires bruts</span>
                                      <span className="font-semibold">{fcfa(totalGross)} FCFA</span>
                                    </div>
                                    <div className="flex justify-between px-3 py-1.5">
                                      <span className="text-muted-foreground">Débit 664 — Charges patronales</span>
                                      <span className="font-semibold">{fcfa(totalEmployerCharges)} FCFA</span>
                                    </div>
                                    <div className="flex justify-between px-3 py-1.5 bg-muted/40">
                                      <span className="text-muted-foreground">Crédit 422 — Net à payer</span>
                                      <span>{fcfa(totalNet)} FCFA</span>
                                    </div>
                                    <div className="flex justify-between px-3 py-1.5 bg-muted/40">
                                      <span className="text-muted-foreground">Crédit 4311 — CNPS à reverser</span>
                                      <span>{fcfa(totalCnps)} FCFA</span>
                                    </div>
                                    <div className="flex justify-between px-3 py-1.5 bg-muted/40">
                                      <span className="text-muted-foreground">Crédit 4471 — ITS &amp; Taxes</span>
                                      <span>{fcfa(totalTaxes)} FCFA</span>
                                    </div>
                                  </div>
                                  <p className="text-muted-foreground">
                                    Cette écriture est directement validée dans le Grand Livre et
                                    ne peut plus être modifiée.
                                  </p>
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annuler</AlertDialogCancel>
                              <AlertDialogAction onClick={handlePostLedger}>
                                Valider et comptabiliser
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          <Receipt className="h-3.5 w-3.5 mr-1" />
                          Comptabilisation réservée à l&apos;expert-comptable
                        </Badge>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="text-xs">
                              <TableHead className="pl-6">Employé</TableHead>
                              <TableHead className="text-right">Brut imposable</TableHead>
                              <TableHead className="text-right">Ancienneté</TableHead>
                              <TableHead className="text-right">Brut total</TableHead>
                              <TableHead className="text-right">CNPS sal.</TableHead>
                              <TableHead className="text-right">ITS</TableHead>
                              <TableHead className="text-right font-semibold">Net à payer</TableHead>
                              <TableHead className="text-right">CNPS pat.</TableHead>
                              <TableHead className="text-right">FDFP</TableHead>
                              <TableHead className="pr-6">Statut</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {slip.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell className="pl-6 font-medium text-sm">{p.employeeName}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">{fcfa(p.grossTaxable)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-xs">
                                  {p.primeAnciennete > 0 ? (
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">{fcfa(p.primeAnciennete)}</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">{fcfa(p.grossSalary)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">{fcfa(p.cnpsEmployeeAmount)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">{fcfa(p.itsAmount)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm font-semibold text-primary">{fcfa(p.netSalary)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">
                                  {fcfa(p.cnpsEmployerRetraite + p.cnpsEmployerPrestationsFamiliales + p.cnpsEmployerAccidentTravail)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">
                                  {fcfa(p.taxeApprentissage + p.taxeFormationContinue)}
                                </TableCell>
                                <TableCell className="pr-6">
                                  {p.postedTransactionId ? (
                                    <Badge variant="outline" className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-transparent">
                                      Comptabilisé
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-xs">Calculé</Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          {/* Totals row */}
                          <tfoot>
                            <TableRow className="bg-muted/50 font-semibold text-sm border-t-2">
                              <TableCell className="pl-6">
                                <span className="flex items-center gap-1.5">
                                  <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
                                  Total ({slip.length})
                                </span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">{fcfa(totalGrossTaxable)}</TableCell>
                              <TableCell className="text-right tabular-nums font-mono text-xs text-amber-600 dark:text-amber-400">
                                {totalPrimeAnciennete > 0 ? fcfa(totalPrimeAnciennete) : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-mono">{fcfa(totalGross)}</TableCell>
                              <TableCell className="text-right tabular-nums font-mono">{fcfa(totalCnpsEmployee)}</TableCell>
                              <TableCell className="text-right tabular-nums font-mono">{fcfa(totalIts)}</TableCell>
                              <TableCell className="text-right tabular-nums font-mono text-primary">{fcfa(totalNet)}</TableCell>
                              <TableCell className="text-right tabular-nums font-mono text-xs">{fcfa(totalCnpsEmployer)}</TableCell>
                              <TableCell className="text-right tabular-nums font-mono text-xs">{fcfa(totalFdfp)}</TableCell>
                              <TableCell className="pr-6" />
                            </TableRow>
                          </tfoot>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                  {anyPosted && !allPosted && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Certains bulletins de cette période ont déjà été comptabilisés lors d&apos;un
                      recalcul précédent — ils ne seront pas dupliqués.
                    </p>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="p-16 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                    <Calculator className="h-8 w-8 opacity-30" />
                    <p className="text-sm">Aucun bulletin calculé pour {period}.</p>
                    <p className="text-xs">
                      Cliquez sur «&nbsp;Calculer la paie&nbsp;» pour générer l&apos;aperçu.
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Employee create/edit dialog                                          */}
      {/* -------------------------------------------------------------------- */}
      <Dialog open={showEmployeeDialog} onOpenChange={setShowEmployeeDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEmployeeId ? "Modifier l'employé" : "Ajouter un employé"}</DialogTitle>
            <DialogDescription>
              Les cotisations CNPS, l&apos;impôt sur salaire (ITS) et la prime d&apos;ancienneté
              seront calculés automatiquement lors du traitement de la paie.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div>
                <Label>Prénom</Label>
                <Input
                  value={employeeForm.firstName}
                  onChange={(e) => setEmployeeForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div>
                <Label>Nom</Label>
                <Input
                  value={employeeForm.lastName}
                  onChange={(e) => setEmployeeForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label>N° d&apos;immatriculation CNPS (optionnel)</Label>
              <Input
                value={employeeForm.cnpsNumber}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, cnpsNumber: e.target.value }))}
              />
            </div>

            <div>
              <Label>
                Date d&apos;embauche <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={employeeForm.hireDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, hireDate: e.target.value }))}
                className={!employeeForm.hireDate ? "border-muted" : ""}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Sert au calcul automatique de la prime d&apos;ancienneté.
              </p>
            </div>

            <div>
              <Label>Situation matrimoniale</Label>
              <Select
                value={employeeForm.maritalStatus}
                onValueChange={(v) => setEmployeeForm((f) => ({ ...f, maritalStatus: v as MaritalStatus }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CELIBATAIRE">Célibataire</SelectItem>
                  <SelectItem value="MARIE">Marié(e)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Enfants à charge</Label>
              <Input
                type="number"
                min={0}
                value={employeeForm.dependentChildren}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, dependentChildren: e.target.value }))}
              />
            </div>

            <Separator className="col-span-2" />

            <div>
              <Label>Salaire de base (FCFA)</Label>
              <AmountInput
                min={1}
                value={employeeForm.baseSalary}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, baseSalary: e.target.value }))}
              />
            </div>
            <div>
              <Label>Prime de transport (FCFA)</Label>
              <AmountInput
                min={0}
                value={employeeForm.transportAllowance}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, transportAllowance: e.target.value }))}
              />
            </div>
            <div>
              <Label>Autres primes imposables (FCFA)</Label>
              <AmountInput
                min={0}
                value={employeeForm.otherTaxablePrimes}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, otherTaxablePrimes: e.target.value }))}
              />
            </div>
            <div>
              <Label>Taux Accidents du Travail (%)</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={employeeForm.workAccidentRate}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, workAccidentRate: e.target.value }))}
              />
            </div>
          </div>

          {employeeError && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              {employeeError}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmployeeDialog(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleEmployeeSubmit}
              disabled={createEmployeeMutation.isPending || updateEmployeeMutation.isPending}
            >
              {(createEmployeeMutation.isPending || updateEmployeeMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingEmployeeId ? "Enregistrer" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
