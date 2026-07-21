/**
 * DuplicateWarningBanner
 *
 * Displayed in the document review / purchase entry flow when the
 * duplicate-detection engine finds one or more potential matches.
 * Each match shows the supplier name, matched amount, date, and the
 * reason the system flagged it (NCC match, invoice ref match, or
 * same amount within 60 days).
 *
 * The accountant can dismiss the warning to continue recording the
 * purchase, or navigate to the conflicting purchase to verify it.
 */
import { AlertTriangle, X, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export interface DuplicateMatch {
  id: number
  supplierName: string
  invoiceRef?: string | null
  amountTtc: number
  date: string
  matchReason: string
}

interface Props {
  matches: DuplicateMatch[]
  onDismiss: () => void
}

function formatDate(isoString: string) {
  return new Date(isoString).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

function formatFCFA(amount: number) {
  return amount.toLocaleString("fr-FR") + " FCFA"
}

export function DuplicateWarningBanner({ matches, onDismiss }: Props) {
  if (matches.length === 0) return null

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
              {matches.length === 1
                ? "Doublon potentiel détecté"
                : `${matches.length} doublons potentiels détectés`}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Le système a trouvé {matches.length === 1 ? "un achat similaire" : "des achats similaires"} déjà enregistré
              {matches.length > 1 ? "s" : ""}.
              Vérifiez avant de continuer pour éviter une double saisie.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-amber-600 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40 shrink-0"
          onClick={onDismiss}
          aria-label="Ignorer l'avertissement"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Match list */}
      <div className="space-y-2">
        {matches.map((match) => (
          <div
            key={match.id}
            className="rounded-md border border-amber-200 dark:border-amber-800 bg-white dark:bg-amber-950/40 px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {match.supplierName}
                  {match.invoiceRef && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      — Réf. {match.invoiceRef}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFCFA(match.amountTtc)} · {formatDate(match.date)}
                </p>
                <Badge
                  variant="outline"
                  className="mt-1 text-xs font-normal border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-transparent"
                >
                  {match.matchReason}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground font-mono shrink-0 mt-0.5">
                Achat #{match.id}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
          onClick={onDismiss}
        >
          Ignorer et continuer
        </Button>
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Si c'est bien un nouvel achat distinct, vous pouvez continuer la saisie.
        </p>
      </div>
    </div>
  )
}
