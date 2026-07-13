import { useMemo, useState } from "react"
import {
  useListTransactions,
  getListTransactionsQueryKey,
  useListTransactionCategories,
  getListTransactionCategoriesQueryKey,
  useCreateTransaction,
  useListClientDocuments,
  getListClientDocumentsQueryKey,
  TransactionType,
  PaymentMethod,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"
import {
  getTransactionStatusColor,
  getTransactionStatusLabel,
  getPaymentMethodLabel,
  formatFcfa,
} from "@/lib/status"
import { Plus, TrendingUp, TrendingDown, Paperclip, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
    paymentMethod: "" as PaymentMethod | "",
    documentId: "" as string,
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

  const [activeTab, setActiveTab] = useState<TransactionType>("recette")
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm("recette"))

  const { data: transactions, isLoading } = useListTransactions(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListTransactionsQueryKey({ clientId }) } },
  )
  const { data: categories } = useListTransactionCategories(
    { type: form.type },
    { query: { enabled: isFormOpen, queryKey: getListTransactionCategoriesQueryKey({ type: form.type }) } },
  )
  const { data: documents } = useListClientDocuments(clientId, {
    query: { enabled: !!clientId, queryKey: getListClientDocumentsQueryKey(clientId) },
  })

  const createMutation = useCreateTransaction({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Opération envoyée",
          description: "Votre cabinet comptable va la vérifier et la comptabiliser.",
        })
        setIsFormOpen(false)
        setForm(emptyForm(activeTab))
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

  const openForm = (type: TransactionType) => {
    setForm(emptyForm(type))
    setIsFormOpen(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseInt(form.amount, 10)
    if (!form.label.trim() || !amount || amount <= 0 || !form.category || !form.paymentMethod) return
    createMutation.mutate({
      data: {
        clientId,
        date: new Date(form.date).toISOString(),
        label: form.label.trim(),
        amount,
        type: form.type,
        category: form.category,
        paymentMethod: form.paymentMethod as PaymentMethod,
        documentId: form.documentId ? parseInt(form.documentId, 10) : null,
      },
    })
  }

  const { recettes, depenses } = useMemo(() => {
    const list = transactions ?? []
    return {
      recettes: list.filter((t) => t.type === "recette"),
      depenses: list.filter((t) => t.type === "depense"),
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
        <Button data-testid="button-new-operation" onClick={() => openForm(activeTab)}>
          <Plus className="mr-2 h-4 w-4" />
          Nouvelle opération
        </Button>
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TransactionType)}>
        <TabsList>
          <TabsTrigger value="recette" data-testid="tab-recettes">Recettes</TabsTrigger>
          <TabsTrigger value="depense" data-testid="tab-depenses">Dépenses</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-4">
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead>Mode de règlement</TableHead>
                      <TableHead>Montant</TableHead>
                      <TableHead>Pièce jointe</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                          Chargement...
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                          <div className="flex flex-col items-center justify-center">
                            <Wallet className="h-8 w-8 mb-2 opacity-20" />
                            <p>Aucune opération pour le moment.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((t) => (
                        <TableRow key={t.id} data-testid={`row-transaction-${t.id}`}>
                          <TableCell className="whitespace-nowrap text-sm">{formatDate(t.date)}</TableCell>
                          <TableCell className="font-medium">{t.label}</TableCell>
                          <TableCell className="text-sm">{t.categoryLabel ?? "—"}</TableCell>
                          <TableCell className="text-sm">{getPaymentMethodLabel(t.paymentMethod)}</TableCell>
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
                            {t.status === "anomalie" && t.clarificationNote && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1 max-w-xs">
                                {t.clarificationNote}
                              </p>
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
                onClick={() => setForm((f) => ({ ...f, type: "recette", category: "" }))}
                data-testid="button-form-type-recette"
              >
                <TrendingUp className="mr-2 h-4 w-4" />
                Recette
              </Button>
              <Button
                type="button"
                variant={form.type === "depense" ? "default" : "outline"}
                onClick={() => setForm((f) => ({ ...f, type: "depense", category: "" }))}
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
              <Input
                id="amount"
                type="number"
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
              <Label htmlFor="paymentMethod">Mode de règlement</Label>
              <Select
                value={form.paymentMethod}
                onValueChange={(v) => setForm((f) => ({ ...f, paymentMethod: v as PaymentMethod }))}
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="document">Pièce jointe (optionnel)</Label>
              <Select
                value={form.documentId}
                onValueChange={(v) => setForm((f) => ({ ...f, documentId: v }))}
              >
                <SelectTrigger id="document" data-testid="select-document">
                  <SelectValue placeholder="Aucune pièce jointe" />
                </SelectTrigger>
                <SelectContent>
                  {(documents ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      <Paperclip className="mr-1.5 h-3.5 w-3.5 inline" />
                      {d.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pour ajouter un nouveau reçu, déposez-le d'abord depuis l'onglet Documents.
              </p>
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
    </div>
  )
}
