import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListInvoices,
  useCreateInvoice,
  useGetInvoice,
  useUpdateInvoice,
  useValidateInvoice,
  useMarkInvoicePaid,
  useCancelInvoice,
  downloadInvoicePdf,
  useCreateCreditNote,
  useListMobileMoneyAccounts,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
} from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  FileText,
  Plus,
  Trash2,
  Download,
  CheckCircle2,
  XCircle,
  CreditCard,
  RotateCcw,
  Edit3,
  Eye,
  ChevronRight,
  Loader2,
  Receipt,
  TrendingUp,
  Clock,
  Ban,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type InvoiceStatus = "BROUILLON" | "VALIDE" | "PAYE" | "ANNULE"

interface ItemRow {
  _key: string
  designation: string
  quantity: string
  unitPrice: string
  vatRate: string
}

interface InvoiceForm {
  customerName: string
  customerEmail: string
  customerAddress: string
  invoiceDate: string
  dueDate: string
  vatRate: string
  notes: string
  items: ItemRow[]
}

const emptyItem = (): ItemRow => ({
  _key:        crypto.randomUUID(),
  designation: "",
  quantity:    "1",
  unitPrice:   "",
  vatRate:     "18",
})

const emptyForm = (clientId: number): InvoiceForm => ({
  customerName:    "",
  customerEmail:   "",
  customerAddress: "",
  invoiceDate:     new Date().toISOString().slice(0, 10),
  dueDate:         "",
  vatRate:         "18",
  notes:           "",
  items:           [emptyItem()],
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtFcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA"
}

const MOBILE_MONEY_PROVIDER_LABELS: Record<string, string> = {
  wave: "Wave",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov_money: "Moov Money",
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function computeItemTotals(items: ItemRow[], defaultVatRate: number) {
  const subtotalHt = items.reduce((sum, it) => {
    const qty   = parseInt(it.quantity, 10)  || 0
    const price = parseInt(it.unitPrice, 10) || 0
    return sum + qty * price
  }, 0)
  const vatRate   = parseInt(items[0]?.vatRate || String(defaultVatRate), 10) || defaultVatRate
  const vatAmount = Math.round(subtotalHt * defaultVatRate / 100)
  return { subtotalHt, vatAmount, totalTtc: subtotalHt + vatAmount }
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; icon: React.ReactNode }> = {
  BROUILLON: {
    label: "Brouillon",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    icon:  <Clock className="h-3 w-3" />,
  },
  VALIDE: {
    label: "Validée",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    icon:  <CheckCircle2 className="h-3 w-3" />,
  },
  PAYE: {
    label: "Payée",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon:  <CreditCard className="h-3 w-3" />,
  },
  ANNULE: {
    label: "Annulée",
    color: "bg-red-50 text-red-600 border-red-200",
    icon:  <Ban className="h-3 w-3" />,
  },
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.BROUILLON
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        cfg.color,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function Facturation() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const clientId = user?.clientId ?? 0

  // ── State ──────────────────────────────────────────────────────────────
  const [activeTab,         setActiveTab]         = React.useState<string>("tous")
  const [sheetOpen,         setSheetOpen]         = React.useState(false)
  const [editingId,         setEditingId]         = React.useState<number | null>(null)
  const [viewingId,         setViewingId]         = React.useState<number | null>(null)
  const [creditNoteTarget,  setCreditNoteTarget]  = React.useState<number | null>(null)
  const [creditNoteReason,  setCreditNoteReason]  = React.useState("")
  const [cancelTarget,      setCancelTarget]      = React.useState<number | null>(null)
  const [downloadingId,     setDownloadingId]     = React.useState<number | null>(null)
  const [form,              setForm]              = React.useState<InvoiceForm>(emptyForm(clientId))
  const [paymentTargetId,   setPaymentTargetId]   = React.useState<number | null>(null)
  const [paymentMethod,     setPaymentMethod]     = React.useState<"especes" | "mobile_money" | "cheque" | "virement">("especes")
  const [paymentAccountId,  setPaymentAccountId]  = React.useState<string>("")
  const [paymentFee,        setPaymentFee]        = React.useState<string>("0")
  const [paymentReference,  setPaymentReference]  = React.useState<string>("")

  // ── Queries ────────────────────────────────────────────────────────────
  const statusFilter = activeTab !== "tous" ? activeTab.toUpperCase() as InvoiceStatus : undefined
  const invoicesQuery = useListInvoices(
    { clientId: clientId || undefined, status: statusFilter },
    { query: { enabled: !!clientId } },
  )
  const invoices = invoicesQuery.data ?? []

  const viewInvoiceQuery = useGetInvoice(
    viewingId ?? 0,
    { query: { enabled: !!viewingId } },
  )

  // ── Stats ──────────────────────────────────────────────────────────────
  const allInvoices = useListInvoices(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId } },
  ).data ?? []

  const stats = React.useMemo(() => {
    const brouillon = allInvoices.filter((i) => i.status === "BROUILLON")
    const valide    = allInvoices.filter((i) => i.status === "VALIDE")
    const paye      = allInvoices.filter((i) => i.status === "PAYE")
    return {
      brouillonCount: brouillon.length,
      pendingTtc:  valide.reduce((s, i) => s + i.totalTtc, 0),
      validCount:  valide.length,
      paidTtc:     paye.reduce((s, i) => s + i.totalTtc, 0),
      paidCount:   paye.length,
    }
  }, [allInvoices])

  // ── Mutations ──────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() })
    if (viewingId) queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(viewingId) })
  }

  const createMutation = useCreateInvoice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Brouillon enregistré", description: "La facture a été créée avec succès." })
        setSheetOpen(false)
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Impossible de créer la facture.", variant: "destructive" }),
    },
  })

  const updateMutation = useUpdateInvoice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Brouillon mis à jour" })
        setSheetOpen(false)
        setEditingId(null)
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Impossible de modifier la facture.", variant: "destructive" }),
    },
  })

  const validateMutation = useValidateInvoice({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "✅ Facture validée",
          description: `${data.invoiceNumber} — PDF généré et écriture comptable enregistrée.`,
        })
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Validation impossible.", variant: "destructive" }),
    },
  })

  const markPaidMutation = useMarkInvoicePaid({
    mutation: {
      onSuccess: () => {
        toast({ title: "Facture marquée comme payée" })
        closePaymentDialog()
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Règlement impossible.", variant: "destructive" }),
    },
  })

  // ── Payment dialog ("Enregistrer un règlement") ──────────────────────────
  const paymentTarget = invoices.find((i) => i.id === paymentTargetId) ?? allInvoices.find((i) => i.id === paymentTargetId) ?? null

  const mobileMoneyAccountsQuery = useListMobileMoneyAccounts(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId && paymentMethod === "mobile_money" && !!paymentTargetId } },
  )
  const mobileMoneyAccounts = (mobileMoneyAccountsQuery.data ?? []).filter((a) => a.isActive !== "false")

  const openPaymentDialog = (invoiceId: number) => {
    setPaymentTargetId(invoiceId)
    setPaymentMethod("especes")
    setPaymentAccountId("")
    setPaymentFee("0")
    setPaymentReference("")
  }

  const closePaymentDialog = () => {
    setPaymentTargetId(null)
  }

  const confirmPayment = () => {
    if (!paymentTargetId) return
    if (paymentMethod !== "mobile_money") {
      markPaidMutation.mutate({ id: paymentTargetId, data: { paymentMethod } })
      return
    }
    if (!paymentAccountId) {
      toast({ title: "Compte Mobile Money requis", description: "Sélectionnez le compte qui a reçu le règlement.", variant: "destructive" })
      return
    }
    markPaidMutation.mutate({
      id: paymentTargetId,
      data: {
        paymentMethod: "mobile_money",
        mobileMoneyAccountId: Number(paymentAccountId),
        feeAmount: Number(paymentFee) || 0,
        referenceCode: paymentReference.trim() || undefined,
      },
    })
  }

  const cancelMutation = useCancelInvoice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Brouillon annulé" })
        setCancelTarget(null)
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error, variant: "destructive" }),
    },
  })

  const creditNoteMutation = useCreateCreditNote({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Avoir émis",
          description: `${data.invoiceNumber} créé et comptabilisé.`,
        })
        setCreditNoteTarget(null)
        setCreditNoteReason("")
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error, variant: "destructive" }),
    },
  })

  // ── Form helpers ───────────────────────────────────────────────────────
  const openCreateSheet = () => {
    setEditingId(null)
    setForm(emptyForm(clientId))
    setSheetOpen(true)
  }

  const openEditSheet = (inv: (typeof allInvoices)[number]) => {
    setEditingId(inv.id)
    setForm({
      customerName:    inv.customerName,
      customerEmail:   inv.customerEmail ?? "",
      customerAddress: inv.customerAddress ?? "",
      invoiceDate:     new Date(inv.invoiceDate).toISOString().slice(0, 10),
      dueDate:         inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : "",
      vatRate:         String(inv.vatRate),
      notes:           inv.notes ?? "",
      items:           (inv as any).items?.map((it: any) => ({
        _key:        crypto.randomUUID(),
        designation: it.designation,
        quantity:    String(it.quantity),
        unitPrice:   String(it.unitPrice),
        vatRate:     String(it.vatRate),
      })) ?? [emptyItem()],
    })
    setSheetOpen(true)
  }

  const updateItem = (key: string, field: keyof Omit<ItemRow, "_key">, value: string) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => it._key === key ? { ...it, [field]: value } : it),
    }))
  }

  const removeItem = (key: string) => {
    setForm((f) => ({ ...f, items: f.items.filter((it) => it._key !== key) }))
  }

  const vatRate   = parseInt(form.vatRate, 10) || 18
  const { subtotalHt, vatAmount, totalTtc } = computeItemTotals(form.items, vatRate)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.customerName.trim()) return
    const items = form.items
      .filter((it) => it.designation.trim() && parseInt(it.unitPrice, 10) > 0)
      .map((it) => ({
        designation: it.designation,
        quantity:    parseInt(it.quantity, 10)  || 1,
        unitPrice:   parseInt(it.unitPrice, 10) || 0,
        vatRate:     parseInt(it.vatRate, 10)   || vatRate,
      }))
    if (!items.length) {
      toast({ title: "Erreur", description: "Ajoutez au moins une ligne avec un prix.", variant: "destructive" })
      return
    }

    const payload = {
      clientId:        clientId,
      customerName:    form.customerName.trim(),
      customerEmail:   form.customerEmail.trim() || null,
      customerAddress: form.customerAddress.trim() || null,
      vatRate,
      invoiceDate:     new Date(form.invoiceDate).toISOString(),
      dueDate:         form.dueDate ? new Date(form.dueDate).toISOString() : null,
      notes:           form.notes.trim() || null,
      items,
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload })
    } else {
      createMutation.mutate({ data: payload })
    }
  }

  const handleDownloadPdf = async (invoiceId: number, invoiceNumber: string) => {
    setDownloadingId(invoiceId)
    try {
      const result = await downloadInvoicePdf(invoiceId)
      const bytes  = atob(result.fileData)
      const buf    = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
      const blob = new Blob([buf], { type: result.mimeType })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = result.fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: "Erreur", description: "Impossible de télécharger le PDF.", variant: "destructive" })
    } finally {
      setDownloadingId(null)
    }
  }

  // ── Derived list (tab already filtered server-side, secondary filter UI) ──
  const isLoading = invoicesQuery.isLoading

  const renderActions = (inv: (typeof invoices)[number], opts?: { alwaysVisible?: boolean }) => (
    <div
      className={cn(
        "flex items-center justify-end gap-1 transition-opacity",
        opts?.alwaysVisible ? "" : "opacity-0 group-hover:opacity-100",
      )}
    >
      {/* View */}
      <ActionBtn tip="Détail" onClick={() => setViewingId(inv.id)}>
        <Eye className="h-3.5 w-3.5" />
      </ActionBtn>

      {/* Edit (BROUILLON only) */}
      {inv.status === "BROUILLON" && (
        <ActionBtn tip="Modifier" onClick={() => openEditSheet(inv)}>
          <Edit3 className="h-3.5 w-3.5" />
        </ActionBtn>
      )}

      {/* Validate (BROUILLON) */}
      {inv.status === "BROUILLON" && (
        <ActionBtn
          tip="Valider et générer le PDF"
          onClick={() => validateMutation.mutate({ id: inv.id })}
          loading={validateMutation.isPending}
          className="text-blue-600 hover:bg-blue-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </ActionBtn>
      )}

      {/* Download PDF (VALIDE / PAYE) */}
      {(inv.status === "VALIDE" || inv.status === "PAYE") && inv.pdfDocumentId && (
        <ActionBtn
          tip="Télécharger le PDF"
          onClick={() => handleDownloadPdf(inv.id, inv.invoiceNumber ?? "")}
          loading={downloadingId === inv.id}
          className="text-blue-600 hover:bg-blue-50"
        >
          <Download className="h-3.5 w-3.5" />
        </ActionBtn>
      )}

      {/* Mark paid (VALIDE) */}
      {inv.status === "VALIDE" && (
        <ActionBtn
          tip="Enregistrer un règlement"
          onClick={() => openPaymentDialog(inv.id)}
          className="text-emerald-600 hover:bg-emerald-50"
        >
          <CreditCard className="h-3.5 w-3.5" />
        </ActionBtn>
      )}

      {/* Credit note (VALIDE / PAYE) */}
      {(inv.status === "VALIDE" || inv.status === "PAYE") && (
        <ActionBtn
          tip="Émettre un avoir"
          onClick={() => { setCreditNoteTarget(inv.id); setCreditNoteReason("") }}
          className="text-amber-600 hover:bg-amber-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </ActionBtn>
      )}

      {/* Cancel (BROUILLON only) */}
      {inv.status === "BROUILLON" && (
        <ActionBtn
          tip="Annuler"
          onClick={() => setCancelTarget(inv.id)}
          className="text-destructive hover:bg-destructive/10"
        >
          <XCircle className="h-3.5 w-3.5" />
        </ActionBtn>
      )}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/20">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="border-b bg-background px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-7xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 sm:text-2xl">
              <Receipt className="h-5 w-5 text-primary shrink-0 sm:h-6 sm:w-6" />
              Mon Facturier
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Créez et gérez vos factures clients. Les PDF sont générés automatiquement et comptabilisés dans votre dossier.
            </p>
          </div>
          <Button onClick={openCreateSheet} className="gap-2 w-full sm:w-auto sm:shrink-0">
            <Plus className="h-4 w-4" />
            Nouvelle facture
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6 sm:px-6">

        {/* ── Stats cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <StatCard
            icon={<Clock className="h-5 w-5 text-slate-500" />}
            label="En attente de validation"
            value={stats.brouillonCount}
            sub="brouillon(s)"
            color="bg-slate-50 border-slate-200"
          />
          <StatCard
            icon={<FileText className="h-5 w-5 text-blue-500" />}
            label="Factures validées"
            value={fmtFcfa(stats.pendingTtc)}
            sub={`${stats.validCount} facture(s) à encaisser`}
            color="bg-blue-50 border-blue-200"
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5 text-emerald-500" />}
            label="Total encaissé"
            value={fmtFcfa(stats.paidTtc)}
            sub={`${stats.paidCount} facture(s) payée(s)`}
            color="bg-emerald-50 border-emerald-200"
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5 text-primary" />}
            label="Total émis"
            value={allInvoices.filter((i) => i.status !== "ANNULE").length}
            sub="facture(s) au total"
            color="bg-primary/5 border-primary/20"
          />
        </div>

        {/* ── Invoice grid ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Suivi des factures</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="border-b px-4 overflow-x-auto">
                <TabsList className="h-10 bg-transparent gap-1 p-0 w-max min-w-full sm:w-auto">
                  {[
                    { value: "tous",      label: "Toutes" },
                    { value: "brouillon", label: "Brouillons" },
                    { value: "valide",    label: "Validées" },
                    { value: "paye",      label: "Payées" },
                    { value: "annule",    label: "Annulées" },
                  ].map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      className="h-10 shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                    >
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <TabsContent value={activeTab} className="m-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Chargement…
                  </div>
                ) : invoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                    <Receipt className="h-10 w-10 opacity-20" />
                    <p className="text-sm font-medium">Aucune facture</p>
                    <p className="text-xs">Cliquez sur "Nouvelle facture" pour commencer.</p>
                  </div>
                ) : (
                  <>
                    {/* ── Mobile card list (< md) ─────────────────────────── */}
                    <div className="divide-y md:hidden">
                      {invoices.map((inv) => (
                        <div key={inv.id} className="p-4 space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-mono text-xs font-semibold text-primary truncate">
                                {inv.invoiceNumber ?? (
                                  <span className="font-normal text-muted-foreground italic">brouillon</span>
                                )}
                              </p>
                              <p className="font-medium leading-tight mt-0.5 truncate">{inv.customerName}</p>
                              {inv.customerEmail && (
                                <p className="text-xs text-muted-foreground truncate">{inv.customerEmail}</p>
                              )}
                            </div>
                            <StatusBadge status={inv.status as InvoiceStatus} />
                          </div>

                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{fmtDate(inv.invoiceDate)}</span>
                            {inv.dueDate && <span>Échéance : {fmtDate(inv.dueDate)}</span>}
                          </div>

                          <p className="text-right font-semibold tabular-nums text-base break-all">
                            {fmtFcfa(inv.totalTtc)}
                          </p>

                          {renderActions(inv, { alwaysVisible: true })}
                        </div>
                      ))}
                    </div>

                    {/* ── Desktop table (>= md) ───────────────────────────── */}
                    <div className="hidden overflow-x-auto md:block">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableHead className="pl-5">N° Facture</TableHead>
                            <TableHead>Client / Acheteur</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Échéance</TableHead>
                            <TableHead className="text-right">Montant TTC</TableHead>
                            <TableHead className="text-center">Statut</TableHead>
                            <TableHead className="text-right pr-5">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoices.map((inv) => (
                            <TableRow key={inv.id} className="group">
                              <TableCell className="pl-5 font-mono text-sm font-semibold text-primary">
                                {inv.invoiceNumber ?? (
                                  <span className="font-normal text-muted-foreground italic">brouillon</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <p className="font-medium leading-tight">{inv.customerName}</p>
                                {inv.customerEmail && (
                                  <p className="text-xs text-muted-foreground">{inv.customerEmail}</p>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">{fmtDate(inv.invoiceDate)}</TableCell>
                              <TableCell className="text-sm">{fmtDate(inv.dueDate)}</TableCell>
                              <TableCell className="text-right font-semibold tabular-nums">
                                {fmtFcfa(inv.totalTtc)}
                              </TableCell>
                              <TableCell className="text-center">
                                <StatusBadge status={inv.status as InvoiceStatus} />
                              </TableCell>
                              <TableCell className="pr-5">
                                {renderActions(inv)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================
          Invoice creation / edit sheet
      ================================================================ */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { if (!o) { setSheetOpen(false); setEditingId(null) } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>{editingId ? "Modifier la facture" : "Nouvelle facture"}</SheetTitle>
            <SheetDescription>
              {editingId
                ? "Modifiez les informations du brouillon. Vous devrez revalider pour générer un nouveau PDF."
                : "Renseignez les informations de votre client et les prestations facturées."}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* ── Section 1: Client / Acheteur ──────────────────────────── */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-primary">Informations de l'acheteur</legend>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="customerName">Nom / Raison sociale <span className="text-destructive">*</span></Label>
                  <Input
                    id="customerName"
                    value={form.customerName}
                    onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                    placeholder="Ex : SATCI SA, M. Koné Ibrahima…"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="customerEmail">Email</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={form.customerEmail}
                      onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))}
                      placeholder="client@entreprise.ci"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invoiceDate">Date de facturation <span className="text-destructive">*</span></Label>
                    <Input
                      id="invoiceDate"
                      type="date"
                      value={form.invoiceDate}
                      onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="customerAddress">Adresse (optionnel)</Label>
                    <Input
                      id="customerAddress"
                      value={form.customerAddress}
                      onChange={(e) => setForm((f) => ({ ...f, customerAddress: e.target.value }))}
                      placeholder="Plateau, Abidjan"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dueDate">Date d'échéance</Label>
                    <Input
                      id="dueDate"
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            {/* ── Section 2: Lignes ──────────────────────────────────────── */}
            <fieldset className="space-y-3">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-semibold text-primary">Lignes de la facture</legend>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }))}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter une ligne
                </Button>
              </div>

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Désignation</th>
                      <th className="px-3 py-2 text-center font-medium w-16">Qté</th>
                      <th className="px-3 py-2 text-right font-medium w-28">Prix unit. HT</th>
                      <th className="px-3 py-2 text-right font-medium w-24">Total HT</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {form.items.map((item, idx) => {
                      const qty   = parseInt(item.quantity, 10)  || 0
                      const price = parseInt(item.unitPrice, 10) || 0
                      const lineHt = qty * price
                      return (
                        <tr key={item._key} className="bg-background">
                          <td className="px-2 py-1.5">
                            <Input
                              value={item.designation}
                              onChange={(e) => updateItem(item._key, "designation", e.target.value)}
                              placeholder="Prestation, produit…"
                              className="h-8 border-0 shadow-none focus-visible:ring-0 px-1"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => updateItem(item._key, "quantity", e.target.value)}
                              className="h-8 border-0 shadow-none focus-visible:ring-0 px-1 text-center w-full"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <AmountInput
                              value={item.unitPrice}
                              onChange={(e) => updateItem(item._key, "unitPrice", e.target.value)}
                              placeholder="0"
                              className="h-8 border-0 shadow-none focus-visible:ring-0 px-1 text-right"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs">
                            {new Intl.NumberFormat("fr-FR").format(lineHt)}
                          </td>
                          <td className="pr-2 py-1.5 text-center">
                            {form.items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeItem(item._key)}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Totals summary ─────────────────────────────────────── */}
              <div className="flex flex-col items-end gap-1.5 pt-1 text-sm">
                <div className="flex w-64 items-center justify-between text-muted-foreground">
                  <span>Sous-total HT</span>
                  <span className="font-mono">{new Intl.NumberFormat("fr-FR").format(subtotalHt)} FCFA</span>
                </div>
                <div className="flex w-64 items-center justify-between text-muted-foreground">
                  <span>TVA ({vatRate} %)</span>
                  <span className="font-mono">{new Intl.NumberFormat("fr-FR").format(vatAmount)} FCFA</span>
                </div>
                <div className="flex w-64 items-center justify-between font-bold text-base text-primary border-t pt-1.5 mt-0.5">
                  <span>TOTAL TTC</span>
                  <span className="font-mono">{new Intl.NumberFormat("fr-FR").format(totalTtc)} FCFA</span>
                </div>
              </div>
            </fieldset>

            {/* ── Section 3: Notes ───────────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes / Conditions (optionnel)</Label>
              <Textarea
                id="notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Conditions de paiement, instructions particulières…"
                className="resize-none"
              />
            </div>

            {/* ── Notice for draft ───────────────────────────────────────── */}
            <div className="rounded-md bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
              <strong>Enregistrement en brouillon</strong> — La facture sera sauvegardée sans numéro ni PDF.
              Cliquez sur <strong>Valider</strong> depuis la liste pour finaliser et générer le PDF comptable.
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => { setSheetOpen(false); setEditingId(null) }}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingId ? "Mettre à jour" : "Enregistrer le brouillon"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ================================================================
          Invoice detail dialog (view-only)
      ================================================================ */}
      <Dialog open={!!viewingId} onOpenChange={(o) => { if (!o) setViewingId(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {viewInvoiceQuery.data?.invoiceNumber ?? "Détail de la facture"}
            </DialogTitle>
          </DialogHeader>
          {viewInvoiceQuery.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : viewInvoiceQuery.data ? (
            <InvoiceDetailView
              invoice={viewInvoiceQuery.data}
              onDownload={handleDownloadPdf}
              downloadingId={downloadingId}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ================================================================
          Cancel confirmation dialog
      ================================================================ */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler ce brouillon ?</DialogTitle>
            <DialogDescription>
              Le brouillon sera marqué comme annulé et ne pourra plus être modifié.
              Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Retour</Button>
            <Button
              variant="destructive"
              onClick={() => cancelTarget && cancelMutation.mutate({ id: cancelTarget })}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmer l'annulation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================
          Credit note (avoir) dialog
      ================================================================ */}
      <Dialog open={!!creditNoteTarget} onOpenChange={(o) => { if (!o) { setCreditNoteTarget(null); setCreditNoteReason("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Émettre un avoir (note de crédit)</DialogTitle>
            <DialogDescription>
              Un avoir annule comptablement cette facture. Il sera généré, numéroté et comptabilisé automatiquement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="creditNoteReason">Motif de l'avoir <span className="text-destructive">*</span></Label>
            <Textarea
              id="creditNoteReason"
              rows={3}
              value={creditNoteReason}
              onChange={(e) => setCreditNoteReason(e.target.value)}
              placeholder="Ex : Erreur de facturation, prestation non réalisée, retour de marchandise…"
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreditNoteTarget(null); setCreditNoteReason("") }}>
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (!creditNoteTarget || !creditNoteReason.trim()) return
                creditNoteMutation.mutate({ id: creditNoteTarget, data: { reason: creditNoteReason.trim() } })
              }}
              disabled={!creditNoteReason.trim() || creditNoteMutation.isPending}
            >
              {creditNoteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Émettre l'avoir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================
          Payment ("Enregistrer un règlement") dialog
      ================================================================ */}
      <Dialog open={!!paymentTargetId} onOpenChange={(o) => { if (!o) closePaymentDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrer un règlement</DialogTitle>
            <DialogDescription>
              {paymentTarget
                ? `Facture ${paymentTarget.invoiceNumber ?? ""} — ${fmtFcfa(paymentTarget.totalTtc)}`
                : "Sélectionnez le moyen de paiement utilisé par le client."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-2 block">Moyen de paiement</Label>
              <RadioGroup
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}
                className="grid grid-cols-2 gap-2"
              >
                {[
                  { value: "especes",      label: "Espèces" },
                  { value: "mobile_money", label: "Mobile Money" },
                  { value: "cheque",       label: "Chèque" },
                  { value: "virement",     label: "Virement bancaire" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer",
                      paymentMethod === opt.value ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <RadioGroupItem value={opt.value} />
                    {opt.label}
                  </label>
                ))}
              </RadioGroup>
            </div>

            {paymentMethod === "mobile_money" && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <div>
                  <Label htmlFor="paymentAccount">Compte Mobile Money receveur <span className="text-destructive">*</span></Label>
                  <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                    <SelectTrigger id="paymentAccount" className="mt-1">
                      <SelectValue placeholder="Sélectionner un compte…" />
                    </SelectTrigger>
                    <SelectContent>
                      {mobileMoneyAccounts.length === 0 && (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          Aucun compte configuré — voir Trésorerie Mobile Money.
                        </div>
                      )}
                      {mobileMoneyAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {MOBILE_MONEY_PROVIDER_LABELS[a.provider] ?? a.provider} — {a.accountNumber}
                          {a.label ? ` (${a.label})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="paymentFee">Frais opérateur (FCFA)</Label>
                    <AmountInput
                      id="paymentFee"
                      value={paymentFee}
                      onChange={(e) => setPaymentFee(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="paymentReference">Référence (facultatif)</Label>
                    <Input
                      id="paymentReference"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="Ex : TXN123456"
                      className="mt-1"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Le montant net ({paymentTarget ? fmtFcfa(paymentTarget.totalTtc - (Number(paymentFee) || 0)) : "—"}) sera crédité sur le compte,
                  les frais seront comptabilisés en charges (631700), et le règlement sera automatiquement enregistré en comptabilité.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closePaymentDialog}>Annuler</Button>
            <Button
              onClick={confirmPayment}
              disabled={markPaidMutation.isPending || (paymentMethod === "mobile_money" && !paymentAccountId)}
            >
              {markPaidMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmer le règlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub: string
  color: string
}) {
  return (
    <Card className={cn("border", color)}>
      <CardContent className="pt-3 pb-3 px-3 sm:pt-4 sm:pb-4 sm:px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="font-bold mt-1 leading-tight break-all text-base tabular-nums sm:text-lg">
              {value}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>
          </div>
          <div className="shrink-0 opacity-70 mt-0.5">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ActionBtn({
  children,
  tip,
  onClick,
  loading,
  className,
}: {
  children: React.ReactNode
  tip: string
  onClick?: () => void
  loading?: boolean
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={loading}
          className={cn(
            "inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors text-muted-foreground hover:bg-muted disabled:opacity-50",
            className,
          )}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top"><p>{tip}</p></TooltipContent>
    </Tooltip>
  )
}

function InvoiceDetailView({
  invoice,
  onDownload,
  downloadingId,
}: {
  invoice: any
  onDownload: (id: number, num: string) => void
  downloadingId: number | null
}) {
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n) + " FCFA"
  return (
    <div className="space-y-5">
      {/* Header info */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">ACHETEUR</p>
          <p className="font-semibold">{invoice.customerName}</p>
          {invoice.customerEmail && <p className="text-muted-foreground">{invoice.customerEmail}</p>}
          {invoice.customerAddress && <p className="text-muted-foreground">{invoice.customerAddress}</p>}
        </div>
        <div className="space-y-1 text-right">
          <StatusBadge status={invoice.status} />
          <p className="text-xs text-muted-foreground mt-2">
            Date : <strong>{new Date(invoice.invoiceDate).toLocaleDateString("fr-FR")}</strong>
          </p>
          {invoice.dueDate && (
            <p className="text-xs text-muted-foreground">
              Échéance : <strong>{new Date(invoice.dueDate).toLocaleDateString("fr-FR")}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Désignation</th>
              <th className="px-3 py-2 text-center">Qté</th>
              <th className="px-3 py-2 text-right">P.U. HT</th>
              <th className="px-3 py-2 text-right">Total HT</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(invoice.items ?? []).map((it: any) => (
              <tr key={it.id}>
                <td className="px-3 py-2">{it.designation}</td>
                <td className="px-3 py-2 text-center">{it.quantity}</td>
                <td className="px-3 py-2 text-right font-mono">{new Intl.NumberFormat("fr-FR").format(it.unitPrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{new Intl.NumberFormat("fr-FR").format(it.totalItemHt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="flex flex-col items-end gap-1 text-sm">
        <div className="flex w-56 justify-between text-muted-foreground">
          <span>Sous-total HT</span>
          <span className="font-mono">{fmt(invoice.subtotalHt)}</span>
        </div>
        <div className="flex w-56 justify-between text-muted-foreground">
          <span>TVA ({invoice.vatRate} %)</span>
          <span className="font-mono">{fmt(invoice.vatAmount)}</span>
        </div>
        <div className="flex w-56 justify-between font-bold text-base text-primary border-t pt-1.5 mt-0.5">
          <span>TOTAL TTC</span>
          <span className="font-mono">{fmt(invoice.totalTtc)}</span>
        </div>
      </div>

      {invoice.notes && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium">Notes : </span>{invoice.notes}
        </div>
      )}

      {/* Download PDF button */}
      {invoice.pdfDocumentId && (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => onDownload(invoice.id, invoice.invoiceNumber ?? "")}
          disabled={downloadingId === invoice.id}
        >
          {downloadingId === invoice.id
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Download className="h-4 w-4" />}
          Télécharger le PDF
        </Button>
      )}

      {/* Immutability notice */}
      {(invoice.status === "VALIDE" || invoice.status === "PAYE") && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 flex items-start gap-2">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Cette facture est <strong>verrouillée</strong> (règle comptable OHADA). Toute correction doit passer par un <strong>avoir</strong> (note de crédit).
          </span>
        </div>
      )}
    </div>
  )
}
