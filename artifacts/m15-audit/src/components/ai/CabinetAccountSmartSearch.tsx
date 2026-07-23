/**
 * CabinetAccountSmartSearch
 *
 * Recherche intelligente IA dans le Plan Comptable SYSCOHADA.
 * Utilisé comme page standalone (/cabinet/plan-comptable) et comme
 * palette de commandes (Ctrl+K, dialog overlay).
 *
 * Pipeline :
 *   1. Correspondance directe SQL (code / libellé)
 *   2. Sémantique IA DeepSeek si pas de match fort
 */

import * as React from "react"
import { getApiBase, getToken } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Sparkles,
  Search,
  Copy,
  Check,
  Loader2,
  Zap,
  Bot,
  X,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────────────

interface SmartSearchResult {
  code: string
  label: string
  accountClass: number
  confidence: number
  reasoning: string
  isDirectMatch: boolean
}

interface SearchResponse {
  results: SmartSearchResult[]
  usedAI: boolean
}

// ── Filter chips ─────────────────────────────────────────────────────────────

const CLASS_FILTERS = [
  { label: "Tous", value: undefined, color: "bg-muted text-muted-foreground" },
  { label: "Cl. 4 · Tiers", value: 4, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { label: "Cl. 5 · Tréso.", value: 5, color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  { label: "Cl. 6 · Charges", value: 6, color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  { label: "Cl. 7 · Produits", value: 7, color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { label: "Cl. 8 · Résultats", value: 8, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
  { label: "Cl. 9 · Analytique", value: 9, color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
] as const

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ score, isDirectMatch }: { score: number; isDirectMatch: boolean }) {
  if (isDirectMatch) {
    return (
      <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-semibold px-1.5 py-0 h-5">
        Exact
      </Badge>
    )
  }
  if (score >= 0.9) {
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px] font-semibold px-1.5 py-0 h-5">Très pertinent</Badge>
  }
  if (score >= 0.75) {
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 text-[10px] font-semibold px-1.5 py-0 h-5">Pertinent</Badge>
  }
  if (score >= 0.6) {
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-semibold px-1.5 py-0 h-5">Approximatif</Badge>
  }
  return <Badge className="bg-muted text-muted-foreground text-[10px] font-semibold px-1.5 py-0 h-5">{Math.round(score * 100)}%</Badge>
}

// ── Account class pill ────────────────────────────────────────────────────────

const CLASS_COLORS: Record<number, string> = {
  1: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  2: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
  3: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400",
  4: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
  5: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400",
  6: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400",
  7: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  8: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-400",
  9: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
}

function ClassPill({ cls }: { cls: number }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded px-1.5 py-0 text-[10px] font-bold leading-5",
      CLASS_COLORS[cls] ?? "bg-muted text-muted-foreground"
    )}>
      Cl.{cls}
    </span>
  )
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({
  result,
  onCopy,
}: {
  result: SmartSearchResult
  onCopy: (code: string) => void
}) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    onCopy(result.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={cn(
      "group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50",
      result.isDirectMatch && "border-l-2 border-primary/50 pl-[10px]"
    )}>
      {/* Code */}
      <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
        <code className="text-sm font-mono font-bold text-foreground tracking-tight">
          {result.code}
        </code>
        <ClassPill cls={result.accountClass} />
      </div>

      {/* Label + reasoning */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground leading-tight truncate">
          {result.label}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
          {result.reasoning}
        </p>
      </div>

      {/* Confidence + Copy */}
      <div className="shrink-0 flex items-center gap-2">
        <ConfidenceBadge score={result.confidence} isDirectMatch={result.isDirectMatch} />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Copier le code"
          onClick={handleCopy}
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-emerald-500" />
            : <Copy className="h-3.5 w-3.5" />
          }
        </Button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface CabinetAccountSmartSearchProps {
  /** When true, renders compact (inside a Dialog); when false, full page */
  modal?: boolean
  onClose?: () => void
}

export function CabinetAccountSmartSearch({ modal, onClose }: CabinetAccountSmartSearchProps) {
  const { toast } = useToast()
  const [query, setQuery] = React.useState("")
  const [classFilter, setClassFilter] = React.useState<number | undefined>(undefined)
  const [results, setResults] = React.useState<SmartSearchResult[]>([])
  const [usedAI, setUsedAI] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [hasSearched, setHasSearched] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  React.useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  // Debounced search
  React.useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setUsedAI(false)
      setHasSearched(false)
      setError(null)
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const base = getApiBase()
        const token = getToken()
        const resp = await fetch(`${base}/api/cabinet/accounts/smart-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            q: query.trim(),
            ...(classFilter !== undefined ? { classFilter } : {}),
          }),
        })
        if (!resp.ok) {
          let msg = `Erreur ${resp.status}`
          try {
            const body = await resp.json()
            if (body?.error) msg = body.error
            else if (body?.message) msg = body.message
          } catch { /* ignore parse errors */ }
          throw new Error(msg)
        }
        const data: SearchResponse = await resp.json()
        setResults(data.results)
        setUsedAI(data.usedAI)
        setHasSearched(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Impossible de contacter le service de recherche.")
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query, classFilter])

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {})
    toast({
      title: "Code copié",
      description: `${code} est dans votre presse-papiers.`,
      duration: 2000,
    })
  }

  // Split results into direct matches and AI suggestions
  const directMatches = results.filter((r) => r.isDirectMatch)
  const aiSuggestions = results.filter((r) => !r.isDirectMatch)

  return (
    <div className={cn(
      "flex flex-col",
      modal ? "h-[min(80vh,640px)]" : "h-full"
    )}>
      {/* Header */}
      <div className={cn(
        "shrink-0",
        modal
          ? "px-4 pt-4 pb-3 border-b"
          : "mb-6"
      )}>
        {modal && (
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground leading-none">
                  Recherche Intelligente IA
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Plan Comptable SYSCOHADA · 1 403 comptes
                </p>
              </div>
            </div>
            {onClose && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {/* Search input */}
        <div className="relative">
          {loading
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          }
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Ex : "Facture climatisation", "Avocat", "Wave", "605"…'
            className="pl-9 pr-4 h-10 text-sm bg-background"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setResults([]); setHasSearched(false) }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {CLASS_FILTERS.map((f) => (
            <button
              key={String(f.value)}
              onClick={() => setClassFilter(f.value)}
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all border",
                classFilter === f.value
                  ? `${f.color} border-current ring-1 ring-current/30 font-semibold`
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className={cn(
        "flex-1 overflow-y-auto",
        modal ? "px-2 py-2" : "mt-4"
      )}>
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive mx-2">
            {error}
          </div>
        )}

        {!loading && !error && !hasSearched && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Recherche intelligente SYSCOHADA</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Tapez un libellé, un fournisseur, une description de charge, ou directement un code de compte.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {["Facture avocat", "Carburant", "Wave frais", "621", "Loyer bureau"].map((ex) => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  className="text-[11px] rounded-full border border-dashed border-border px-2.5 py-1 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && hasSearched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Bot className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Aucun compte trouvé pour « {query} »</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Essayez d'autres termes ou retirez le filtre de classe.
            </p>
          </div>
        )}

        {/* Direct matches */}
        {directMatches.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Correspondance directe
              </span>
            </div>
            <div className="space-y-0.5">
              {directMatches.map((r) => (
                <ResultRow key={r.code} result={r} onCopy={handleCopy} />
              ))}
            </div>
          </div>
        )}

        {/* AI suggestions */}
        {aiSuggestions.length > 0 && (
          <div className={directMatches.length > 0 ? "mt-3 pt-3 border-t" : ""}>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                Suggéré par l'IA
              </span>
              {usedAI && (
                <span className="ml-auto text-[10px] text-muted-foreground/60">DeepSeek · SYSCOHADA</span>
              )}
            </div>
            <div className="space-y-0.5">
              {aiSuggestions.map((r) => (
                <ResultRow key={r.code} result={r} onCopy={handleCopy} />
              ))}
            </div>
          </div>
        )}

        {/* Footer hint */}
        {hasSearched && results.length > 0 && (
          <p className="text-center text-[10px] text-muted-foreground/50 py-3">
            Survolez un compte pour copier son code.
          </p>
        )}
      </div>

      {/* Bottom keyboard hint (modal only) */}
      {modal && (
        <div className="shrink-0 border-t px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono">Ctrl</kbd>
            {" + "}
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono">K</kbd>
            {" pour ouvrir / fermer"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            1 403 comptes SYSCOHADA
          </span>
        </div>
      )}
    </div>
  )
}
