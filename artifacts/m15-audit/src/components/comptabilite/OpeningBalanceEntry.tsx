/**
 * Saisie de la Balance d'Entrée (À-nouveaux manuels)
 *
 * Affiché dans l'onglet "Flux de Saisie" uniquement quand le client est
 * éligible : dossier en Reprise de dossier (isReprise = true), capital non
 * encore initialisé, exercice cible sans aucune opération existante.
 *
 * L'expert-comptable saisit les lignes débit/crédit de son bilan d'ouverture,
 * l'interface vérifie l'équilibre en temps réel, puis envoie le tout au
 * moteur backend (opening-balance-engine) via POST /clients/:id/opening-balance.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useGetOpeningBalanceEligibility,
  getGetOpeningBalanceEligibilityQueryKey,
  useCreateOpeningBalance,
  useListAccounts,
  getListAccountsQueryKey,
  getGetClientQueryKey,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react"
import type {
  PlanComptableAccount,
  OpeningBalanceEligibility,
  OpeningBalanceResult,
} from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import { formatFcfa } from "@/lib/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  BookMarked,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntryRow {
  /** Stable key for React list rendering — never sent to the backend. */
  key: string
  accountNumber: string
  accountName: string
  /** String so the <input type="number"> remains controlled without NaN edge-cases. */
  debitAmount: string
  creditAmount: string
}

interface OpeningBalanceEntryProps {
  clientId: number
  clientName: string
}

// ---------------------------------------------------------------------------
// Eligibility classifier
//
// Maps the backend's eligibility response onto a stable discriminated union so
// the rest of the component never pattern-matches raw French strings inline.
// The substrings matched here correspond to the exact messages in
// artifacts/api-server/src/lib/opening-balance-engine.ts; update both if the
// backend messages ever change.
// ---------------------------------------------------------------------------

type EligibilityScenario =
  | "loading"           // eligibility query hasn't resolved yet
  | "eligible"          // client can enter the opening balance
  | "not_reprise"       // not a Reprise de dossier client → hide entirely
  | "not_found"         // client record missing → hide entirely
  | "already_done"      // capital already initialized → show done notice
  | "year_has_entries"  // selected year has existing transactions → show year picker
  | "unknown"           // unrecognised ineligibility reason → hide to be safe

function classifyEligibility(
  isLoading: boolean,
  data: OpeningBalanceEligibility | undefined,
): EligibilityScenario {
  if (isLoading || data === undefined) return "loading"
  if (data.eligible) return "eligible"
  const reason = data.reason ?? ""
  if (reason.includes("Reprise de dossier")) return "not_reprise"
  if (reason.includes("introuvable"))         return "not_found"
  if (reason.includes("déjà été saisie"))     return "already_done"
  if (reason.includes("comporte déjà des"))   return "year_has_entries"
  return "unknown"
}

// ---------------------------------------------------------------------------
// Year range helper
// ---------------------------------------------------------------------------

function buildYearOptions(): number[] {
  const current = new Date().getFullYear()
  // Allow reprising dossiers up to 5 fiscal years back, plus the current year.
  return Array.from({ length: 6 }, (_, i) => current - i)
}

// ---------------------------------------------------------------------------
// Account autocomplete dropdown
// ---------------------------------------------------------------------------

interface AccountAutocompleteProps {
  value: string
  onChange: (accountNumber: string, accountName: string) => void
  disabled?: boolean
  hasError?: boolean
}

function AccountAutocomplete({
  value,
  onChange,
  disabled,
  hasError,
}: AccountAutocompleteProps) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState("")

  // Debounce the search query to avoid flooding the API.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const { data: accounts = [], isFetching } = useListAccounts(
    { search: debouncedQuery },
    {
      query: {
        enabled: debouncedQuery.length >= 1,
        queryKey: getListAccountsQueryKey({ search: debouncedQuery }),
      },
    },
  )

  // Close dropdown on outside click.
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onOutside)
    return () => document.removeEventListener("mousedown", onOutside)
  }, [])

  const showDropdown = open && focused && debouncedQuery.length >= 1 && accounts.length > 0

  function handleSelect(acc: PlanComptableAccount) {
    setQuery(acc.accountNumber)
    setOpen(false)
    onChange(acc.accountNumber, acc.name)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    setOpen(true)
    if (!v) onChange("", "")
  }

  // Keep local query in sync when the parent resets the grid.
  useEffect(() => { setQuery(value) }, [value])

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          value={query}
          onChange={handleChange}
          onFocus={() => { setFocused(true); setOpen(true) }}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          placeholder="Ex : 1011"
          autoComplete="off"
          className={cn(
            "font-mono h-8 text-sm pr-6",
            hasError && "border-amber-400 focus-visible:ring-amber-400",
          )}
        />
        {isFetching && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </div>
      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 left-0 w-72 max-h-52 overflow-y-auto rounded-md border bg-popover shadow-md text-sm">
          {accounts.map((acc) => (
            <button
              key={acc.accountNumber}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(acc) }}
              className="w-full flex items-start gap-2 px-3 py-2 hover:bg-accent text-left"
            >
              <span className="font-mono font-semibold text-xs shrink-0 mt-0.5 text-primary">
                {acc.accountNumber}
              </span>
              <span className="text-xs text-muted-foreground leading-tight line-clamp-2">
                {acc.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function makeRow(): EntryRow {
  return {
    key: crypto.randomUUID(),
    accountNumber: "",
    accountName: "",
    debitAmount: "",
    creditAmount: "",
  }
}

export function OpeningBalanceEntry({ clientId, clientName }: OpeningBalanceEntryProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const yearOptions = buildYearOptions()
  const [year, setYear] = useState<number>(yearOptions[0])
  const [collapsed, setCollapsed] = useState(false)
  const [rows, setRows] = useState<EntryRow[]>([makeRow()])
  const [submitted, setSubmitted] = useState(false)

  // ---------------------------------------------------------------------------
  // Eligibility check
  // ---------------------------------------------------------------------------
  const { data: eligibility, isLoading: eligibilityLoading } = useGetOpeningBalanceEligibility(
    clientId,
    { year },
    {
      query: {
        queryKey: getGetOpeningBalanceEligibilityQueryKey(clientId, { year }),
        enabled: !!clientId,
      },
    },
  )

  const scenario = classifyEligibility(eligibilityLoading, eligibility)

  // ---------------------------------------------------------------------------
  // Row helpers
  // ---------------------------------------------------------------------------
  function addRow() {
    setRows((prev) => [...prev, makeRow()])
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function updateRowAccount(key: string, accountNumber: string, accountName: string) {
    setRows((prev) =>
      prev.map((r) => r.key === key ? { ...r, accountNumber, accountName } : r),
    )
  }

  function updateRowAmount(key: string, field: "debitAmount" | "creditAmount", value: string) {
    // SYSCOHADA partial double-entry: each line is debit OR credit, not both.
    // Auto-clear the opposite field when a positive value is entered.
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r
        const opposite = field === "debitAmount" ? "creditAmount" : "debitAmount"
        const next = { ...r, [field]: value }
        if (value !== "" && Number(value) > 0) next[opposite] = ""
        return next
      }),
    )
  }

  // ---------------------------------------------------------------------------
  // Derived validation state
  //
  // KEY INVARIANT: every derived quantity (totals, isBalanced, canSubmit) is
  // computed from `postableRows` — the exact same set of lines that will be
  // sent to the backend. Rows that have amounts but no account number are
  // surfaced as `incompleteRows` and block submission so the UI and payload
  // stay in sync.
  // ---------------------------------------------------------------------------
  const postableRows = rows.filter((r) => r.accountNumber.trim() !== "")

  const incompleteRows = rows.filter(
    (r) =>
      r.accountNumber.trim() === "" &&
      (parseFloat(r.debitAmount) > 0 || parseFloat(r.creditAmount) > 0),
  )

  const totalDebit  = postableRows.reduce((s, r) => s + (parseFloat(r.debitAmount)  || 0), 0)
  const totalCredit = postableRows.reduce((s, r) => s + (parseFloat(r.creditAmount) || 0), 0)
  const ecart       = Math.round((totalDebit - totalCredit) * 100) / 100

  const isBalanced = ecart === 0 && totalDebit > 0

  // ---------------------------------------------------------------------------
  // Mutation — typed via generated OpeningBalanceResult
  // ---------------------------------------------------------------------------
  const createMutation = useCreateOpeningBalance({
    mutation: {
      onSuccess: (data: OpeningBalanceResult) => {
        toast({
          title: "Balance d'entrée enregistrée",
          description: `${data.accountsCount} compte(s) · ${formatFcfa(data.totalAmount)} · Exercice ${data.year}.`,
        })
        setSubmitted(true)
        // Flip isCapitalInitialized on the cached client record and refresh
        // the transaction list so the new à-nouveaux entry appears immediately.
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) })
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() })
        // Re-check eligibility — the component should transition to the
        // "already done" notice on next render.
        queryClient.invalidateQueries({
          queryKey: getGetOpeningBalanceEligibilityQueryKey(clientId, { year }),
        })
      },
      onError: (error: { data?: { error?: string } }) => {
        toast({
          title: "Erreur de saisie",
          description:
            error?.data?.error ?? "Impossible d'enregistrer la balance d'entrée.",
          variant: "destructive",
        })
      },
    },
  })

  const canSubmit  =
    postableRows.length > 0 &&
    isBalanced &&
    incompleteRows.length === 0 &&
    scenario === "eligible" &&
    !createMutation.isPending

  const handleSubmit = useCallback(() => {
    const lines = postableRows.map((r) => ({
      accountNumber: r.accountNumber.trim(),
      debitAmount:   parseFloat(r.debitAmount)  || 0,
      creditAmount:  parseFloat(r.creditAmount) || 0,
    }))
    createMutation.mutate({ id: clientId, data: { year, lines } })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postableRows, year, clientId])

  // ---------------------------------------------------------------------------
  // Render — gate on scenario
  // ---------------------------------------------------------------------------

  // Still resolving — render nothing to avoid layout shift.
  if (scenario === "loading") return null

  // Client is not a Reprise de dossier, or record not found → hide silently.
  if (scenario === "not_reprise" || scenario === "not_found" || scenario === "unknown") return null

  // Submitted this session → compact success notice.
  if (submitted) {
    return (
      <Alert className="border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <AlertTitle className="text-emerald-800 dark:text-emerald-300">
          Balance d'entrée enregistrée
        </AlertTitle>
        <AlertDescription className="text-emerald-700 dark:text-emerald-400 text-sm">
          L'écriture d'À-nouveaux a été comptabilisée dans le Journal AN/OD. Elle apparaît
          maintenant dans le Flux de Saisie ci-dessous à l'état{" "}
          <strong>Validée</strong>.
        </AlertDescription>
      </Alert>
    )
  }

  // Capital already initialized in a previous session → read-only notice.
  if (scenario === "already_done") {
    return (
      <Alert className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertTitle className="text-blue-800 dark:text-blue-300">
          Balance d'entrée déjà enregistrée
        </AlertTitle>
        <AlertDescription className="text-blue-700 dark:text-blue-400 text-sm">
          {eligibility?.reason}
        </AlertDescription>
      </Alert>
    )
  }

  // ---------------------------------------------------------------------------
  // Entry grid (scenario === "eligible" | "year_has_entries")
  // ---------------------------------------------------------------------------
  return (
    <Card className="border-indigo-200 dark:border-indigo-800 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BookMarked className="h-5 w-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                Saisie de la Balance d'Entrée
                <Badge
                  variant="outline"
                  className="border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-medium"
                >
                  À-nouveaux · Reprise de dossier
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Saisie unique — les lignes seront comptabilisées dans le Journal AN/OD,
                datées du 1<sup>er</sup>&nbsp;janvier de l'exercice retenu.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-7 w-7"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Développer" : "Réduire"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-0 space-y-4">

          {/* ---- Year selector ---- */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Exercice fiscal :
            </label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Inline notice when the chosen year already has transactions. */}
            {scenario === "year_has_entries" && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {eligibility?.reason}
              </span>
            )}
          </div>

          {/* ---- Entry grid ---- */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-40">
                    N° Compte (SYSCOHADA)
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">
                    Intitulé du compte
                  </th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground w-36">
                    Débit (FCFA)
                  </th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground w-36">
                    Crédit (FCFA)
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isIncomplete =
                    row.accountNumber.trim() === "" &&
                    (parseFloat(row.debitAmount) > 0 || parseFloat(row.creditAmount) > 0)

                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        "border-b last:border-0 transition-colors",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                        isIncomplete && "bg-amber-50/60 dark:bg-amber-950/10",
                      )}
                    >
                      {/* Compte autocomplete */}
                      <td className="px-2 py-1.5">
                        <AccountAutocomplete
                          value={row.accountNumber}
                          onChange={(num, name) => updateRowAccount(row.key, num, name)}
                          disabled={createMutation.isPending || scenario !== "eligible"}
                          hasError={isIncomplete}
                        />
                        {isIncomplete && (
                          <p className="text-[10px] text-amber-600 mt-0.5 px-0.5">
                            Numéro de compte requis
                          </p>
                        )}
                      </td>

                      {/* Intitulé — read-only, auto-filled on account selection */}
                      <td className="px-3 py-1.5">
                        {row.accountName ? (
                          <span className="text-sm">{row.accountName}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            Auto-rempli après sélection
                          </span>
                        )}
                      </td>

                      {/* Débit */}
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={row.debitAmount}
                          onChange={(e) => updateRowAmount(row.key, "debitAmount", e.target.value)}
                          disabled={createMutation.isPending || scenario !== "eligible"}
                          placeholder="0"
                          className="h-8 text-right text-sm tabular-nums"
                        />
                      </td>

                      {/* Crédit */}
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={row.creditAmount}
                          onChange={(e) => updateRowAmount(row.key, "creditAmount", e.target.value)}
                          disabled={createMutation.isPending || scenario !== "eligible"}
                          placeholder="0"
                          className="h-8 text-right text-sm tabular-nums"
                        />
                      </td>

                      {/* Delete row */}
                      <td className="px-1 py-1.5 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(row.key)}
                          disabled={rows.length === 1 || createMutation.isPending}
                          aria-label="Supprimer la ligne"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Totals footer — always reflects the postable rows exactly */}
              <tfoot>
                <tr className="bg-muted/50 border-t-2 font-semibold">
                  <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}>
                    Totaux (lignes avec N° de compte)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-sm">
                    <span className={cn(totalDebit > 0 ? "text-foreground" : "text-muted-foreground")}>
                      {formatFcfa(totalDebit)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-sm">
                    <span className={cn(totalCredit > 0 ? "text-foreground" : "text-muted-foreground")}>
                      {formatFcfa(totalCredit)}
                    </span>
                  </td>
                  <td />
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}>
                    Écart (Débit − Crédit)
                  </td>
                  <td
                    colSpan={2}
                    className={cn(
                      "px-3 py-2 text-right tabular-nums text-sm font-bold",
                      ecart === 0 && totalDebit > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {totalDebit === 0 && totalCredit === 0
                      ? "—"
                      : ecart === 0
                      ? "Équilibrée ✓"
                      : formatFcfa(Math.abs(ecart))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Add row */}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-sm"
            onClick={addRow}
            disabled={createMutation.isPending || scenario !== "eligible"}
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter une ligne
          </Button>

          {/* Validation messages — each addresses a specific blocking condition */}
          <div className="space-y-1.5">
            {postableRows.length === 0 && (
              <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Saisissez au moins une ligne avec un numéro de compte pour valider.
              </p>
            )}
            {incompleteRows.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {incompleteRows.length === 1
                  ? "Une ligne comporte un montant mais aucun numéro de compte — complétez-la ou supprimez-la."
                  : `${incompleteRows.length} lignes comportent un montant mais aucun numéro de compte — complétez-les ou supprimez-les.`}
              </p>
            )}
            {postableRows.length > 0 && incompleteRows.length === 0 && !isBalanced && totalCredit === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                La balance doit être équilibrée pour être enregistrée — aucune ligne de crédit n'a été saisie.
              </p>
            )}
            {postableRows.length > 0 && incompleteRows.length === 0 && !isBalanced && totalCredit > 0 && totalDebit > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                La balance doit être équilibrée pour être enregistrée (écart de{" "}
                {formatFcfa(Math.abs(ecart))}).
              </p>
            )}
          </div>

          <Separator />

          {/* Submit footer */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-muted-foreground max-w-md">
              Une fois validée, cette écriture est{" "}
              <strong>définitive et non répétable</strong>. Elle sera datée du
              1<sup>er</sup>&nbsp;janvier {year} dans le Journal AN/OD pour le
              dossier <strong>{clientName || "sélectionné"}</strong>.
            </p>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="gap-2 shrink-0"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enregistrement…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Valider la balance d'entrée
                </>
              )}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
