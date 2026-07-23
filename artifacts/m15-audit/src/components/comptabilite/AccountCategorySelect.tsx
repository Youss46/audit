/**
 * AccountCategorySelect — AI-powered SYSCOHADA category combobox.
 *
 * Behaviour:
 *  • Static category list is shown immediately (from the loaded catalog).
 *  • As the user types (or when a supplier name is set), calls
 *    POST /api/ai/suggest-account with a 300 ms debounce.
 *  • AI top-pick is pinned at the top of the list with a ✨ badge.
 *  • If a single suggestion comes back with confidence > 0.90, it is
 *    auto-selected and the popover closes.
 */

import * as React from "react"
import { Check, ChevronsUpDown, Sparkles, Loader2, Building2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getApiBase, getToken } from "@/lib/auth"
import type { ListPurchaseCategories200Item } from "@workspace/api-client-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiSuggestion {
  key:             string
  label:           string
  account:         string
  accountName:     string
  vatEligible:     boolean
  isImmobilisation: boolean
  confidenceScore: number
  reasoning:       string
}

interface SuggestResponse {
  suggestions: AiSuggestion[]
  usedAI:      boolean
}

export interface AccountCategorySelectProps {
  value:        string
  onChange:     (key: string) => void
  categories:   ListPurchaseCategories200Item[]
  supplierName?: string
  disabled?:    boolean
  className?:   string
}

// ---------------------------------------------------------------------------
// Hook — debounced AI suggest
// ---------------------------------------------------------------------------

function useAiSuggest(query: string, supplierName: string | undefined) {
  const [suggestions, setSuggestions] = React.useState<AiSuggestion[]>([])
  const [usedAI,      setUsedAI]      = React.useState(false)
  const [loading,     setLoading]     = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Key that triggers a new fetch: either the typed query or the supplier name
  const triggerKey = `${query}|||${supplierName ?? ""}`

  React.useEffect(() => {
    const effectiveQuery = query.trim() || supplierName?.trim()
    if (!effectiveQuery || effectiveQuery.length < 2) {
      setSuggestions([])
      setUsedAI(false)
      setLoading(false)
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    setLoading(true)

    timerRef.current = setTimeout(async () => {
      try {
        const token = getToken()
        const base  = getApiBase()
        const res   = await fetch(`${base}/api/ai/suggest-account`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            query:        effectiveQuery,
            supplierName: supplierName?.trim() || undefined,
          }),
          signal: AbortSignal.timeout(10_000),
        })

        if (!res.ok) { setLoading(false); return }

        const data: SuggestResponse = await res.json()
        setSuggestions(data.suggestions ?? [])
        setUsedAI(data.usedAI ?? false)
      } catch {
        // network or timeout — fail silently
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey])

  return { suggestions, usedAI, loading }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AccountCategorySelect({
  value,
  onChange,
  categories,
  supplierName,
  disabled,
  className,
}: AccountCategorySelectProps) {
  const [open,        setOpen]        = React.useState(false)
  const [inputValue,  setInputValue]  = React.useState("")
  const autoFilledRef                 = React.useRef<string>("")

  const { suggestions, usedAI, loading } = useAiSuggest(inputValue, supplierName)

  // ── Auto-fill when single high-confidence result ─────────────────────────
  React.useEffect(() => {
    if (
      suggestions.length === 1 &&
      suggestions[0].confidenceScore >= 0.9 &&
      suggestions[0].key !== value &&
      suggestions[0].key !== autoFilledRef.current
    ) {
      autoFilledRef.current = suggestions[0].key
      onChange(suggestions[0].key)
      setOpen(false)
    }
  }, [suggestions, value, onChange])

  // ── Reset auto-fill guard when user explicitly clears ────────────────────
  React.useEffect(() => {
    if (!value) autoFilledRef.current = ""
  }, [value])

  // ── Derived display values ────────────────────────────────────────────────
  const selectedCategory = categories.find((c) => c.key === value)
  const selectedLabel    = selectedCategory?.label ?? "Sélectionner une catégorie…"

  // Filter static categories by input text (fallback list)
  const filteredCategories = React.useMemo(() => {
    if (!inputValue.trim()) return categories
    const q = inputValue.toLowerCase()
    return categories.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.account.includes(q) ||
        c.accountName.toLowerCase().includes(q),
    )
  }, [categories, inputValue])

  // AI suggestions that are NOT already in the first position of filteredCategories
  const aiSuggestedKeys = new Set(suggestions.map((s) => s.key))

  // Split categories: AI-matched first, rest below
  const aiCategories    = suggestions
  const otherCategories = filteredCategories.filter((c) => !aiSuggestedKeys.has(c.key))

  const hasAiResults = aiCategories.length > 0
  const showEmpty    = !loading && !hasAiResults && filteredCategories.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <div className="ml-2 flex items-center gap-1 shrink-0">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Tapez un article, fournisseur ou n° de compte…"
            value={inputValue}
            onValueChange={setInputValue}
          />

          <CommandList className="max-h-[340px]">

            {/* ── Loading skeleton ── */}
            {loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Recherche IA en cours…
              </div>
            )}

            {/* ── AI suggestions ── */}
            {!loading && hasAiResults && (
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-400">
                    <Sparkles className="h-3 w-3" />
                    {usedAI ? "Suggéré par l'IA" : "Meilleures correspondances"}
                  </span>
                }
              >
                {aiCategories.map((s, idx) => {
                  const isTop = idx === 0
                  return (
                    <CommandItem
                      key={s.key}
                      value={s.key}
                      onSelect={() => {
                        onChange(s.key)
                        setOpen(false)
                        setInputValue("")
                      }}
                      className={cn(
                        "flex-col items-start gap-0.5 py-2",
                        isTop && "bg-violet-50/60 dark:bg-violet-950/20",
                      )}
                    >
                      {/* Row 1: check + account code + label */}
                      <div className="flex w-full items-center gap-2">
                        <Check
                          className={cn(
                            "h-4 w-4 shrink-0",
                            value === s.key ? "opacity-100 text-primary" : "opacity-0",
                          )}
                        />
                        <span className="font-mono text-xs text-muted-foreground w-[52px] shrink-0">
                          {s.account}
                        </span>
                        <span className="flex-1 font-medium text-sm">{s.label}</span>
                        {isTop && (
                          <span className="ml-auto shrink-0 rounded-full bg-violet-100 dark:bg-violet-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-0.5">
                            <Sparkles className="h-2.5 w-2.5" />
                            {usedAI ? "IA" : "↑"}
                          </span>
                        )}
                      </div>
                      {/* Row 2: reasoning */}
                      {s.reasoning && (
                        <p className="ml-[26px] text-[11px] text-muted-foreground truncate w-full">
                          {s.reasoning}
                        </p>
                      )}
                      {/* Row 3: immobilisation badge */}
                      {s.isImmobilisation && (
                        <span className="ml-[26px] text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                          📦 Actif immobilisé → bilan
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {/* ── Separator between AI + rest ── */}
            {!loading && hasAiResults && otherCategories.length > 0 && (
              <CommandSeparator />
            )}

            {/* ── Full catalogue (filtered) ── */}
            {!loading && otherCategories.length > 0 && (
              <CommandGroup
                heading={
                  hasAiResults ? (
                    <span className="text-[11px] text-muted-foreground">Toutes les catégories</span>
                  ) : undefined
                }
              >
                {otherCategories.map((c) => (
                  <CommandItem
                    key={c.key}
                    value={c.key}
                    onSelect={() => {
                      onChange(c.key)
                      setOpen(false)
                      setInputValue("")
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === c.key ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono text-xs text-muted-foreground mr-2 w-[52px] shrink-0">
                      {c.account}
                    </span>
                    <span className="flex-1">{c.label}</span>
                    {/* @ts-ignore */}
                    {(c as any).isImmobilisation && (
                      <Building2 className="ml-1 h-3 w-3 shrink-0 text-amber-500" title="Immobilisation" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* ── Empty state ── */}
            {showEmpty && (
              <CommandEmpty>
                {inputValue.trim()
                  ? "Aucune catégorie trouvée. Essayez un autre libellé."
                  : "Sélectionner une catégorie."}
              </CommandEmpty>
            )}

            {/* ── Supplier name hint (when no query typed yet) ── */}
            {!loading && !inputValue.trim() && !hasAiResults && supplierName && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-t flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-violet-500" />
                Tapez pour laisser l'IA suggérer un compte pour «{" "}
                <span className="font-medium">{supplierName}</span> »
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
