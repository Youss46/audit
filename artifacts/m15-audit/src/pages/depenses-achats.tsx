import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListPurchases,
  useCreatePurchase,
  useSettlePurchase,
  useListMobileMoneyAccounts,
  useListPurchaseCategories,
  getListPurchasesQueryKey,
} from "@workspace/api-client-react"
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
  { value: "18", label: "TVA 18 % (Côte d'Ivoire)" },
]

function today() {
  return new Date().toISOString().slice(0, 10)
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
    paymentMode:         "bank" as "credit" | "bank" | "mobile_money",
    mobileMoneyAccountId:"",
    notes:               "",
  })

  // Derived amounts
  const amountHt  = Number(form.amountHt) || 0
  const vatRate   = Number(form.vatRate)  || 0
  const vatAmount = Math.round(amountHt * (vatRate / 100))
  const amountTtc = amountHt + vatAmount

  // ── Settle dialog state ───────────────────────────────────────────────────
  const [settleState, setSettleState] = React.useState<SettleState | null>(null)

  // ── Remote data ───────────────────────────────────────────────────────────
  const categoriesQuery = useListPurchaseCategories({ query: {} })
  const categories      = categoriesQuery.data ?? []

  const purchasesQuery = useListPurchases(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId } },
  )
  const purchases = purchasesQuery.data ?? []

  const pendingPurchases  = purchases.filter((p) => p.status === "pending")
  const settledPurchases  = purchases.filter((p) => p.status === "settled")
  const totalPending      = pendingPurchases.reduce((s, p) => s + p.amountTtc, 0)
  const totalThisMonth    = purchases.filter((p) => {
    const d = new Date(p.date)
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).reduce((s, p) => s + p.amountTtc, 0)

  const mmAccountsQuery = useListMobileMoneyAccounts(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId && (form.paymentMode === "mobile_money" || settleState?.paymentMode === "mobile_money") } },
  )
  const mmAccounts = (mmAccountsQuery.data ?? []).filter((a) => a.isActive !== "false")

  const selectedCategory = categories.find((c) => c.key === form.categoryKey)

  // ── Invalidation ─────────────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useCreatePurchase({
    mutation: {
      onSuccess: () => {
        toast({ title: "Dépense enregistrée", description: "Écriture comptable générée automatiquement." })
        setForm({
          date: today(), supplierName: "", supplierNcc: "", invoiceRef: "",
          categoryKey: "", amountHt: "", vatRate: "0",
          paymentMode: "bank", mobileMoneyAccountId: "", notes: "",
        })
        setTab("historique")
        invalidate()
      },
      onError: (e: any) => toast({
        title: "Erreur",
        description: e?.data?.error ?? "Enregistrement impossible.",
        variant: "destructive",
      }),
    },
  })

  const settleMutation = useSettlePurchase({
    mutation: {
      onSuccess: () => {
        toast({ title: "Dépense réglée", description: "Écriture de règlement comptabilisée." })
        setSettleState(null)
        invalidate()
      },
      onError: (e: any) => toast({
        title: "Erreur",
        description: e?.data?.error ?? "Règlement impossible.",
        variant: "destructive",
      }),
    },
  })

  // ── Submit ────────────────────────────────────────────────────────────────
  const canSubmit = form.supplierName.trim()
    && form.categoryKey
    && amountHt > 0
    && (form.paymentMode !== "mobile_money" || !!form.mobileMoneyAccountId)

  const handleSubmit = () => {
    if (!canSubmit) return
    createMutation.mutate({
      data: {
        clientId,
        date: new Date(form.date).toISOString(),
        supplierName: form.supplierName.trim(),
        supplierNcc:  form.supplierNcc.trim() || undefined,
        invoiceRef:   form.invoiceRef.trim()  || undefined,
        categoryKey:  form.categoryKey,
        amountHt,
        vatRate,
        paymentMode:  form.paymentMode,
        mobileMoneyAccountId: form.paymentMode === "mobile_money"
          ? Number(form.mobileMoneyAccountId) : undefined,
        notes: form.notes.trim() || undefined,
      },
    })
  }

  const handleSettle = () => {
    if (!settleState) return
    settleMutation.mutate({
      id: settleState.purchaseId,
      data: {
        paymentMode: settleState.paymentMode,
        mobileMoneyAccountId: settleState.paymentMode === "mobile_money"
          ? Number(settleState.mobileMoneyAccountId) : undefined,
      },
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/20">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <ShoppingCart className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Dépenses & Achats</h1>
              <p className="text-sm text-muted-foreground">
                Enregistrement des achats réglés par banque, Mobile Money ou à crédit (hors Caisse Terrain).
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 text-amber-500" /> Achats à régler
              </div>
              <p className="mt-2 text-2xl font-semibold font-mono">{formatFcfa(totalPending)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{pendingPurchases.length} facture(s) en attente</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingDown className="h-4 w-4 text-red-500" /> Dépenses ce mois
              </div>
              <p className="mt-2 text-2xl font-semibold font-mono">{formatFcfa(totalThisMonth)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Réglées
              </div>
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
                <span className="ml-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5">
                  {pendingPurchases.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="historique"><History className="mr-1.5 h-4 w-4" />Historique</TabsTrigger>
          </TabsList>

          {/* ── Saisie ────────────────────────────────────────────────── */}
          <TabsContent value="saisie">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Enregistrer une dépense</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Row 1: date + fournisseur */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Date de la dépense <span className="text-destructive">*</span></Label>
                    <Input
                      type="date"
                      className="mt-1"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Fournisseur <span className="text-destructive">*</span></Label>
                    <Input
                      className="mt-1"
                      placeholder="Ex : Compagnie Ivoirienne d'Électricité"
                      value={form.supplierName}
                      onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Row 2: NCC + ref facture */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>NCC Fournisseur <span className="text-muted-foreground text-xs">(facultatif)</span></Label>
                    <Input
                      className="mt-1"
                      placeholder="Numéro Compte Contribuable"
                      value={form.supplierNcc}
                      onChange={(e) => setForm((f) => ({ ...f, supplierNcc: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>N° facture fournisseur <span className="text-muted-foreground text-xs">(facultatif)</span></Label>
                    <Input
                      className="mt-1"
                      placeholder="Ex : FAC-2026-00123"
                      value={form.invoiceRef}
                      onChange={(e) => setForm((f) => ({ ...f, invoiceRef: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Catégorie */}
                <div>
                  <Label>Catégorie de charge <span className="text-destructive">*</span></Label>
                  <Select value={form.categoryKey} onValueChange={(v) => setForm((f) => ({ ...f, categoryKey: v }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Sélectionner une catégorie…" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{c.account}</span>
                          {c.label}
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label>Montant HT (FCFA) <span className="text-destructive">*</span></Label>
                    <AmountInput
                      className="mt-1"
                      value={form.amountHt}
                      onChange={(e) => setForm((f) => ({ ...f, amountHt: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label>TVA</Label>
                    <Select
                      value={form.vatRate}
                      onValueChange={(v) => setForm((f) => ({ ...f, vatRate: v }))}
                      disabled={selectedCategory ? !selectedCategory.vatEligible : false}
                    >
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {VAT_RATES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Montant TTC (FCFA)</Label>
                    <div className="mt-1 h-10 px-3 flex items-center rounded-md border bg-muted/50 text-sm font-mono font-semibold">
                      {formatFcfa(amountTtc)}
                    </div>
                    {vatAmount > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        dont TVA 4451 : {formatFcfa(vatAmount)}
                      </p>
                    )}
                  </div>
                </div>

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
                          form.paymentMode === mode
                            ? "border-primary bg-primary/5 font-medium"
                            : "border-border hover:bg-muted/50",
                        )}
                      >
                        {mode === "credit"       && <><CreditCard className="h-4 w-4 mb-1 text-amber-600" /><br /></>}
                        {mode === "bank"         && <><CheckCircle2 className="h-4 w-4 mb-1 text-blue-600" /><br /></>}
                        {mode === "mobile_money" && <><ShoppingCart className="h-4 w-4 mb-1 text-emerald-600" /><br /></>}
                        {PAYMENT_MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>

                  {/* Info box per mode */}
                  <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {form.paymentMode === "credit" && (
                      <>Dr <span className="font-mono">Charge (HT)</span> + Dr <span className="font-mono">4451 TVA</span> / Cr <span className="font-mono">4011 Fournisseurs</span> — statut <em>À régler</em></>
                    )}
                    {form.paymentMode === "bank" && (
                      <>Dr <span className="font-mono">Charge (HT)</span> + Dr <span className="font-mono">4451 TVA</span> / Cr <span className="font-mono">5211 Banques locales</span> — journal BQ</>
                    )}
                    {form.paymentMode === "mobile_money" && (
                      <>Dr <span className="font-mono">Charge (HT)</span> + Dr <span className="font-mono">4451 TVA</span> / Cr <span className="font-mono">552xxx Mobile Money</span> — journal BQ</>
                    )}
                  </div>
                </div>

                {/* Mobile Money account selector */}
                {form.paymentMode === "mobile_money" && (
                  <div>
                    <Label>Compte Mobile Money utilisé <span className="text-destructive">*</span></Label>
                    <Select
                      value={form.mobileMoneyAccountId}
                      onValueChange={(v) => setForm((f) => ({ ...f, mobileMoneyAccountId: v }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Sélectionner un compte…" />
                      </SelectTrigger>
                      <SelectContent>
                        {mmAccounts.length === 0 && (
                          <div className="px-2 py-2 text-sm text-muted-foreground">
                            Aucun compte configuré — voir Trésorerie Mobile Money.
                          </div>
                        )}
                        {mmAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.label ?? a.accountNumber} ({a.provider})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <Label>Observations <span className="text-muted-foreground text-xs">(facultatif)</span></Label>
                  <Input
                    className="mt-1"
                    placeholder="Ex : Facture électricité juillet 2026"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                {/* Submit */}
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!canSubmit || createMutation.isPending}
                  onClick={handleSubmit}
                >
                  {createMutation.isPending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enregistrement…</>
                    : "Enregistrer la dépense & générer l'écriture comptable"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── À régler ──────────────────────────────────────────────── */}
          <TabsContent value="a-regler">
            {pendingPurchases.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <p className="text-sm">Aucune dépense en attente de règlement.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Fournisseur</TableHead>
                        <TableHead>Catégorie</TableHead>
                        <TableHead className="text-right">Montant TTC</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingPurchases.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{new Date(p.date).toLocaleDateString("fr-FR")}</TableCell>
                          <TableCell className="font-medium">{p.supplierName}</TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground font-mono mr-1">{p.chargeAccount}</span>
                            {p.categoryLabel}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">{formatFcfa(p.amountTtc)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              onClick={() => setSettleState({
                                purchaseId: p.id,
                                supplierName: p.supplierName,
                                amountTtc: p.amountTtc,
                                paymentMode: "bank",
                                mobileMoneyAccountId: "",
                              })}
                            >
                              <CreditCard className="mr-1.5 h-3.5 w-3.5" />Régler
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Historique ────────────────────────────────────────────── */}
          <TabsContent value="historique">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Fournisseur</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">HT</TableHead>
                      <TableHead className="text-right">TVA</TableHead>
                      <TableHead className="text-right">TTC</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                          Aucune dépense enregistrée.
                        </TableCell>
                      </TableRow>
                    )}
                    {purchases.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">{new Date(p.date).toLocaleDateString("fr-FR")}</TableCell>
                        <TableCell className="font-medium max-w-[160px] truncate" title={p.supplierName}>
                          {p.supplierName}
                          {p.invoiceRef && <span className="block text-xs text-muted-foreground">{p.invoiceRef}</span>}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono text-muted-foreground mr-1">{p.chargeAccount}</span>
                          <span className="text-sm">{p.categoryLabel}</span>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {PAYMENT_MODE_LABELS[p.paymentMode] ?? p.paymentMode}
                          {p.mobileMoneyProvider && (
                            <span className="block text-xs text-muted-foreground">{p.mobileMoneyProvider}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatFcfa(p.amountHt)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {p.vatAmount > 0 ? formatFcfa(p.vatAmount) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatFcfa(p.amountTtc)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={p.status === "pending" ? "secondary" : "default"}
                            className={p.status === "pending" ? "text-amber-700 bg-amber-100 border-amber-200" : ""}
                          >
                            {p.status === "pending" ? (
                              <><AlertCircle className="h-3 w-3 mr-1" />À régler</>
                            ) : (
                              <><CheckCircle2 className="h-3 w-3 mr-1" />Réglée</>
                            )}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Settle dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!settleState} onOpenChange={(o) => { if (!o) setSettleState(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Régler une dépense à crédit</DialogTitle>
            <DialogDescription>
              {settleState && (
                <>Fournisseur : <strong>{settleState.supplierName}</strong> — Montant : <strong>{formatFcfa(settleState.amountTtc)}</strong></>
              )}
            </DialogDescription>
          </DialogHeader>
          {settleState && (
            <div className="space-y-4 py-2">
              <div>
                <Label>Mode de règlement</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["bank", "mobile_money"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSettleState((s) => s ? { ...s, paymentMode: mode, mobileMoneyAccountId: "" } : s)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm text-left transition-colors",
                        settleState.paymentMode === mode
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      {PAYMENT_MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>

              {settleState.paymentMode === "mobile_money" && (
                <div>
                  <Label>Compte Mobile Money <span className="text-destructive">*</span></Label>
                  <Select
                    value={settleState.mobileMoneyAccountId}
                    onValueChange={(v) => setSettleState((s) => s ? { ...s, mobileMoneyAccountId: v } : s)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                    <SelectContent>
                      {mmAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.label ?? a.accountNumber} ({a.provider})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Écriture générée : Dr <span className="font-mono">4011 Fournisseurs</span> {formatFcfa(settleState.amountTtc)} / Cr{" "}
                <span className="font-mono">{settleState.paymentMode === "bank" ? "5211 Banques" : "552xxx Mobile Money"}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleState(null)}>Annuler</Button>
            <Button
              onClick={handleSettle}
              disabled={
                settleMutation.isPending ||
                (settleState?.paymentMode === "mobile_money" && !settleState.mobileMoneyAccountId)
              }
            >
              {settleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmer le règlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
