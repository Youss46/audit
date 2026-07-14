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
import {
  Users,
  Plus,
  Loader2,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  Wallet,
  Landmark,
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
          title: "Paie comptabilisée",
          description: `Écriture #${data.transactionId} générée pour ${data.payslipsPosted} bulletin(s).`,
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
  const totalNet = (payslips ?? []).reduce((s, p) => s + p.netSalary, 0)
  const totalEmployerCost = (payslips ?? []).reduce((s, p) => s + p.totalEmployerCost, 0)
  const totalCnps = (payslips ?? []).reduce(
    (s, p) =>
      s +
      p.cnpsEmployeeAmount +
      p.cnpsEmployerRetraite +
      p.cnpsEmployerPrestationsFamiliales +
      p.cnpsEmployerAccidentTravail,
    0,
  )
  const totalTaxes = (payslips ?? []).reduce(
    (s, p) => s + p.isAmount + p.cnAmount + p.itsAmount + p.taxeApprentissage + p.taxeFormationContinue,
    0,
  )
  const allPosted = (payslips ?? []).length > 0 && (payslips ?? []).every((p) => p.postedTransactionId)
  const anyPosted = (payslips ?? []).some((p) => p.postedTransactionId)

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

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
    const baseSalary = parseInt(employeeForm.baseSalary, 10)
    if (!baseSalary || baseSalary <= 0) {
      setEmployeeError("Le salaire de base doit être un entier positif.")
      return
    }

    const payload = {
      firstName: employeeForm.firstName.trim(),
      lastName: employeeForm.lastName.trim(),
      cnpsNumber: employeeForm.cnpsNumber.trim() || null,
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
                            <TableHead className="text-right">Enfants</TableHead>
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
                              <TableCell className="text-right tabular-nums">
                                {employee.dependentChildren}
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
              ) : payslips && payslips.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground">Bulletins</p>
                        <p className="text-2xl font-bold mt-1">{payslips.length}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground">Total net à payer</p>
                        <p className="text-xl font-bold mt-1 tabular-nums text-primary">{fcfa(totalNet)}</p>
                        <p className="text-xs text-muted-foreground">FCFA</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground">CNPS (salarié + employeur)</p>
                        <p className="text-xl font-bold mt-1 tabular-nums">{fcfa(totalCnps)}</p>
                        <p className="text-xs text-muted-foreground">FCFA</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-xs text-muted-foreground">Coût total employeur</p>
                        <p className="text-xl font-bold mt-1 tabular-nums text-orange-600">{fcfa(totalEmployerCost)}</p>
                        <p className="text-xs text-muted-foreground">FCFA</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-base">Aperçu des bulletins — {period}</CardTitle>
                      {allPosted ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-transparent">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Comptabilisé
                        </Badge>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button disabled={postLedgerMutation.isPending}>
                              {postLedgerMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Landmark className="h-4 w-4 mr-2" />
                              )}
                              Valider et Générer les Écritures Comptables
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Comptabiliser la paie de {period} ?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Une écriture unique et équilibrée sera générée&nbsp;:
                                débit 661 (salaires bruts) et 664 (charges patronales), crédit
                                422 (net à payer), 431 (CNPS) et 447 (ITS/FDFP), pour un
                                total de {fcfa(totalTaxes)} FCFA d&apos;impôts et {fcfa(totalCnps)} FCFA de
                                CNPS. Cette écriture est directement validée et ne peut plus être
                                modifiée.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annuler</AlertDialogCancel>
                              <AlertDialogAction onClick={handlePostLedger}>Valider</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-6">Employé</TableHead>
                              <TableHead className="text-right">Brut</TableHead>
                              <TableHead className="text-right">CNPS (sal.)</TableHead>
                              <TableHead className="text-right">ITS</TableHead>
                              <TableHead className="text-right font-semibold">Net à payer</TableHead>
                              <TableHead className="text-right">Charges patronales</TableHead>
                              <TableHead className="pr-6">Statut</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {payslips.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell className="pl-6 font-medium">{p.employeeName}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">{fcfa(p.grossSalary)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">{fcfa(p.cnpsEmployeeAmount)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">{fcfa(p.itsAmount)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm font-semibold text-primary">{fcfa(p.netSalary)}</TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm text-muted-foreground">
                                  {fcfa(p.totalEmployerCost - p.grossSalary)}
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
              Les cotisations CNPS et l&apos;impôt sur salaire (ITS) seront calculés
              automatiquement lors du traitement de la paie.
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

            <div className="col-span-2">
              <Label>N° d&apos;immatriculation CNPS (optionnel)</Label>
              <Input
                value={employeeForm.cnpsNumber}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, cnpsNumber: e.target.value }))}
              />
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
