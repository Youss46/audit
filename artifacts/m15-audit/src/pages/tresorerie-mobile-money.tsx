import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListMobileMoneyAccounts,
  useCreateMobileMoneyAccount,
  useUpdateMobileMoneyAccount,
  useListMobileMoneyTransactions,
  useRecordMobileMoneySale,
  useCreateMobileMoneyRepatriation,
  useConfirmMobileMoneyRepatriationReception,
  getListMobileMoneyAccountsQueryKey,
  getListMobileMoneyTransactionsQueryKey,
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
  Smartphone, Plus, Wallet, ArrowUpRight, ArrowDownRight, Landmark,
  Loader2, CheckCircle2, History, Settings2,
} from "lucide-react"

const PROVIDERS = [
  { value: "wave", label: "Wave" },
  { value: "orange_money", label: "Orange Money" },
  { value: "mtn_momo", label: "MTN MoMo" },
  { value: "moov_money", label: "Moov Money" },
] as const

const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(PROVIDERS.map((p) => [p.value, p.label]))

function todayLocal() {
  return new Date().toISOString().slice(0, 10)
}

// Module Trésorerie Mobile Money (generalized, all PME clients): a single
// dashboard covering account configuration, cached balances, manual daily
// sales entry, and the two-step bank repatriation flow. Invoice settlements
// (from the Facturier) also land here for full traceability, alongside
// manual movements.
export default function TresorerieMobileMoney() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const clientId = user?.clientId ?? 0

  const [activeTab, setActiveTab] = React.useState("comptes")
  const [accountDialogOpen, setAccountDialogOpen] = React.useState(false)
  const [newAccount, setNewAccount] = React.useState({ provider: "wave" as string, accountNumber: "", label: "" })

  const [saleForm, setSaleForm] = React.useState({
    mobileMoneyAccountId: "",
    amount: "",
    feeAmount: "0",
    salesAccount: "701" as "701" | "706",
    date: todayLocal(),
    note: "",
  })

  const [repatForm, setRepatForm] = React.useState({
    mobileMoneyAccountId: "",
    amount: "",
    date: todayLocal(),
    note: "",
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListMobileMoneyAccountsQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListMobileMoneyTransactionsQueryKey() })
  }

  const accountsQuery = useListMobileMoneyAccounts(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId, queryKey: getListMobileMoneyAccountsQueryKey({ clientId: clientId || undefined }) } },
  )
  const accounts = accountsQuery.data ?? []
  const activeAccounts = accounts.filter((a) => a.isActive !== "false")

  const transactionsQuery = useListMobileMoneyTransactions(
    { clientId: clientId || undefined },
    { query: { enabled: !!clientId, queryKey: getListMobileMoneyTransactionsQueryKey({ clientId: clientId || undefined }) } },
  )
  const transactions = transactionsQuery.data ?? []

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)

  const createAccountMutation = useCreateMobileMoneyAccount({
    mutation: {
      onSuccess: () => {
        toast({ title: "Compte Mobile Money ajouté" })
        setAccountDialogOpen(false)
        setNewAccount({ provider: "wave", accountNumber: "", label: "" })
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Impossible d'ajouter ce compte.", variant: "destructive" }),
    },
  })

  const updateAccountMutation = useUpdateMobileMoneyAccount({
    mutation: {
      onSuccess: () => { toast({ title: "Compte mis à jour" }); invalidate() },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error, variant: "destructive" }),
    },
  })

  const saleMutation = useRecordMobileMoneySale({
    mutation: {
      onSuccess: () => {
        toast({ title: "Vente enregistrée", description: "Écriture comptable générée automatiquement." })
        setSaleForm({ mobileMoneyAccountId: "", amount: "", feeAmount: "0", salesAccount: "701", date: todayLocal(), note: "" })
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Enregistrement impossible.", variant: "destructive" }),
    },
  })

  const repatMutation = useCreateMobileMoneyRepatriation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rapatriement initié", description: "En attente de confirmation de réception en banque." })
        setRepatForm({ mobileMoneyAccountId: "", amount: "", date: todayLocal(), note: "" })
        invalidate()
      },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error ?? "Rapatriement impossible.", variant: "destructive" }),
    },
  })

  const confirmRepatMutation = useConfirmMobileMoneyRepatriationReception({
    mutation: {
      onSuccess: () => { toast({ title: "Réception en banque confirmée" }); invalidate() },
      onError: (e: any) => toast({ title: "Erreur", description: e?.data?.error, variant: "destructive" }),
    },
  })

  const pendingRepatriations = transactions.filter((t) => t.type === "outflow" && t.status === "initiated")

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="border-b bg-background">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Smartphone className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Trésorerie Mobile Money</h1>
              <p className="text-sm text-muted-foreground">
                Comptes, ventes, rapatriements et historique de vos mouvements Mobile Money.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" /> Solde total Mobile Money</div>
              <p className="mt-2 text-2xl font-semibold font-mono">{formatFcfa(totalBalance)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Smartphone className="h-4 w-4" /> Comptes actifs</div>
              <p className="mt-2 text-2xl font-semibold">{activeAccounts.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Landmark className="h-4 w-4" /> Rapatriements en attente</div>
              <p className="mt-2 text-2xl font-semibold">{pendingRepatriations.length}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto">
            <TabsList className="w-max min-w-full">
              <TabsTrigger value="comptes"><Settings2 className="mr-1.5 h-4 w-4" />Comptes</TabsTrigger>
              <TabsTrigger value="ventes"><ArrowUpRight className="mr-1.5 h-4 w-4" />Ventes globales</TabsTrigger>
              <TabsTrigger value="rapatriement"><Landmark className="mr-1.5 h-4 w-4" />Rapatriement</TabsTrigger>
              <TabsTrigger value="historique"><History className="mr-1.5 h-4 w-4" />Historique</TabsTrigger>
            </TabsList>
          </div>

          {/* -- Comptes ------------------------------------------------- */}
          <TabsContent value="comptes" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setAccountDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Ajouter un compte
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opérateur</TableHead>
                      <TableHead>Numéro / Compte marchand</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead className="text-right">Solde</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Aucun compte Mobile Money configuré.</TableCell></TableRow>
                    )}
                    {accounts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{PROVIDER_LABELS[a.provider] ?? a.provider}</TableCell>
                        <TableCell className="font-mono">{a.accountNumber}</TableCell>
                        <TableCell>{a.label ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">{formatFcfa(a.balance)}</TableCell>
                        <TableCell>
                          <Badge variant={a.isActive === "false" ? "secondary" : "default"}>
                            {a.isActive === "false" ? "Inactif" : "Actif"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateAccountMutation.mutate({ id: a.id, data: { isActive: a.isActive === "false" } })}
                          >
                            {a.isActive === "false" ? "Réactiver" : "Désactiver"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* -- Ventes globales ------------------------------------------ */}
          <TabsContent value="ventes">
            <Card className="max-w-xl">
              <CardHeader><CardTitle className="text-base">Enregistrer une vente globale</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pour une vente réglée directement sur un compte Mobile Money (hors facturation),
                  sans facture associée — par exemple les encaissements journaliers d'un point de vente.
                </p>
                <div>
                  <Label>Compte Mobile Money <span className="text-destructive">*</span></Label>
                  <Select value={saleForm.mobileMoneyAccountId} onValueChange={(v) => setSaleForm((f) => ({ ...f, mobileMoneyAccountId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sélectionner un compte…" /></SelectTrigger>
                    <SelectContent>
                      {activeAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>{PROVIDER_LABELS[a.provider] ?? a.provider} — {a.accountNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Montant brut (FCFA) <span className="text-destructive">*</span></Label>
                    <AmountInput className="mt-1" value={saleForm.amount} onChange={(e) => setSaleForm((f) => ({ ...f, amount: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Frais opérateur (FCFA)</Label>
                    <AmountInput className="mt-1" value={saleForm.feeAmount} onChange={(e) => setSaleForm((f) => ({ ...f, feeAmount: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Nature</Label>
                    <Select value={saleForm.salesAccount} onValueChange={(v) => setSaleForm((f) => ({ ...f, salesAccount: v as "701" | "706" }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="701">Ventes de marchandises (701)</SelectItem>
                        <SelectItem value="706">Prestations de services (706)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input type="date" className="mt-1" value={saleForm.date} onChange={(e) => setSaleForm((f) => ({ ...f, date: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Note (facultatif)</Label>
                  <Input className="mt-1" value={saleForm.note} onChange={(e) => setSaleForm((f) => ({ ...f, note: e.target.value }))} placeholder="Ex : Ventes du jour — Boutique centre-ville" />
                </div>
                <Button
                  className="w-full"
                  disabled={saleMutation.isPending || !saleForm.mobileMoneyAccountId || !saleForm.amount}
                  onClick={() => {
                    saleMutation.mutate({
                      data: {
                        clientId,
                        mobileMoneyAccountId: Number(saleForm.mobileMoneyAccountId),
                        amount: Number(saleForm.amount),
                        feeAmount: Number(saleForm.feeAmount) || 0,
                        salesAccount: saleForm.salesAccount,
                        date: new Date(saleForm.date).toISOString(),
                        note: saleForm.note.trim() || undefined,
                      },
                    })
                  }}
                >
                  {saleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enregistrer la vente
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* -- Rapatriement ------------------------------------------- */}
          <TabsContent value="rapatriement" className="space-y-4">
            <Card className="max-w-xl">
              <CardHeader><CardTitle className="text-base">Initier un rapatriement vers la banque</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Le montant quitte le compte Mobile Money et transite en attente de confirmation
                  de réception sur le compte bancaire.
                </p>
                <div>
                  <Label>Compte Mobile Money <span className="text-destructive">*</span></Label>
                  <Select value={repatForm.mobileMoneyAccountId} onValueChange={(v) => setRepatForm((f) => ({ ...f, mobileMoneyAccountId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sélectionner un compte…" /></SelectTrigger>
                    <SelectContent>
                      {activeAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {PROVIDER_LABELS[a.provider] ?? a.provider} — {a.accountNumber} (solde : {formatFcfa(a.balance)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Montant (FCFA) <span className="text-destructive">*</span></Label>
                    <AmountInput className="mt-1" value={repatForm.amount} onChange={(e) => setRepatForm((f) => ({ ...f, amount: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input type="date" className="mt-1" value={repatForm.date} onChange={(e) => setRepatForm((f) => ({ ...f, date: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Note (facultatif)</Label>
                  <Input className="mt-1" value={repatForm.note} onChange={(e) => setRepatForm((f) => ({ ...f, note: e.target.value }))} />
                </div>
                <Button
                  className="w-full"
                  disabled={repatMutation.isPending || !repatForm.mobileMoneyAccountId || !repatForm.amount}
                  onClick={() => {
                    repatMutation.mutate({
                      data: {
                        clientId,
                        mobileMoneyAccountId: Number(repatForm.mobileMoneyAccountId),
                        amount: Number(repatForm.amount),
                        date: new Date(repatForm.date).toISOString(),
                        note: repatForm.note.trim() || undefined,
                      },
                    })
                  }}
                >
                  {repatMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Initier le rapatriement
                </Button>
              </CardContent>
            </Card>

            {pendingRepatriations.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Rapatriements en attente de confirmation</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Opérateur</TableHead>
                        <TableHead className="text-right">Montant</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingRepatriations.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>{new Date(t.date).toLocaleDateString("fr-FR")}</TableCell>
                          <TableCell>{PROVIDER_LABELS[t.provider ?? ""] ?? t.provider ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{formatFcfa(t.amount)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              onClick={() => confirmRepatMutation.mutate({ id: t.id })}
                              disabled={confirmRepatMutation.isPending}
                            >
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Confirmer réception
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

          {/* -- Historique ------------------------------------------------ */}
          <TabsContent value="historique">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Opérateur</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead>Facture liée</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Aucun mouvement Mobile Money pour le moment.</TableCell></TableRow>
                    )}
                    {transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{new Date(t.date).toLocaleDateString("fr-FR")}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            {t.type === "inflow" && <ArrowDownRight className="h-3.5 w-3.5 text-emerald-600" />}
                            {t.type === "outflow" && <ArrowUpRight className="h-3.5 w-3.5 text-amber-600" />}
                            {t.type === "transfer_received" && <Landmark className="h-3.5 w-3.5 text-blue-600" />}
                            {t.type === "inflow" ? "Encaissement" : t.type === "outflow" ? "Rapatriement (sortie)" : "Réception banque"}
                          </span>
                        </TableCell>
                        <TableCell>{PROVIDER_LABELS[t.provider ?? ""] ?? t.provider ?? "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate" title={t.label}>{t.label}</TableCell>
                        <TableCell>{t.invoiceNumber ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">{formatFcfa(t.amount)}</TableCell>
                        <TableCell>
                          <Badge variant={t.status === "initiated" ? "secondary" : "default"}>
                            {t.status === "initiated" ? "En attente" : "Terminé"}
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

      {/* Add account dialog */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un compte Mobile Money</DialogTitle>
            <DialogDescription>Enregistrez un compte marchand ou un numéro utilisé pour encaisser vos clients.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Opérateur <span className="text-destructive">*</span></Label>
              <Select value={newAccount.provider} onValueChange={(v) => setNewAccount((f) => ({ ...f, provider: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Numéro / Compte marchand <span className="text-destructive">*</span></Label>
              <Input className="mt-1" value={newAccount.accountNumber} onChange={(e) => setNewAccount((f) => ({ ...f, accountNumber: e.target.value }))} placeholder="Ex : 07 00 00 00 00" />
            </div>
            <div>
              <Label>Libellé (facultatif)</Label>
              <Input className="mt-1" value={newAccount.label} onChange={(e) => setNewAccount((f) => ({ ...f, label: e.target.value }))} placeholder="Ex : Boutique centre-ville" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountDialogOpen(false)}>Annuler</Button>
            <Button
              disabled={createAccountMutation.isPending || !newAccount.accountNumber.trim()}
              onClick={() => createAccountMutation.mutate({
                data: { clientId, provider: newAccount.provider as any, accountNumber: newAccount.accountNumber.trim(), label: newAccount.label.trim() || undefined },
              })}
            >
              {createAccountMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
