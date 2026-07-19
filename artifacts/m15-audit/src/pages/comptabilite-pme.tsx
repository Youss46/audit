import { useMemo, useRef, useState } from "react"
import {
  useListTransactions,
  getListTransactionsQueryKey,
  useListTransactionCategories,
  getListTransactionCategoriesQueryKey,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useSettleTransaction,
  useListClientDocuments,
  getListClientDocumentsQueryKey,
  useUploadClientDocument,
  useListCashRegisters,
  getListCashRegistersQueryKey,
  useCreateCashRegister,
  TransactionType,
  PaymentMethod,
  PaymentType,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { getToken } from "@/lib/auth"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { cn, formatDate } from "@/lib/utils"
import {
  getTransactionStatusColor,
  getTransactionStatusLabel,
  getPaymentMethodLabel,
  getPaymentTypeLabel,
  formatFcfa,
} from "@/lib/status"
import {
  Plus, TrendingUp, TrendingDown, Paperclip, Wallet, Clock, CircleDollarSign,
  Upload, Camera, X, CheckCircle2, AlertCircle, Loader2, Pencil, Trash2,
  ScanLine, Sparkles,
} from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAYMENT_METHODS: PaymentMethod[] = ["especes", "mobile_money", "cheque", "virement"]

function emptyForm(type: TransactionType) {
  return {
    type,
    date: new Date().toISOString().slice(0, 10),
    label: "",
    amount: "",
    category: "",
    paymentType: "cash" as PaymentType,
    paymentMethod: "" as PaymentMethod | "",
    dueDate: "",
    documentId: "" as string,
    cashRegisterId: "" as string,
  }
}

// Module P3 (Comptabilité Simplifiée): the Espace PME's ultra-simple entry
// screen. A non-accountant owner just picks Recette/Dépense, a plain
// category, and a payment method -- the matching engine on the backend
// turns this into a proper SYSCOHADA double-entry line once submitted.
export default function ComptabilitePme() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const clientId = user?.clientId ?? 0

  const [activeTab, setActiveTab] = useState<TransactionType | "en_attente">("recette")
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm("recette"))
  const [settleTarget, setSettleTarget] = useState<number | null>(null)
  const [settlePaymentMethod, setSettlePaymentMethod] = useState<PaymentMethod | "">("")
  const [settleCashRegisterId, setSettleCashRegisterId] = useState<string>("")
  const [newRegisterName, setNewRegisterName] = useState("")
  // Attachment state
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  // File name of a freshly-uploaded attachment (not yet in the documents list)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const attachmentFileInputRef = useRef<HTMLInputElement>(null)
  const attachmentCameraInputRef = useRef<HTMLInputElement>(null)
  // Edit / delete state
  const [editTargetId, setEditTargetId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState(emptyForm("recette"))
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  // Phase 3 (OCR): tracks whether the current form was pre-filled by AI OCR.
  const [isAiAssisted, setIsAiAssisted] = useState(false)
  // Phase 3 (OCR): scanner dialog state.
  const [isOcrDialogOpen, setIsOcrDialogOpen] = useState(false)
  const [isOcrUploading, setIsOcrUploading] = useState(false)
  const [isOcrProcessing, setIsOcrProcessing] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  type OcrResult = {
    extracted_vendor_name: string | null
    extracted_date: string | null
    extracted_amount: number | null
    suggested_type: 'depense' | 'recette' | null
    suggested_category: string | null
    suggested_label: string | null
    documentId: number
    documentFileName: string
  }
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const ocrFileRef = useRef<HTMLInputElement>(null)
  const ocrCameraRef = useRef<HTMLInputElement>(null)

  const { data: transactions, isLoading } = useListTransactions(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListTransactionsQueryKey({ clientId }) } },
  )
  const { data: categories } = useListTransactionCategories(
    { type: form.type },
    { query: { enabled: isFormOpen, queryKey: getListTransactionCategoriesQueryKey({ type: form.type }) } },
  )
  const { data: editCategories } = useListTransactionCategories(
    { type: editForm.type },
    { query: { enabled: editTargetId !== null, queryKey: getListTransactionCategoriesQueryKey({ type: editForm.type }) } },
  )
  const { data: documents } = useListClientDocuments(clientId, {
    query: { enabled: !!clientId, queryKey: getListClientDocumentsQueryKey(clientId) },
  })
  const { data: cashRegisters } = useListCashRegisters(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListCashRegistersQueryKey({ clientId }) } },
  )

  const uploadAttachmentMutation = useUploadClientDocument({
    mutation: {
      onSuccess: (doc) => {
        setForm((f) => ({ ...f, documentId: String(doc.id) }))
        setUploadedFileName(doc.fileName)
        setAttachmentError(null)
        setIsUploadingAttachment(false)
        queryClient.invalidateQueries({ queryKey: getListClientDocumentsQueryKey(clientId) })
      },
      onError: (error) => {
        setIsUploadingAttachment(false)
        toast({
          title: "Erreur de téléchargement",
          description: (error as { data?: { error?: string } }).data?.error ||
            "Impossible de télécharger le fichier. Vérifiez que le format est PDF, PNG ou JPEG.",
          variant: "destructive",
        })
      },
    },
  })

  // Phase 3 (OCR): separate upload mutation for the scanner dialog so its
  // state never bleeds into the main form attachment state.
  const ocrUploadMutation = useUploadClientDocument({
    mutation: {
      onSuccess: async (doc) => {
        setIsOcrUploading(false)
        setIsOcrProcessing(true)
        setOcrError(null)
        try {
          const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
          const token = getToken()
          const res = await fetch(`${baseUrl}/api/ocr/process/${doc.id}`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string }
            setOcrError(err.error ?? 'Impossible de lire ce document.')
            return
          }
          const data = await res.json() as {
            extracted_vendor_name: string | null
            extracted_date: string | null
            extracted_amount: number | null
            suggested_type: 'depense' | 'recette' | null
            suggested_category: string | null
            suggested_label: string | null
          }
          setOcrResult({
            ...data,
            documentId: doc.id,
            documentFileName: doc.fileName,
          })
        } catch (e) {
          setOcrError(e instanceof Error ? e.message : 'Impossible de joindre le service de reconnaissance.')
        } finally {
          setIsOcrProcessing(false)
        }
      },
      onError: (error) => {
        setIsOcrUploading(false)
        setOcrError(
          (error as { data?: { error?: string } }).data?.error ||
          'Impossible de télécharger le fichier.',
        )
      },
    },
  })

  const createRegisterMutation = useCreateCashRegister({
    mutation: {
      onSuccess: (register) => {
        queryClient.invalidateQueries({ queryKey: getListCashRegistersQueryKey({ clientId }) })
        setForm((f) => ({ ...f, cashRegisterId: String(register.id) }))
        setNewRegisterName("")
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de créer la caisse.",
          variant: "destructive",
        })
      },
    },
  })

  const createMutation = useCreateTransaction({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Opération envoyée",
          description: "Votre cabinet comptable va la vérifier et la comptabiliser.",
        })
        setIsFormOpen(false)
        setIsAiAssisted(false)
        setForm(emptyForm(activeTab === "en_attente" ? "recette" : activeTab))
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey({ clientId }) })
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible d'enregistrer l'opération.",
          variant: "destructive",
        })
      },
    },
  })

  const settleMutation = useSettleTransaction({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Facture marquée comme payée",
          description: "Le règlement a été transmis à votre cabinet pour comptabilisation.",
        })
        setSettleTarget(null)
        setSettlePaymentMethod("")
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey({ clientId }) })
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible d'enregistrer ce règlement.",
          variant: "destructive",
        })
      },
    },
  })

  const updateMutation = useUpdateTransaction({
    mutation: {
      onSuccess: () => {
        toast({ title: "Opération modifiée", description: "Les modifications ont été enregistrées." })
        setEditTargetId(null)
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey({ clientId }) })
      },
      onError: (error: unknown) => {
        const e = error as { data?: { error?: string } }
        toast({ title: "Erreur", description: e.data?.error || "Impossible de modifier l'opération.", variant: "destructive" })
      },
    },
  })

  const deleteMutation = useDeleteTransaction({
    mutation: {
      onSuccess: () => {
        toast({ title: "Opération supprimée" })
        setDeleteTargetId(null)
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey({ clientId }) })
      },
      onError: (error: unknown) => {
        const e = error as { data?: { error?: string } }
        toast({ title: "Erreur", description: e.data?.error || "Impossible de supprimer l'opération.", variant: "destructive" })
      },
    },
  })

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTargetId) return
    const amount = parseInt(editForm.amount, 10)
    if (!editForm.label.trim() || !amount || amount <= 0) return
    updateMutation.mutate({
      id: editTargetId,
      data: {
        label: editForm.label.trim(),
        amount,
        date: new Date(editForm.date).toISOString(),
        category: editForm.category || null,
        paymentType: editForm.paymentType || undefined,
        paymentMethod: editForm.paymentType === "cash" ? (editForm.paymentMethod || null) : null,
        dueDate: editForm.paymentType === "credit" && editForm.dueDate ? new Date(editForm.dueDate).toISOString() : null,
      },
    })
  }

  const openForm = (type: TransactionType) => {
    setForm(emptyForm(type))
    setAttachmentError(null)
    setUploadedFileName(null)
    setIsUploadingAttachment(false)
    setIsAiAssisted(false)
    setIsFormOpen(true)
  }

  /** Read a file and kick off OCR upload → Gemini Vision extraction. */
  const handleOcrFile = (file: File) => {
    const accepted = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']
    if (!accepted.includes(file.type)) {
      setOcrError('Seuls les fichiers PDF, PNG ou JPEG sont acceptés.')
      return
    }
    setIsOcrUploading(true)
    setOcrError(null)
    setOcrResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      ocrUploadMutation.mutate({
        id: clientId,
        data: { fileName: file.name, mimeType: file.type, fileData: base64, category: 'Pièces comptables' },
      })
    }
    reader.readAsDataURL(file)
  }

  /** Pre-fill the entry form with OCR results and flag the entry as AI-assisted. */
  const confirmOcrResult = () => {
    if (!ocrResult) return
    const type = ocrResult.suggested_type ?? 'depense'
    setForm({
      ...emptyForm(type),
      label: ocrResult.suggested_label ?? '',
      amount: ocrResult.extracted_amount ? String(Math.round(ocrResult.extracted_amount)) : '',
      date: ocrResult.extracted_date ?? new Date().toISOString().slice(0, 10),
      category: ocrResult.suggested_category ?? '',
      documentId: String(ocrResult.documentId),
    })
    setUploadedFileName(ocrResult.documentFileName)
    setAttachmentError(null)
    setIsAiAssisted(true)
    setIsOcrDialogOpen(false)
    setOcrResult(null)
    setOcrError(null)
    setIsFormOpen(true)
  }

  const closeOcrDialog = () => {
    setIsOcrDialogOpen(false)
    setOcrResult(null)
    setOcrError(null)
    setIsOcrUploading(false)
    setIsOcrProcessing(false)
  }

  /** Read a file as base64 then POST it to the document store. */
  const handleAttachmentFile = (file: File) => {
    setIsUploadingAttachment(true)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1]
      uploadAttachmentMutation.mutate({
        id: clientId,
        data: {
          fileName: file.name,
          mimeType: file.type,
          fileData: base64,
          category: "Procédure de Visa",
        },
      })
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseInt(form.amount, 10)
    if (!form.label.trim() || !amount || amount <= 0 || !form.category) return
    if (form.paymentType === "cash" && !form.paymentMethod) return
    if (form.paymentType === "credit" && !form.dueDate) return
    if (form.paymentType === "cash" && form.paymentMethod === "especes" && !form.cashRegisterId) return
    // Attachment is mandatory for every dépense.
    if (form.type === "depense" && !form.documentId) {
      setAttachmentError(
        "La pièce justificative (facture, reçu ou ticket) est obligatoire pour soumettre une dépense au cabinet.",
      )
      return
    }
    createMutation.mutate({
      data: {
        clientId,
        date: new Date(form.date).toISOString(),
        label: form.label.trim(),
        amount,
        type: form.type,
        category: form.category,
        paymentType: form.paymentType,
        paymentMethod: form.paymentType === "cash" ? (form.paymentMethod as PaymentMethod) : null,
        dueDate: form.paymentType === "credit" ? new Date(form.dueDate).toISOString() : null,
        documentId: form.documentId ? parseInt(form.documentId, 10) : null,
        cashRegisterId:
          form.paymentType === "cash" && form.paymentMethod === "especes"
            ? parseInt(form.cashRegisterId, 10)
            : null,
        // Phase 3 (OCR): signals that this entry was pre-filled by Gemini
        // Vision so the backend sets source = "ocr_entry" instead of "pme_entry".
        isAiAssisted: isAiAssisted || undefined,
      },
    })
  }

  const handleSettle = (e: React.FormEvent) => {
    e.preventDefault()
    if (settleTarget == null || !settlePaymentMethod) return
    if (settlePaymentMethod === "especes" && !settleCashRegisterId) return
    settleMutation.mutate({
      id: settleTarget,
      data: {
        paymentMethod: settlePaymentMethod,
        cashRegisterId: settlePaymentMethod === "especes" ? parseInt(settleCashRegisterId, 10) : null,
      },
    })
  }

  const { recettes, depenses, facturesEnAttente } = useMemo(() => {
    const list = transactions ?? []
    return {
      recettes: list.filter((t) => t.type === "recette"),
      depenses: list.filter((t) => t.type === "depense"),
      facturesEnAttente: list.filter(
        (t) => t.paymentType === "credit" && t.status === "valide" && !t.settledAt,
      ),
    }
  }, [transactions])

  const rows = activeTab === "recette" ? recettes : depenses

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mes opérations</h1>
          <p className="text-muted-foreground mt-1">
            Enregistrez vos recettes et dépenses au jour le jour. Votre cabinet les vérifie et les
            comptabilise automatiquement.
          </p>
        </div>
        <div className="flex gap-2">
          {/* Phase 3: OCR scanner — open Gemini Vision flow before the
              regular form so the AI can pre-fill the fields. */}
          <Button
            variant="outline"
            className="border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950/30"
            onClick={() => {
              setOcrResult(null)
              setOcrError(null)
              setIsOcrUploading(false)
              setIsOcrProcessing(false)
              setIsOcrDialogOpen(true)
            }}
            data-testid="button-scanner-ocr"
          >
            <ScanLine className="mr-2 h-4 w-4" />
            Scanner une pièce
          </Button>
          <Button
            data-testid="button-new-operation"
            onClick={() => openForm(activeTab === "en_attente" ? "recette" : activeTab)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nouvelle opération
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <TrendingUp className="h-5 w-5 text-green-700 dark:text-green-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total recettes</div>
              <div className="text-lg font-bold" data-testid="text-total-recettes">
                {formatFcfa(recettes.reduce((sum, t) => sum + t.amount, 0))}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
              <TrendingDown className="h-5 w-5 text-red-700 dark:text-red-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total dépenses</div>
              <div className="text-lg font-bold" data-testid="text-total-depenses">
                {formatFcfa(depenses.reduce((sum, t) => sum + t.amount, 0))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TransactionType | "en_attente")}>
        <TabsList>
          <TabsTrigger value="recette" data-testid="tab-recettes">Recettes</TabsTrigger>
          <TabsTrigger value="depense" data-testid="tab-depenses">Dépenses</TabsTrigger>
          <TabsTrigger value="en_attente" data-testid="tab-factures-en-attente">
            Factures en attente
            {facturesEnAttente.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">{facturesEnAttente.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {(["recette", "depense"] as const).map((type) => (
          <TabsContent key={type} value={type} className="mt-4">
            <Card className="shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Libellé</TableHead>
                        <TableHead>Catégorie</TableHead>
                        <TableHead>Règlement</TableHead>
                        <TableHead>Montant</TableHead>
                        <TableHead>Pièce jointe</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead className="text-right pr-4">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                            Chargement...
                          </TableCell>
                        </TableRow>
                      ) : (type === "recette" ? recettes : depenses).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <Wallet className="h-8 w-8 mb-2 opacity-20" />
                              <p>Aucune opération pour le moment.</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        (type === "recette" ? recettes : depenses).map((t) => (
                          <TableRow key={t.id} data-testid={`row-transaction-${t.id}`}>
                            <TableCell className="whitespace-nowrap text-sm">{formatDate(t.date)}</TableCell>
                            <TableCell className="font-medium">
                              {t.label}
                              {t.source === "settlement" && (
                                <Badge variant="outline" className="ml-1.5 text-[10px] py-0 border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                                  Règlement
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{t.categoryLabel ?? "—"}</TableCell>
                            <TableCell className="text-sm">
                              {t.paymentType === "credit" ? (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                  À crédit
                                  {t.dueDate && <span className="text-xs text-muted-foreground">· éch. {formatDate(t.dueDate)}</span>}
                                </span>
                              ) : (
                                getPaymentMethodLabel(t.paymentMethod)
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{formatFcfa(t.amount)}</TableCell>
                            <TableCell>
                              {t.documentId ? (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={t.documentFileName ?? undefined}>
                                  <Paperclip className="h-3.5 w-3.5" />
                                  Jointe
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Aucune</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`border-transparent ${getTransactionStatusColor(t.status)}`}>
                                {getTransactionStatusLabel(t.status)}
                              </Badge>
                              {t.paymentType === "credit" && t.status === "valide" && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {t.settledAt ? "Réglée" : "Non réglée"}
                                </p>
                              )}
                              {t.status === "anomalie" && t.clarificationNote && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-1 max-w-xs">
                                  {t.clarificationNote}
                                </p>
                              )}
                            </TableCell>
                            <TableCell
                              className="text-right pr-4"
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              {(t.status === "a_valider" || t.status === "anomalie") && (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    title="Modifier"
                                    onClick={() => {
                                      setEditTargetId(t.id)
                                      setEditForm({
                                        type: t.type,
                                        date: new Date(t.date).toISOString().slice(0, 10),
                                        label: t.label,
                                        amount: String(t.amount),
                                        category: t.category ?? "",
                                        paymentType: t.paymentType as PaymentType,
                                        paymentMethod: (t.paymentMethod as PaymentMethod | "") ?? "",
                                        dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
                                        documentId: t.documentId ? String(t.documentId) : "",
                                        cashRegisterId: t.cashRegisterId ? String(t.cashRegisterId) : "",
                                      })
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    title="Supprimer"
                                    onClick={() => setDeleteTargetId(t.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="en_attente" className="mt-4">
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date d'échéance</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Montant</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {facturesEnAttente.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">
                          <div className="flex flex-col items-center justify-center">
                            <CircleDollarSign className="h-8 w-8 mb-2 opacity-20" />
                            <p>Aucune facture en attente de règlement.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      facturesEnAttente.map((t) => (
                        <TableRow key={t.id} data-testid={`row-facture-attente-${t.id}`}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {t.dueDate ? formatDate(t.dueDate) : "—"}
                          </TableCell>
                          <TableCell className="font-medium">{t.label}</TableCell>
                          <TableCell className="text-sm">
                            {t.type === "recette" ? "Créance client" : "Dette fournisseur"}
                          </TableCell>
                          <TableCell className="font-medium">{formatFcfa(t.amount)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSettleTarget(t.id)
                                setSettlePaymentMethod("")
                              }}
                              data-testid={`button-settle-${t.id}`}
                            >
                              Marquer comme payé
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle opération</DialogTitle>
            <DialogDescription>
              Décrivez votre opération en langage simple. Votre cabinet la traduira en écriture
              comptable et la validera.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={form.type === "recette" ? "default" : "outline"}
                onClick={() => {
                  setForm((f) => ({ ...f, type: "recette", category: "" }))
                  setAttachmentError(null)
                }}
                data-testid="button-form-type-recette"
              >
                <TrendingUp className="mr-2 h-4 w-4" />
                Recette
              </Button>
              <Button
                type="button"
                variant={form.type === "depense" ? "default" : "outline"}
                onClick={() => {
                  setForm((f) => ({ ...f, type: "depense", category: "" }))
                  setAttachmentError(null)
                }}
                data-testid="button-form-type-depense"
              >
                <TrendingDown className="mr-2 h-4 w-4" />
                Dépense
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="label">Libellé</Label>
              <Input
                id="label"
                placeholder="Ex : Vente du jour, Facture d'électricité..."
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                data-testid="input-label"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Montant (FCFA)</Label>
              <AmountInput
                id="amount"
                min={1}
                placeholder="0"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                data-testid="input-amount"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Catégorie</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger id="category" data-testid="select-category">
                  <SelectValue placeholder="Sélectionner une catégorie..." />
                </SelectTrigger>
                <SelectContent>
                  {(categories ?? []).map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Règlement</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={form.paymentType === "cash" ? "default" : "outline"}
                  onClick={() => setForm((f) => ({ ...f, paymentType: "cash", dueDate: "" }))}
                  data-testid="button-payment-type-cash"
                >
                  Immédiat (Au comptant)
                </Button>
                <Button
                  type="button"
                  variant={form.paymentType === "credit" ? "default" : "outline"}
                  onClick={() => setForm((f) => ({ ...f, paymentType: "credit", paymentMethod: "" }))}
                  data-testid="button-payment-type-credit"
                >
                  Plus tard (À crédit)
                </Button>
              </div>
            </div>

            {form.paymentType === "cash" ? (
              <div className="space-y-2">
                <Label htmlFor="paymentMethod">Mode de règlement</Label>
                <Select
                  value={form.paymentMethod}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, paymentMethod: v as PaymentMethod, cashRegisterId: "" }))
                  }
                >
                  <SelectTrigger id="paymentMethod" data-testid="select-payment-method">
                    <SelectValue placeholder="Sélectionner un mode..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {getPaymentMethodLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.paymentMethod === "especes" && (
                  <div className="space-y-2 pt-1">
                    <Label htmlFor="cashRegisterId">Caisse</Label>
                    <Select
                      value={form.cashRegisterId}
                      onValueChange={(v) => setForm((f) => ({ ...f, cashRegisterId: v }))}
                    >
                      <SelectTrigger id="cashRegisterId" data-testid="select-cash-register">
                        <SelectValue placeholder="Sélectionner une caisse..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(cashRegisters ?? []).map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(cashRegisters ?? []).length === 0 && (
                      <div className="flex gap-2 pt-1">
                        <Input
                          placeholder="Ex : Caisse principale"
                          value={newRegisterName}
                          onChange={(e) => setNewRegisterName(e.target.value)}
                          data-testid="input-new-cash-register"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!newRegisterName.trim() || createRegisterMutation.isPending}
                          onClick={() =>
                            createRegisterMutation.mutate({ data: { name: newRegisterName.trim(), clientId } })
                          }
                          data-testid="button-create-cash-register"
                        >
                          Créer
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="dueDate">Date d'échéance</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                  data-testid="input-due-date"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Cette opération sera enregistrée comme une créance ou une dette. Vous pourrez la
                  marquer comme payée depuis l'onglet "Factures en attente" une fois validée.
                </p>
              </div>
            )}

            {/* ── Pièce justificative ── */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Pièce justificative</Label>
                {form.type === "depense" ? (
                  <span className="inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                    Obligatoire pour les dépenses
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">(Optionnel)</span>
                )}
              </div>

              {/* ── Attached file display ── */}
              {form.documentId ? (
                <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 dark:border-green-800 dark:bg-green-950/30">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                  <span className="flex-1 truncate text-sm font-medium">
                    {uploadedFileName ??
                      (documents ?? []).find((d) => String(d.id) === form.documentId)?.fileName ??
                      "Document sélectionné"}
                  </span>
                  <button
                    type="button"
                    aria-label="Retirer la pièce jointe"
                    onClick={() => {
                      setForm((f) => ({ ...f, documentId: "" }))
                      setUploadedFileName(null)
                    }}
                    className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : isUploadingAttachment ? (
                /* ── Upload in progress ── */
                <div className="flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Téléchargement en cours…
                </div>
              ) : (
                /* ── Empty drop zone ── */
                <div
                  className={cn(
                    "rounded-md border-2 border-dashed px-3 py-5 transition-colors",
                    attachmentError
                      ? "border-destructive bg-destructive/5"
                      : "border-muted-foreground/25 hover:border-muted-foreground/40",
                  )}
                >
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Upload className="h-6 w-6 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      Prendre en photo / Télécharger la pièce
                      <br />
                      <span className="text-[11px] opacity-70">PDF, PNG ou JPEG — max 10 Mo</span>
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => attachmentCameraInputRef.current?.click()}
                        data-testid="button-attachment-camera"
                      >
                        <Camera className="mr-1.5 h-3.5 w-3.5" />
                        Prendre en photo
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => attachmentFileInputRef.current?.click()}
                        data-testid="button-attachment-file"
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        Choisir un fichier
                      </Button>
                    </div>
                  </div>
                  {/* Camera capture — opens native camera on mobile */}
                  <input
                    ref={attachmentCameraInputRef}
                    type="file"
                    accept="image/*"
                    // eslint-disable-next-line react/no-unknown-property
                    {...{ capture: "environment" }}
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleAttachmentFile(file)
                      e.target.value = ""
                    }}
                  />
                  {/* Standard file picker */}
                  <input
                    ref={attachmentFileInputRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleAttachmentFile(file)
                      e.target.value = ""
                    }}
                  />
                </div>
              )}

              {/* ── Inline error message ── */}
              {attachmentError && (
                <div className="flex items-start gap-1.5 text-destructive" role="alert">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p className="text-xs">{attachmentError}</p>
                </div>
              )}

              {/* ── Pick from already-uploaded docs ── */}
              {!form.documentId && !isUploadingAttachment && (documents ?? []).length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="text-xs text-muted-foreground">
                    Ou sélectionner un document déjà déposé :
                  </p>
                  <Select
                    value={form.documentId}
                    onValueChange={(v) => {
                      setForm((f) => ({ ...f, documentId: v }))
                      setUploadedFileName(null)
                      setAttachmentError(null)
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="select-document">
                      <SelectValue placeholder="Sélectionner un document existant…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(documents ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          <Paperclip className="mr-1.5 inline h-3.5 w-3.5" />
                          {d.fileName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsFormOpen(false)}
                disabled={createMutation.isPending}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Envoi..." : "Enregistrer l'opération"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Edit Transaction Dialog ---- */}
      <Dialog open={editTargetId !== null} onOpenChange={(open) => !open && setEditTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier l'opération</DialogTitle>
            <DialogDescription>
              Modifiez les informations de cette opération. Seules les opérations en attente ou en anomalie peuvent être modifiées.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-date">Date</Label>
              <Input id="edit-date" type="date" value={editForm.date}
                onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-label">Libellé</Label>
              <Input id="edit-label" value={editForm.label}
                onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-amount">Montant (FCFA)</Label>
              <AmountInput id="edit-amount" min={1} value={editForm.amount}
                onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Catégorie</Label>
              <Select value={editForm.category} onValueChange={(v) => setEditForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Catégorie…" /></SelectTrigger>
                <SelectContent>
                  {(editCategories ?? []).map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mode de règlement</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={editForm.paymentType === "cash" ? "default" : "outline"}
                  onClick={() => setEditForm((f) => ({ ...f, paymentType: "cash", paymentMethod: "", dueDate: "" }))}>
                  Comptant
                </Button>
                <Button type="button" variant={editForm.paymentType === "credit" ? "default" : "outline"}
                  onClick={() => setEditForm((f) => ({ ...f, paymentType: "credit", paymentMethod: "", dueDate: "" }))}>
                  À crédit
                </Button>
              </div>
            </div>
            {editForm.paymentType === "credit" && (
              <div className="space-y-2">
                <Label>Date d'échéance</Label>
                <Input type="date" value={editForm.dueDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTargetId(null)}>Annuler</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Enregistrement…" : "Enregistrer les modifications"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Confirmation ---- */}
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette opération&nbsp;?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const t = transactions?.find((tx) => tx.id === deleteTargetId)
                return t ? `«\u00a0${t.label}\u00a0» — ${t.amount.toLocaleString("fr-FR")}\u00a0FCFA` : ""
              })()}
              {" "}Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTargetId && deleteMutation.mutate({ id: deleteTargetId })}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Phase 3: OCR Scanner Dialog ---- */}
      <Dialog open={isOcrDialogOpen} onOpenChange={(open) => { if (!open) closeOcrDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-violet-600" />
              Scanner une pièce comptable
            </DialogTitle>
            <DialogDescription>
              Photographiez ou importez une facture ou un reçu. L'IA extrait les informations et pré-remplit votre opération.
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Upload buttons (shown when idle and no result yet) */}
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
                  <Button
                    type="button"
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={() => ocrCameraRef.current?.click()}
                  >
                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                    Prendre en photo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-violet-300 text-violet-700"
                    onClick={() => ocrFileRef.current?.click()}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Choisir un fichier
                  </Button>
                </div>
              </div>
              {ocrError && (
                <div className="flex items-start gap-1.5 text-destructive" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-sm">{ocrError}</p>
                </div>
              )}
              {/* Hidden inputs */}
              <input
                ref={ocrCameraRef}
                type="file"
                accept="image/*"
                {...{ capture: "environment" }}
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOcrFile(f); e.target.value = "" }}
              />
              <input
                ref={ocrFileRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOcrFile(f); e.target.value = "" }}
              />
            </div>
          )}

          {/* Step 2: Processing */}
          {(isOcrUploading || isOcrProcessing) && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
              <p className="text-sm font-medium">
                {isOcrUploading ? "Envoi du document…" : "Analyse par l'IA en cours…"}
              </p>
              <p className="text-xs text-muted-foreground">Cela prend généralement moins de 5 secondes.</p>
            </div>
          )}

          {/* Step 3: Results */}
          {ocrResult && !isOcrProcessing && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">Résultats de l'analyse</span>
                </div>
                <dl className="space-y-2 text-sm">
                  {ocrResult.extracted_vendor_name && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Fournisseur / Client</dt>
                      <dd className="font-medium text-right">{ocrResult.extracted_vendor_name}</dd>
                    </div>
                  )}
                  {ocrResult.suggested_label && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Libellé suggéré</dt>
                      <dd className="font-medium text-right max-w-[60%] truncate">{ocrResult.suggested_label}</dd>
                    </div>
                  )}
                  {ocrResult.extracted_date && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Date</dt>
                      <dd className="font-medium">{ocrResult.extracted_date}</dd>
                    </div>
                  )}
                  {ocrResult.extracted_amount != null && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Montant</dt>
                      <dd className="font-medium">{ocrResult.extracted_amount.toLocaleString('fr-FR')} FCFA</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="font-medium">{ocrResult.suggested_type === 'recette' ? 'Recette' : 'Dépense'}</dd>
                  </div>
                  {ocrResult.suggested_category && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Catégorie</dt>
                      <dd className="font-medium">{ocrResult.suggested_category.replace(/_/g, ' ')}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <p className="text-xs text-muted-foreground">
                Ces valeurs seront pré-remplies dans le formulaire. Vous pourrez les corriger avant d'envoyer.
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
            <Button type="button" variant="outline" onClick={closeOcrDialog}>
              Annuler
            </Button>
            {ocrResult && (
              <Button
                type="button"
                className="bg-violet-600 hover:bg-violet-700 text-white"
                onClick={confirmOcrResult}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Utiliser ces données
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settleTarget != null} onOpenChange={(open) => !open && setSettleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marquer la facture comme payée</DialogTitle>
            <DialogDescription>
              Indiquez comment ce règlement a été effectué. Votre cabinet comptabilisera ce
              paiement dans le grand livre.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSettle} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="settlePaymentMethod">Mode de règlement</Label>
              <Select
                value={settlePaymentMethod}
                onValueChange={(v) => {
                  setSettlePaymentMethod(v as PaymentMethod)
                  setSettleCashRegisterId("")
                }}
              >
                <SelectTrigger id="settlePaymentMethod" data-testid="select-settle-payment-method">
                  <SelectValue placeholder="Sélectionner un mode..." />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {getPaymentMethodLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {settlePaymentMethod === "especes" && (
              <div className="space-y-2">
                <Label htmlFor="settleCashRegisterId">Caisse</Label>
                <Select value={settleCashRegisterId} onValueChange={setSettleCashRegisterId}>
                  <SelectTrigger id="settleCashRegisterId" data-testid="select-settle-cash-register">
                    <SelectValue placeholder="Sélectionner une caisse..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(cashRegisters ?? []).map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSettleTarget(null)}
                disabled={settleMutation.isPending}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={
                  settleMutation.isPending ||
                  !settlePaymentMethod ||
                  (settlePaymentMethod === "especes" && !settleCashRegisterId)
                }
              >
                {settleMutation.isPending ? "Envoi..." : "Confirmer le paiement"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
