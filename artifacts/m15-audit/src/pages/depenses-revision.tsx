/**
 * Module Cabinet — Révision des Dépenses PME
 * Accountants review structured purchases submitted by PME clients,
 * optionally correct the SYSCOHADA charge account, then validate to lock.
 */
import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListPurchases,
  useValidatePurchase,
  useGetPurchaseReceipt,
  useListPurchaseCategories,
  getListPurchasesQueryKey,
} from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import { formatFcfa } from "@/lib/status"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ShieldCheck, Loader2, Clock, CheckCircle2, FileText,
  Paperclip, Eye, AlertCircle, Building2, RefreshCw,
  ClipboardCheck, Check, ChevronsUpDown,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAYMENT_MODE_LABELS: Record<string, string> = {
  credit:       "À crédit",
  bank:         "Banque",
  mobile_money: "Mobile Money",
}

const REVIEW_STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  brouillon:  { label: "Brouillon",  icon: <Clock className="h-3 w-3" />,         className: "bg-slate-100 text-slate-600 border-slate-200" },
  en_attente: { label: "À valider",  icon: <AlertCircle className="h-3 w-3" />,    className: "bg-amber-50 text-amber-700 border-amber-200" },
  valide:     { label: "Validée",    icon: <ShieldCheck className="h-3 w-3" />,    className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
}

// ---------------------------------------------------------------------------
// Receipt preview helpers
// ---------------------------------------------------------------------------
function ReceiptPanel({ purchaseId, enabled }: { purchaseId: number; enabled: boolean }) {
  const query = useGetPurchaseReceipt(purchaseId, { query: { enabled } as any })

  if (!enabled) return null
  if (query.isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
  if (query.isError || !query.data) return (
    <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
      <FileText className="h-10 w-10" />
      <p className="text-sm">Aucune pièce jointe</p>
    </div>
  )

  const { fileData, fileName, mimeType } = query.data
  const src = `data:${mimeType};base64,${fileData}`

  if (mimeType?.startsWith("image/")) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground font-medium truncate">{fileName}</p>
        <img src={src} alt={fileName ?? "justificatif"} className="rounded-md border max-h-[55vh] object-contain w-full bg-muted/20" />
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <FileText className="h-14 w-14 text-muted-foreground" />
      <p className="text-sm font-medium">{fileName}</p>
      <a href={src} download={fileName ?? "justificatif.pdf"} className="inline-flex items-center gap-1.5 text-sm text-primary underline">
        <Eye className="h-4 w-4" />Télécharger le PDF
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function DepensesRevision() {
  const { toast }        = useToast()
  const queryClient      = useQueryClient()
  const [activeTab, setActiveTab] = React.useState<"en_attente" | "valide">("en_attente")
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [correctedAccount, setCorrectedAccount] = React.useState("")
  const [accountComboOpen, setAccountComboOpen] = React.useState(false)
  const [correctedName, setCorrectedName] = React.useState("")

  // ── Data ─────────────────────────────────────────────────────────────────
  const pendingQuery = useListPurchases(
    { reviewStatus: "en_attente" },
    { query: { refetchInterval: 30_000 } as any },
  )
  const validatedQuery = useListPurchases(
    { reviewStatus: "valide" },
    { query: {} as any },
  )
  const categoriesQuery = useListPurchaseCategories()
  const categories = categoriesQuery.data ?? []

  const pendingList   = pendingQuery.data ?? []
  const validatedList = validatedQuery.data ?? []
  const activeList    = activeTab === "en_attente" ? pendingList : validatedList
  const selected      = activeList.find((p) => p.id === selectedId) ?? null

  // Open first item automatically when list loads
  React.useEffect(() => {
    if (pendingList.length && selectedId === null) setSelectedId(pendingList[0].id)
  }, [pendingList.length]) // eslint-disable-line

  // Reset correction fields when selection changes
  React.useEffect(() => {
    setCorrectedAccount("")
    setCorrectedName("")
  }, [selectedId])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const validateMutation = useValidatePurchase({
    mutation: {
      onSuccess: (updated) => {
        toast({
          title: "Dépense validée ✓",
          description: `${updated.supplierName} — ${formatFcfa(updated.amountTtc)} — écriture comptable verrouillée.`,
        })
        queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() })
        // Move to next pending item
        const remaining = pendingList.filter((p) => p.id !== updated.id)
        setSelectedId(remaining[0]?.id ?? null)
        setCorrectedAccount("")
        setCorrectedName("")
      },
      onError: (e: any) => toast({
        title: "Erreur de validation",
        description: e?.data?.error ?? "Validation impossible.",
        variant: "destructive",
      }),
    },
  })

  function handleValidate() {
    if (!selected) return
    validateMutation.mutate({
      id: selected.id,
      data: {
        correctedChargeAccount: correctedAccount || undefined,
        correctedChargeName: correctedName || undefined,
      },
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/20">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2"><ClipboardCheck className="h-6 w-6 text-primary" /></div>
              <div>
                <h1 className="text-xl font-semibold">Révision Dépenses PME</h1>
                <p className="text-sm text-muted-foreground">
                  Contrôle des pièces, correction d'imputation et validation des écritures.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pendingList.length > 0 && (
                <Badge className="rounded-full bg-amber-500 text-white px-2.5">
                  {pendingList.length} à valider
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => {
                pendingQuery.refetch(); validatedQuery.refetch()
              }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Actualiser
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as typeof activeTab); setSelectedId(null) }}>
          <TabsList className="mb-4">
            <TabsTrigger value="en_attente">
              <AlertCircle className="mr-1.5 h-4 w-4" />
              À valider
              {pendingList.length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5">
                  {pendingList.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="valide">
              <ShieldCheck className="mr-1.5 h-4 w-4" />Validées
            </TabsTrigger>
          </TabsList>

          {(["en_attente", "valide"] as const).map((tabKey) => (
            <TabsContent key={tabKey} value={tabKey}>
              {(tabKey === "en_attente" ? pendingQuery.isLoading : validatedQuery.isLoading) ? (
                <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : activeList.length === 0 ? (
                <Card><CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                  <p className="text-sm font-medium">{tabKey === "en_attente" ? "Aucune dépense en attente de validation." : "Aucune dépense validée."}</p>
                </CardContent></Card>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
                  {/* ── Left: purchase list ─────────────────────────────── */}
                  <div className="space-y-2">
                    {activeList.map((p) => {
                      const rs = REVIEW_STATUS_CONFIG[p.reviewStatus]
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedId(p.id)}
                          className={cn(
                            "w-full text-left rounded-lg border p-3 transition-all hover:shadow-sm",
                            selectedId === p.id ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-background hover:bg-muted/30",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <p className="text-xs text-muted-foreground truncate">{p.clientName ?? `Client #${p.clientId}`}</p>
                              </div>
                              <p className="text-sm font-semibold truncate">{p.supplierName}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                <span className="font-mono">{p.chargeAccount}</span> — {p.categoryLabel}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-mono font-semibold">{formatFcfa(p.amountTtc)}</p>
                              <p className="text-[10px] text-muted-foreground">{new Date(p.date).toLocaleDateString("fr-FR")}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", rs?.className)}>
                              {rs?.icon}<span className="ml-1">{rs?.label}</span>
                            </Badge>
                            {p.hasReceipt && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30"><Paperclip className="h-2.5 w-2.5 mr-0.5" />Justif.</Badge>}
                            {p.aibAmount > 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0">AIB {p.aibRate}%</Badge>}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* ── Right: review panel ─────────────────────────────── */}
                  {selected ? (
                    <Card className="h-fit">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base">{selected.supplierName}</CardTitle>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {new Date(selected.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                            </p>
                          </div>
                          <Badge variant="outline" className={cn("text-xs", REVIEW_STATUS_CONFIG[selected.reviewStatus]?.className)}>
                            {REVIEW_STATUS_CONFIG[selected.reviewStatus]?.label}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* Two-column layout on wide screens */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                          {/* ─ Left column: receipt ─ */}
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pièce justificative</p>
                            <div className="rounded-md border bg-muted/10 p-3 min-h-[200px] flex flex-col">
                              <ReceiptPanel purchaseId={selected.id} enabled={selected.hasReceipt} />
                              {!selected.hasReceipt && (
                                <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground py-8">
                                  <FileText className="h-10 w-10" />
                                  <p className="text-sm text-center">Aucune pièce jointe.<br /><span className="text-xs">Le PME n'a pas joint de justificatif.</span></p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* ─ Right column: details + correction ─ */}
                          <div className="space-y-4">
                            {/* Amounts breakdown */}
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Montants</p>
                              <div className="rounded-md border bg-muted/20 px-4 py-3 space-y-1.5 text-sm">
                                <div className="flex justify-between"><span className="text-muted-foreground">Montant HT</span><span className="font-mono font-medium">{formatFcfa(selected.amountHt)}</span></div>
                                {selected.vatAmount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">TVA {selected.vatRate}%</span><span className="font-mono">+{formatFcfa(selected.vatAmount)}</span></div>}
                                <div className="flex justify-between border-t pt-1.5"><span className="text-muted-foreground">TTC</span><span className="font-mono font-semibold">{formatFcfa(selected.amountTtc)}</span></div>
                                {selected.aibAmount > 0 && (
                                  <>
                                    <div className="flex justify-between"><span className="text-muted-foreground">AIB {selected.aibRate}% retenu <span className="font-mono text-xs">(447200)</span></span><span className="font-mono text-red-700">−{formatFcfa(selected.aibAmount)}</span></div>
                                    <div className="flex justify-between border-t pt-1.5 font-medium"><span>Net payable</span><span className="font-mono text-emerald-700">{formatFcfa(selected.amountTtc - selected.aibAmount)}</span></div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Info */}
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Informations</p>
                              <dl className="rounded-md border divide-y text-sm">
                                {[
                                  ["Client",    selected.clientName ?? `#${selected.clientId}`],
                                  ["Mode",      PAYMENT_MODE_LABELS[selected.paymentMode]],
                                  ["N° facture",selected.invoiceRef ?? "—"],
                                  ["NCC",       selected.supplierNcc ?? "—"],
                                  ["Notes",     selected.notes ?? "—"],
                                ].map(([k, v]) => (
                                  <div key={k} className="flex px-3 py-2 gap-2">
                                    <dt className="text-muted-foreground min-w-[90px]">{k}</dt>
                                    <dd className="font-medium truncate">{v}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>

                            {/* Journal lines preview */}
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Écriture générée</p>
                              <div className="rounded-md border divide-y text-xs font-mono">
                                {/* Charge line */}
                                <div className="flex items-center justify-between px-3 py-2 gap-2">
                                  <span className="text-blue-700">Dr {selected.chargeAccount}</span>
                                  <span className="text-muted-foreground truncate mx-2 flex-1">{selected.chargeName}</span>
                                  <span className="font-semibold">{formatFcfa(selected.amountHt)}</span>
                                </div>
                                {selected.vatAmount > 0 && (
                                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                                    <span className="text-blue-700">Dr 4451</span>
                                    <span className="text-muted-foreground flex-1 mx-2">TVA récupérable</span>
                                    <span>{formatFcfa(selected.vatAmount)}</span>
                                  </div>
                                )}
                                {selected.aibAmount > 0 && selected.paymentMode !== "credit" && (
                                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                                    <span className="text-emerald-700">Cr 447200</span>
                                    <span className="text-muted-foreground flex-1 mx-2">État, AIB retenu</span>
                                    <span>{formatFcfa(selected.aibAmount)}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between px-3 py-2 gap-2">
                                  <span className="text-emerald-700">Cr {selected.paymentMode === "credit" ? "4011" : selected.paymentMode === "bank" ? "5211" : "552xxx"}</span>
                                  <span className="text-muted-foreground flex-1 mx-2">{selected.paymentMode === "credit" ? "Fournisseurs" : selected.paymentMode === "bank" ? "Banques locales" : "Mobile Money"}</span>
                                  <span>{formatFcfa(selected.paymentMode === "credit" ? selected.amountTtc : selected.amountTtc - selected.aibAmount)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Account correction — only for pending */}
                            {selected.reviewStatus === "en_attente" && (
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Correction d'imputation (facultatif)</p>
                                <div className="space-y-2">
                                  <div>
                                    <Label className="text-xs">Compte de charge corrigé</Label>
                                    <Popover open={accountComboOpen} onOpenChange={setAccountComboOpen}>
                                      <PopoverTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          role="combobox"
                                          className="w-full justify-between font-normal mt-1 text-sm h-9"
                                        >
                                          <span className="truncate">
                                            {correctedAccount
                                              ? categories.find(c => c.account === correctedAccount)?.label ?? correctedAccount
                                              : `Actuel : ${selected.chargeAccount} — ${selected.chargeName}`}
                                          </span>
                                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                        <Command>
                                          <CommandInput placeholder="Rechercher par compte ou libellé…" />
                                          <CommandList>
                                            <CommandEmpty>Aucun compte trouvé.</CommandEmpty>
                                            <CommandGroup>
                                              <CommandItem
                                                value="__keep__ Conserver l'imputation PME"
                                                onSelect={() => {
                                                  setCorrectedAccount("")
                                                  setCorrectedName("")
                                                  setAccountComboOpen(false)
                                                }}
                                              >
                                                <Check className={cn("mr-2 h-4 w-4 shrink-0", correctedAccount === "" ? "opacity-100" : "opacity-0")} />
                                                <span className="text-muted-foreground italic">Conserver l'imputation PME</span>
                                              </CommandItem>
                                              {categories.map((c) => (
                                                <CommandItem
                                                  key={c.key}
                                                  value={`${c.account} ${c.label}`}
                                                  onSelect={() => {
                                                    setCorrectedAccount(c.account)
                                                    setCorrectedName(c.accountName ?? "")
                                                    setAccountComboOpen(false)
                                                  }}
                                                >
                                                  <Check className={cn("mr-2 h-4 w-4 shrink-0", correctedAccount === c.account ? "opacity-100" : "opacity-0")} />
                                                  <span className="font-mono text-xs text-muted-foreground mr-2">{c.account}</span>
                                                  {c.label}
                                                </CommandItem>
                                              ))}
                                            </CommandGroup>
                                          </CommandList>
                                        </Command>
                                      </PopoverContent>
                                    </Popover>
                                  </div>
                                  {correctedAccount && correctedAccount !== selected.chargeAccount && (
                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                                      ⚠ Le journal existant sera mis à jour : <span className="font-mono">{selected.chargeAccount}</span> → <span className="font-mono">{correctedAccount}</span>
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Validation CTA */}
                            {selected.reviewStatus === "en_attente" && (
                              <Button
                                className="w-full"
                                size="lg"
                                disabled={validateMutation.isPending}
                                onClick={handleValidate}
                              >
                                {validateMutation.isPending
                                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Validation en cours…</>
                                  : <><ShieldCheck className="mr-2 h-4 w-4" />Valider l'écriture comptable</>}
                              </Button>
                            )}

                            {selected.reviewStatus === "valide" && (
                              <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-sm text-emerald-700">
                                <ShieldCheck className="h-4 w-4 shrink-0" />
                                <span>Écriture validée et verrouillée.</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <CardContent className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
                        <ClipboardCheck className="h-10 w-10" />
                        <p className="text-sm">Sélectionnez une dépense dans la liste.</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  )
}
