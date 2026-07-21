import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListPurchases,
  useCreatePurchase,
  useSettlePurchase,
  useUploadPurchaseReceipt,
  useGetPurchaseReceipt,
  useListMobileMoneyAccounts,
  useListPurchaseCategories,
  useUploadClientDocument,
  getListPurchasesQueryKey,
} from "@workspace/api-client-react"
import { getToken } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"
import { formatFcfa } from "@/lib/status"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  ShoppingCart, Plus, Clock, CheckCircle2, Loader2,
  CreditCard, TrendingDown, AlertCircle, History,
  Paperclip, Upload, X, Eye, FileText, Camera,
  ShieldCheck, DraftingCompass, ScanLine, Sparkles,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAYMENT_MODE_LABELS: Record<string, string> = {
  credit:       "À crédit (fournisseur)",
  bank:         "Banque (chèque / virement)",
  mobile_money: "Mobile Money",
}

const VAT_RATES = [
  { value: "0",  label: "Sans TVA (0 %)" },
  { value: "18", label: "TVA 18 %" },
]

const AIB_RATES = [
  { value: "0", label: "Sans AIB (0 %)" },
  { value: "2", label: "AIB 2 % (non-importateur)" },
  { value: "7", label: "AIB 7 % (importateur)" },
]

const REVIEW_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  brouillon:  { label: "Brouillon",   className: "bg-slate-100 text-slate-700 border-slate-200" },
  en_attente: { label: "En attente",  className: "bg-amber-50 text-amber-700 border-amber-200" },
  valide:     { label: "Validée",     className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB

function today() { return new Date().toISOString().slice(0, 10) }

// ---------------------------------------------------------------------------
// Receipt file helpers
// ---------------------------------------------------------------------------
interface ReceiptFile {
  fileData: string   // base64
  fileName: string
  mimeType: string
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(",")[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ---------------------------------------------------------------------------
// Receipt preview (inline or in modal)
// ---------------------------------------------------------------------------
function ReceiptPreview({ fileData, fileName, mimeType, compact = false }: {
  fileData: string; fileName: string; mimeType: string; compact?: boolean
}) {
  const src = `data:${mimeType};base64,${fileData}`
  if (mimeType.startsWith("image/")) {
    return (
      <img
        src={src}
        alt={fileName}
        className={cn("rounded-md border object-contain bg-muted/20", compact ? "max-h-32 max-w-full" : "max-h-[60vh] max-w-full mx-auto")}
      />
    )
  }
  return (
    <div className={cn("flex flex-col items-center gap-2", compact ? "" : "py-8")}>
      <FileText className="h-12 w-12 text-muted-foreground" />
      <p className="text-sm font-medium">{fileName}</p>
      <a
        href={src}
        download={fileName}
        className="text-xs text-primary underline"
      >
        Télécharger le PDF
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drag-and-drop file picker
// ---------------------------------------------------------------------------
function FilePicker({ value, onChange, onClear }: {
  value: ReceiptFile | null
  onChange: (f: ReceiptFile | null) => void
  onClear: () => void
}) {
  const { toast } = useToast()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  async function processFile(file: File) {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast({ title: "Format non supporté", description: "Formats acceptés : JPEG, PNG, WebP, PDF.", variant: "destructive" })
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: "Fichier trop volumineux", description: "Taille maximale : 5 Mo.", variant: "destructive" })
      return
    }
    try {
      const fileData = await fileToBase64(file)
      onChange({ fileData, fileName: file.name, mimeType: file.type })
    } catch {
      toast({ title: "Erreur de lecture", description: "Impossible de lire le fichier.", variant: "destructive" })
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
        <Paperclip className="h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{value.fileName}</p>
          <p className="text-xs text-muted-foreground">{value.mimeType.split("/")[1].toUpperCase()}</p>
        </div>
        <button type="button" onClick={onClear} className="rounded p-1 hover:bg-muted transition-colors" title="Supprimer">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-5 text-sm text-muted-foreground transition-colors cursor-pointer hover:bg-muted/30",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
      onClick={() => inputRef.current?.click()}
    >
      <div className="flex gap-3">
        <Upload className="h-5 w-5" />
        <Camera className="h-5 w-5" />
      </div>
      <p className="text-center text-xs">
        Glisser-déposer ou <span className="text-primary font-medium">cliquer</span><br />
        <span className="text-[11px]">JPEG · PNG · PDF · max 5 Mo — appareil photo sur mobile</span>
      </p>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ALLOWED_MIME_TYPES.join(",")}
        capture="environment"
        onChange={handleChange}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receipt viewer dialog (for history items)
// ---------------------------------------------------------------------------
function ReceiptDialog({ purchaseId, fileName, open, onClose }: {
  purchaseId: number; fileName: string | null; open: boolean; onClose: () => void
}) {
  const receiptQuery = useGetPurchaseReceipt(
    purchaseId,
    { query: { enabled: open } as any },
  )
  const data = receiptQuery.data

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pièce justificative</DialogTitle>
          <DialogDescription>{fileName ?? "Justificatif de dépense"}</DialogDescription>
        </DialogHeader>
        <div className="overflow-auto max-h-[65vh] flex items-center justify-center py-2">
          {receiptQuery.isLoading && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
          {receiptQuery.isError && <p className="text-sm text-destructive">Erreur de chargement.</p>}
          {data && <ReceiptPreview fileData={data.fileData} fileName={data.fileName ?? ""} mimeType={data.mimeType ?? ""} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SettleState {
  purchaseId: number
  supplierName: string
  amountTtc: number
  paymentMode: "bank" | "mobile_money"
  mobileMoneyAccountId: string
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DepensesAchats() {
  const { user }       = useAuth()
  const { toast }      = useToast()
  const queryClient    = useQueryClient()
  const clientId       = user?.clientId ?? 0
  const [tab, setTab]  = React.useState("saisie")

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = React.useState({
    date:                today(),
    supplierName:        "",
    supplierNcc:         "",
    invoiceRef:          "",
    categoryKey:         "",
    amountHt:            "",
    vatRate:             "0",
    aibRate:             "0",
    paymentMode:         "bank" as "credit" | "bank" | "mobile_money",
    mobileMoneyAccountId:"",
    notes:               "",
  })
  const [receiptFile, setReceiptFile] = React.useState<ReceiptFile | null>(null)

  // ── OCR scanner state ─────────────────────────────────────────────────────
  type OcrResult = {
    extracted_vendor_name: string | null
    extracted_date: string | null
    extracted_amount: number | null
    suggested_label: string | null
    suggested_category: string | null
  }
  const [isOcrDialogOpen, setIsOcrDialogOpen] = React.useState(false)
  const [isOcrUploading, setIsOcrUploading]   = React.useState(false)
  const [isOcrProcessing, setIsOcrProcessing] = React.useState(false)
  const [ocrError, setOcrError]               = React.useState<string | null>(null)
  const [ocrResult, setOcrResult]             = React.useState<OcrResult | null>(null)
  // Keep the raw file so we can reuse it as the receipt after confirmation.
  const [ocrFileCapture, setOcrFileCapture]   = React.useState<ReceiptFile | null>(null)
  const ocrFileRef   = React.useRef<HTMLInputElement>(null)
  const ocrCameraRef = React.useRef<HTMLInputElement>(null)

  // Derived amounts
  const amountHt  = Number(form.amountHt) || 0
  const vatRate   = Number(form.vatRate)  || 0
  const aibRate   = Number(form.aibRate)  || 0
  const vatAmount = Math.round(amountHt * (vatRate / 100))
  const amountTtc = amountHt + vatAmount
  const aibAmount = Math.round(amountTtc * (aibRate / 100))
  const netPayable = amountTtc - aibAmount

  // ── Settle dialog state ───────────────────────────────────────────────────
  const [settleState, setSettleState] = React.useState<SettleState | null>(null)
  const [receiptViewId, setReceiptViewId] = React.useState<{ id: number; fileName: string | null } | null>(null)

  // ── Remote data ───────────────────────────────────────────────────────────
  const categoriesQuery = useListPurchaseCategories()
  const categories      = categoriesQuery.data ?? []

  const purchasesQuery = useListPurchases(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId } as any },
  )
  const purchases = purchasesQuery.data ?? []

  const pendingPurchases  = purchases.filter((p) => p.status === "pending")
  const settledPurchases  = purchases.filter((p) => p.status === "settled")
  const totalPending      = pendingPurchases.reduce((s, p) => s + p.amountTtc, 0)
  const totalThisMonth    = purchases.filter((p) => {
    const d = new Date(p.date); const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).reduce((s, p) => s + p.amountTtc, 0)

  const mmAccountsQuery = useListMobileMoneyAccounts(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId && (form.paymentMode === "mobile_money" || settleState?.paymentMode === "mobile_money") } as any },
  )
  const mmAccounts = (mmAccountsQuery.data ?? []).filter((a) => a.isActive !== "false")

  const selectedCategory = categories.find((c) => c.key === form.categoryKey)

  // ── Invalidation ─────────────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() })

  // ── OCR upload mutation (separate from the form receipt) ─────────────────
  const ocrUploadMutation = useUploadClientDocument({
    mutation: {
      onSuccess: async (doc) => {
        setIsOcrUploading(false)
        setIsOcrProcessing(true)
        setOcrError(null)
        try {
          const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
          const token = getToken()
          const abort = new AbortController()
          const timeoutId = setTimeout(() => abort.abort(), 90_000)
          const res = await fetch(`${baseUrl}/api/ocr/process/${doc.id}`, {
            method:  'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal:  abort.signal,
          }).finally(() => clearTimeout(timeoutId))
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string }
            setOcrError(err.error ?? 'Impossible de lire ce document.')
            return
          }
          const data = await res.json() as OcrResult
          setOcrResult(data)
        } catch (e) {
          setOcrError(e instanceof Error ? e.message : 'Impossible de joindre le service de reconnaissance.')
        } finally {
          setIsOcrProcessing(false)
        }
      },
      onError: (error) => {
        setIsOcrUploading(false)
        setOcrError((error as { data?: { error?: string } }).data?.error || 'Impossible de télécharger le fichier.')
      },
    },
  })

  const handleOcrFile = (file: File) => {
    const accepted = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']
    if (!accepted.includes(file.type)) { setOcrError('Seuls les fichiers PDF, PNG ou JPEG sont acceptés.'); return }
    setIsOcrUploading(true)
    setOcrError(null)
    setOcrResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      setOcrFileCapture({ fileData: base64, fileName: file.name, mimeType: file.type })
      ocrUploadMutation.mutate({
        id: clientId,
        data: { fileName: file.name, mimeType: file.type, fileData: base64, category: 'Pièces comptables', purpose: 'ocr' },
      })
    }
    reader.readAsDataURL(file)
  }

  const confirmOcrResult = () => {
    if (!ocrResult) return
    setForm((f) => ({
      ...f,
      ...(ocrResult.extracted_vendor_name ? { supplierName: ocrResult.extracted_vendor_name } : {}),
      ...(ocrResult.extracted_date        ? { date: ocrResult.extracted_date }               : {}),
      ...(ocrResult.extracted_amount      ? { amountHt: String(Math.round(ocrResult.extracted_amount)) } : {}),
      ...(ocrResult.suggested_label       ? { notes: ocrResult.suggested_label }              : {}),
      ...(ocrResult.suggested_category    ? { categoryKey: ocrResult.suggested_category }     : {}),
    }))
    if (ocrFileCapture) setReceiptFile(ocrFileCapture)
    setIsOcrDialogOpen(false)
    setOcrResult(null)
    setOcrError(null)
    setOcrFileCapture(null)
    setTab("saisie")
  }

  const closeOcrDialog = () => {
    setIsOcrDialogOpen(false)
    setOcrResult(null)
    setOcrError(null)
    setOcrFileCapture(null)
  }

  // ── Upload receipt mutation ───────────────────────────────────────────────
  const uploadReceiptMutation = useUploadPurchaseReceipt({
    mutation: {
      onSuccess: () => { toast({ title: "Justificatif joint", description: "Pièce jointe enregistrée." }); invalidate() },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Envoi impossible.", variant: "destructive" }),
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useCreatePurchase({
    mutation: {
      onSuccess: (_, vars) => {
        const isDraft = vars.data.reviewStatus === "brouillon"
        toast({
          title: isDraft ? "Brouillon enregistré" : "Dépense enregistrée",
          description: isDraft
            ? "La dépense a été sauvegardée en brouillon."
            : "Écriture comptable générée et soumise au cabinet.",
        })
        setForm({ date: today(), supplierName: "", supplierNcc: "", invoiceRef: "", categoryKey: "", amountHt: "", vatRate: "0", aibRate: "0", paymentMode: "bank", mobileMoneyAccountId: "", notes: "" })
        setReceiptFile(null)
        setTab(isDraft ? "historique" : "historique")
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Enregistrement impossible.", variant: "destructive" }),
    },
  })

  const settleMutation = useSettlePurchase({
    mutation: {
      onSuccess: () => { toast({ title: "Dépense réglée", description: "Écriture de règlement comptabilisée." }); setSettleState(null); invalidate() },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Règlement impossible.", variant: "destructive" }),
    },
  })

  // ── Submit helpers ────────────────────────────────────────────────────────
  const canSubmit = form.supplierName.trim() && form.categoryKey && amountHt > 0
    && (form.paymentMode !== "mobile_money" || !!form.mobileMoneyAccountId)

  function buildPayload(reviewStatus: "brouillon" | "en_attente") {
    return {
      clientId,
      date: new Date(form.date).toISOString(),
      supplierName: form.supplierName.trim(),
      supplierNcc:  form.supplierNcc.trim() || undefined,
      invoiceRef:   form.invoiceRef.trim()  || undefined,
      categoryKey:  form.categoryKey,
      amountHt,
      vatRate: vatRate as 0 | 18,
      aibRate: aibRate as 0 | 2 | 7,
      paymentMode: form.paymentMode,
      mobileMoneyAccountId: form.paymentMode === "mobile_money" ? Number(form.mobileMoneyAccountId) : undefined,
      notes: form.notes.trim() || undefined,
      reviewStatus,
      receipt: receiptFile ?? undefined,
    }
  }

  const handleSubmit    = () => canSubmit && createMutation.mutate({ data: buildPayload("en_attente") })
  const handleDraft     = () => canSubmit && createMutation.mutate({ data: buildPayload("brouillon") })
  const handleSettle    = () => {
    if (!settleState) return
    settleMutation.mutate({
      id: settleState.purchaseId,
      data: { paymentMode: settleState.paymentMode, mobileMoneyAccountId: settleState.paymentMode === "mobile_money" ? Number(settleState.mobileMoneyAccountId) : undefined },
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/20">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><ShoppingCart className="h-6 w-6 text-primary" /></div>
            <div>
              <h1 className="text-xl font-semibold">Dépenses & Achats</h1>
              <p className="text-sm text-muted-foreground">Factures fournisseurs avec TVA / AIB — Banque, Mobile Money ou à crédit.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4 text-amber-500" /> Achats à régler</div>
              <p className="mt-2 text-2xl font-semibold font-mono">{formatFcfa(totalPending)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{pendingPurchases.length} facture(s) en attente</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><TrendingDown className="h-4 w-4 text-red-500" /> Dépenses ce mois</div>
              <p className="mt-2 text-2xl font-semibold font-mono">{formatFcfa(totalThisMonth)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Réglées</div>
              <p className="mt-2 text-2xl font-semibold">{settledPurchases.length}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="saisie"><Plus className="mr-1.5 h-4 w-4" />Nouvelle dépense</TabsTrigger>
            <TabsTrigger value="a-regler" className="relative">
              <Clock className="mr-1.5 h-4 w-4" />À régler
              {pendingPurchases.length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5">{pendingPurchases.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="historique"><History className="mr-1.5 h-4 w-4" />Historique</TabsTrigger>
          </TabsList>

          {/* ── Saisie ─────────────────────────────────────────────────────── */}
          <TabsContent value="saisie">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Enregistrer une dépense</CardTitle>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950/30 shrink-0"
                    onClick={() => { setOcrError(null); setOcrResult(null); setOcrFileCapture(null); setIsOcrUploading(false); setIsOcrProcessing(false); setIsOcrDialogOpen(true) }}
                  >
                    <ScanLine className="mr-1.5 h-4 w-4" />
                    Scanner une pièce
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">

                {/* Row 1: date + fournisseur */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Date de la dépense <span className="text-destructive">*</span></Label>
                    <Input type="date" className="mt-1" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Fournisseur <span className="text-destructive">*</span></Label>
                    <Input className="mt-1" placeholder="Ex : Compagnie Ivoirienne d'Électricité" value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
                  </div>
                </div>

                {/* Row 2: NCC + ref */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>NCC Fournisseur <span className="text-muted-foreground text-xs">(facultatif)</span></Label>
                    <Input className="mt-1" placeholder="Numéro Compte Contribuable" value={form.supplierNcc} onChange={(e) => setForm((f) => ({ ...f, supplierNcc: e.target.value }))} />
                  </div>
                  <div>
                    <Label>N° facture <span className="text-muted-foreground text-xs">(facultatif)</span></Label>
                    <Input className="mt-1" placeholder="Ex : FAC-2026-00123" value={form.invoiceRef} onChange={(e) => setForm((f) => ({ ...f, invoiceRef: e.target.value }))} />
                  </div>
                </div>

                {/* Catégorie */}
                <div>
                  <Label>Catégorie de charge <span className="text-destructive">*</span></Label>
                  <Select value={form.categoryKey} onValueChange={(v) => setForm((f) => ({ ...f, categoryKey: v, aibRate: "0" }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sélectionner une catégorie…" /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{c.account}</span>{c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCategory && (
                    <p className="text-xs text-muted-foreground mt-1">
                      → Compte SYSCOHADA <span className="font-mono font-medium">{selectedCategory.account}</span> — {selectedCategory.accountName}
                      {!selectedCategory.vatEligible && " · TVA non récupérable"}
                    </p>
                  )}
                </div>

                {/* Montants */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Montant HT (FCFA) <span className="text-destructive">*</span></Label>
                    <AmountInput className="mt-1" value={form.amountHt} onChange={(e) => setForm((f) => ({ ...f, amountHt: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <Label>TVA</Label>
                    <Select value={form.vatRate} onValueChange={(v) => setForm((f) => ({ ...f, vatRate: v }))} disabled={selectedCategory ? !selectedCategory.vatEligible : false}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{VAT_RATES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {/* AIB */}
                <div>
                  <Label>AIB — Acompte sur Impôts et Bénéfices</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">Retenue à la source obligatoire en Côte d'Ivoire. Créditera le compte <span className="font-mono">447200</span>.</p>
                  <div className="flex gap-2">
                    {AIB_RATES.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, aibRate: r.value }))}
                        className={cn(
                          "flex-1 rounded-md border px-3 py-2 text-sm text-center transition-colors",
                          form.aibRate === r.value ? "border-primary bg-primary/5 font-semibold" : "border-border hover:bg-muted/50",
                        )}
                      >
                        {r.value === "0" ? "Sans AIB" : `${r.value}%`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Récapitulatif montants */}
                {amountHt > 0 && (
                  <div className="rounded-md border bg-muted/30 px-4 py-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Montant HT</span>
                      <span className="font-mono font-medium">{formatFcfa(amountHt)}</span>
                    </div>
                    {vatAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">+ TVA 18 % <span className="font-mono text-xs">(4451)</span></span>
                        <span className="font-mono text-amber-700">+{formatFcfa(vatAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1.5">
                      <span className="text-muted-foreground">= Montant TTC</span>
                      <span className="font-mono font-semibold">{formatFcfa(amountTtc)}</span>
                    </div>
                    {aibAmount > 0 && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">− AIB {aibRate}% retenu <span className="font-mono text-xs">(447200)</span></span>
                          <span className="font-mono text-red-700">−{formatFcfa(aibAmount)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1.5 font-semibold">
                          <span>Net payable au fournisseur</span>
                          <span className="font-mono text-emerald-700">{formatFcfa(netPayable)}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Mode de règlement */}
                <div>
                  <Label>Mode de règlement <span className="text-destructive">*</span></Label>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(["credit", "bank", "mobile_money"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, paymentMode: mode, mobileMoneyAccountId: "" }))}
                        className={cn(
                          "rounded-md border px-3 py-2.5 text-sm text-left transition-colors",
                          form.paymentMode === mode ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted/50",
                        )}
                      >
                        {mode === "credit"       && <><CreditCard className="h-4 w-4 mb-1 text-amber-600" /><br /></>}
                        {mode === "bank"         && <><CheckCircle2 className="h-4 w-4 mb-1 text-blue-600" /><br /></>}
                        {mode === "mobile_money" && <><ShoppingCart className="h-4 w-4 mb-1 text-emerald-600" /><br /></>}
                        {PAYMENT_MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {form.paymentMode === "credit" && <>Dr <span className="font-mono">Charge (HT)</span> + Dr <span className="font-mono">4451</span> / Cr <span className="font-mono">4011 Fournisseurs</span> — <em>AIB retenu au règlement</em></>}
                    {form.paymentMode === "bank"   && <>Dr <span className="font-mono">Charge (HT)</span> + Dr <span className="font-mono">4451</span>{aibAmount > 0 ? <> / Cr <span className="font-mono">447200 AIB</span> + Cr <span className="font-mono">5211</span></> : <> / Cr <span className="font-mono">5211 Banques</span></>}</>}
                    {form.paymentMode === "mobile_money" && <>Dr <span className="font-mono">Charge (HT)</span> + Dr <span className="font-mono">4451</span>{aibAmount > 0 ? <> / Cr <span className="font-mono">447200 AIB</span> + Cr <span className="font-mono">552xxx</span></> : <> / Cr <span className="font-mono">552xxx Mobile Money</span></>}</>}
                  </div>
                </div>

                {/* Mobile Money selector */}
                {form.paymentMode === "mobile_money" && (
                  <div>
                    <Label>Compte Mobile Money <span className="text-destructive">*</span></Label>
                    <Select value={form.mobileMoneyAccountId} onValueChange={(v) => setForm((f) => ({ ...f, mobileMoneyAccountId: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Sélectionner un compte…" /></SelectTrigger>
                      <SelectContent>
                        {mmAccounts.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">Aucun compte configuré.</div>}
                        {mmAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.label ?? a.accountNumber} ({a.provider})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Pièce justificative */}
                <div>
                  <Label className="flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Pièce justificative
                    <span className="text-muted-foreground text-xs font-normal">(recommandée — ticket, reçu ou facture)</span>
                  </Label>
                  <div className="mt-1.5">
                    <FilePicker value={receiptFile} onChange={setReceiptFile} onClear={() => setReceiptFile(null)} />
                  </div>
                  {receiptFile?.mimeType.startsWith("image/") && (
                    <div className="mt-2"><ReceiptPreview fileData={receiptFile.fileData} fileName={receiptFile.fileName} mimeType={receiptFile.mimeType} compact /></div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <Label>Observations <span className="text-muted-foreground text-xs">(facultatif)</span></Label>
                  <Input className="mt-1" placeholder="Ex : Facture électricité juillet 2026" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button className="flex-1" size="lg" disabled={!canSubmit || createMutation.isPending} onClick={handleSubmit}>
                    {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enregistrement…</> : "Soumettre au cabinet"}
                  </Button>
                  <Button variant="outline" size="lg" className="sm:w-auto" disabled={!canSubmit || createMutation.isPending} onClick={handleDraft} title="Enregistrer comme brouillon sans soumettre au cabinet">
                    <DraftingCompass className="mr-2 h-4 w-4" />Brouillon
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── À régler ──────────────────────────────────────────────── */}
          <TabsContent value="a-regler">
            {pendingPurchases.length === 0 ? (
              <Card><CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2"><CheckCircle2 className="h-8 w-8 text-emerald-500" /><p className="text-sm">Aucune dépense en attente de règlement.</p></CardContent></Card>
            ) : (
              <Card><CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Fournisseur</TableHead><TableHead>Catégorie</TableHead>
                      <TableHead className="text-right">TTC</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPurchases.map((p) => {
                      const rs = REVIEW_STATUS_CONFIG[p.reviewStatus] ?? REVIEW_STATUS_CONFIG.en_attente
                      return (
                        <TableRow key={p.id}>
                          <TableCell>{new Date(p.date).toLocaleDateString("fr-FR")}</TableCell>
                          <TableCell className="font-medium">
                            {p.supplierName}
                            {p.hasReceipt && <span title="Pièce jointe"><Paperclip className="ml-1 inline h-3 w-3 text-primary" /></span>}
                          </TableCell>
                          <TableCell><span className="text-xs font-mono text-muted-foreground mr-1">{p.chargeAccount}</span>{p.categoryLabel}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">{formatFcfa(p.amountTtc)}</TableCell>
                          <TableCell><Badge variant="outline" className={cn("text-xs", rs.className)}>{rs.label}</Badge></TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => setSettleState({ purchaseId: p.id, supplierName: p.supplierName, amountTtc: p.amountTtc, paymentMode: "bank", mobileMoneyAccountId: "" })}>
                              <CreditCard className="mr-1.5 h-3.5 w-3.5" />Régler
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

          {/* ── Historique ────────────────────────────────────────────── */}
          <TabsContent value="historique">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead><TableHead>Fournisseur</TableHead><TableHead>Catégorie</TableHead>
                    <TableHead>Mode</TableHead><TableHead className="text-right">HT</TableHead>
                    <TableHead className="text-right">TVA</TableHead><TableHead className="text-right">AIB</TableHead>
                    <TableHead className="text-right">TTC</TableHead><TableHead>Workflow</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-10">Aucune dépense enregistrée.</TableCell></TableRow>
                  )}
                  {purchases.map((p) => {
                    const rs = REVIEW_STATUS_CONFIG[p.reviewStatus] ?? REVIEW_STATUS_CONFIG.en_attente
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">{new Date(p.date).toLocaleDateString("fr-FR")}</TableCell>
                        <TableCell className="font-medium max-w-[140px] truncate" title={p.supplierName}>
                          {p.supplierName}
                          {p.invoiceRef && <span className="block text-xs text-muted-foreground">{p.invoiceRef}</span>}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono text-muted-foreground mr-1">{p.chargeAccount}</span>
                          <span className="text-sm">{p.categoryLabel}</span>
                          {p.correctedChargeAccount && (
                            <span className="block text-[10px] text-emerald-700 font-medium">✓ Corrigé par cabinet</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {PAYMENT_MODE_LABELS[p.paymentMode] ?? p.paymentMode}
                          {p.mobileMoneyProvider && <span className="block text-xs text-muted-foreground">{p.mobileMoneyProvider}</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatFcfa(p.amountHt)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{p.vatAmount > 0 ? formatFcfa(p.vatAmount) : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-red-700">{p.aibAmount > 0 ? formatFcfa(p.aibAmount) : "—"}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatFcfa(p.amountTtc)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-xs whitespace-nowrap", rs.className)}>
                            {p.reviewStatus === "valide" ? <ShieldCheck className="h-3 w-3 mr-1 inline" /> : p.reviewStatus === "en_attente" ? <AlertCircle className="h-3 w-3 mr-1 inline" /> : <DraftingCompass className="h-3 w-3 mr-1 inline" />}
                            {rs.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {p.hasReceipt && (
                            <Button variant="ghost" size="sm" onClick={() => setReceiptViewId({ id: p.id, fileName: p.receiptFileName ?? null })} title="Voir la pièce justificative">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Settle dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!settleState} onOpenChange={(o) => { if (!o) setSettleState(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Régler une dépense à crédit</DialogTitle>
            <DialogDescription>
              {settleState && <>Fournisseur : <strong>{settleState.supplierName}</strong> — Montant TTC : <strong>{formatFcfa(settleState.amountTtc)}</strong></>}
            </DialogDescription>
          </DialogHeader>
          {settleState && (
            <div className="space-y-4 py-2">
              <div>
                <Label>Mode de règlement</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["bank", "mobile_money"] as const).map((mode) => (
                    <button key={mode} type="button"
                      onClick={() => setSettleState((s) => s ? { ...s, paymentMode: mode, mobileMoneyAccountId: "" } : s)}
                      className={cn("rounded-md border px-3 py-2 text-sm text-left transition-colors", settleState.paymentMode === mode ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted/50")}
                    >
                      {mode === "bank" ? "Banque (chèque / virement)" : "Mobile Money"}
                    </button>
                  ))}
                </div>
              </div>
              {settleState.paymentMode === "mobile_money" && (
                <div>
                  <Label>Compte Mobile Money</Label>
                  <Select value={settleState.mobileMoneyAccountId} onValueChange={(v) => setSettleState((s) => s ? { ...s, mobileMoneyAccountId: v } : s)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                    <SelectContent>
                      {mmAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.label ?? a.accountNumber} ({a.provider})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleState(null)}>Annuler</Button>
            <Button disabled={settleMutation.isPending || (settleState?.paymentMode === "mobile_money" && !settleState.mobileMoneyAccountId)} onClick={handleSettle}>
              {settleMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Traitement…</> : "Confirmer le règlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Receipt viewer dialog ──────────────────────────────────────────── */}
      {receiptViewId && (
        <ReceiptDialog
          purchaseId={receiptViewId.id}
          fileName={receiptViewId.fileName}
          open={!!receiptViewId}
          onClose={() => setReceiptViewId(null)}
        />
      )}

      {/* ── OCR scanner dialog ─────────────────────────────────────────────── */}
      <Dialog open={isOcrDialogOpen} onOpenChange={(open) => { if (!open) closeOcrDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-violet-600" />
              Scanner une facture fournisseur
            </DialogTitle>
            <DialogDescription>
              Photographiez ou importez une facture. L'IA extrait le fournisseur, la date, le montant et la catégorie pour pré-remplir le formulaire.
            </DialogDescription>
          </DialogHeader>

          {/* Step 1 — Upload */}
          {!isOcrUploading && !isOcrProcessing && !ocrResult && (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3 rounded-md border-2 border-dashed border-muted-foreground/25 p-8 text-center">
                <ScanLine className="h-10 w-10 text-violet-400" />
                <p className="text-sm text-muted-foreground">
                  Prenez en photo ou importez la pièce
                  <br />
                  <span className="text-xs opacity-70">PDF, PNG ou JPEG — max 10 Mo</span>
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" size="sm"
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={() => ocrCameraRef.current?.click()}
                  >
                    <Camera className="mr-1.5 h-3.5 w-3.5" />Prendre en photo
                  </Button>
                  <Button type="button" size="sm" variant="outline"
                    className="border-violet-300 text-violet-700"
                    onClick={() => ocrFileRef.current?.click()}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />Choisir un fichier
                  </Button>
                </div>
              </div>
              {ocrError && (
                <div className="flex items-start gap-1.5 text-destructive" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-sm">{ocrError}</p>
                </div>
              )}
              <input ref={ocrCameraRef} type="file" accept="image/*"
                {...{ capture: "environment" }} className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOcrFile(f); e.target.value = "" }}
              />
              <input ref={ocrFileRef} type="file" accept="application/pdf,image/png,image/jpeg"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOcrFile(f); e.target.value = "" }}
              />
            </div>
          )}

          {/* Step 2 — Processing */}
          {(isOcrUploading || isOcrProcessing) && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
              <p className="text-sm font-medium">
                {isOcrUploading ? "Envoi du document…" : "Analyse par l'IA en cours…"}
              </p>
              <p className="text-xs text-muted-foreground">Cela prend généralement moins de 5 secondes.</p>
            </div>
          )}

          {/* Step 3 — Results */}
          {ocrResult && !isOcrProcessing && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">Résultats de l'analyse</span>
                </div>
                <dl className="space-y-2.5 text-sm">
                  {ocrResult.extracted_vendor_name && (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-baseline">
                      <dt className="text-muted-foreground shrink-0">Fournisseur</dt>
                      <dd className="font-medium break-words">{ocrResult.extracted_vendor_name}</dd>
                    </div>
                  )}
                  {ocrResult.extracted_date && (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-baseline">
                      <dt className="text-muted-foreground shrink-0">Date</dt>
                      <dd className="font-medium">{ocrResult.extracted_date}</dd>
                    </div>
                  )}
                  {ocrResult.extracted_amount != null && (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-baseline">
                      <dt className="text-muted-foreground shrink-0">Montant (pré-rempli en HT)</dt>
                      <dd className="font-medium">{ocrResult.extracted_amount.toLocaleString('fr-FR')} FCFA</dd>
                    </div>
                  )}
                  {ocrResult.suggested_category && (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-baseline">
                      <dt className="text-muted-foreground shrink-0">Catégorie suggérée</dt>
                      <dd className="font-medium break-words">{ocrResult.suggested_category.replace(/_/g, ' ')}</dd>
                    </div>
                  )}
                  {ocrResult.suggested_label && (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:items-baseline">
                      <dt className="text-muted-foreground shrink-0">Observations</dt>
                      <dd className="font-medium break-words">{ocrResult.suggested_label}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <p className="text-xs text-muted-foreground">
                Ces valeurs seront pré-remplies dans le formulaire. Vérifiez et ajustez avant de soumettre (notamment le montant HT si la facture affiche un TTC).
              </p>
              {ocrError && (
                <div className="flex items-start gap-1.5 text-destructive" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-sm">{ocrError}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeOcrDialog}>Annuler</Button>
            {ocrResult && (
              <Button type="button" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={confirmOcrResult}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Utiliser ces données
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
