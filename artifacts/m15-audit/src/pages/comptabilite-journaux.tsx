import { useState, useMemo } from "react"
import { useRoute } from "wouter"
import { useListTransactions, getListTransactionsQueryKey } from "@workspace/api-client-react"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDate } from "@/lib/utils"
import { formatFcfa, getJournalCode, getJournalCodeLabel } from "@/lib/status"
import { BookText, CalendarDays } from "lucide-react"

type JournalCodeFilter = "ALL" | "HA" | "VT" | "BQ" | "CA"

const JOURNAL_CODE_FILTERS: { value: JournalCodeFilter; label: string }[] = [
  { value: "ALL", label: "Tous les journaux" },
  { value: "HA",  label: "HA — Achats"       },
  { value: "VT",  label: "VT — Ventes"       },
  { value: "BQ",  label: "BQ — Banque"       },
  { value: "CA",  label: "CA — Caisse"       },
]

const JOURNAL_CODE_COLORS: Record<string, string> = {
  HA: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300",
  VT: "bg-green-100  text-green-800  border-green-200  dark:bg-green-900/30  dark:text-green-300",
  BQ: "bg-blue-100   text-blue-800   border-blue-200   dark:bg-blue-900/30   dark:text-blue-300",
  CA: "bg-amber-100  text-amber-800  border-amber-200  dark:bg-amber-900/30  dark:text-amber-300",
}

function buildYearOptions() {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let y = current; y >= current - 5; y--) years.push(y)
  return years
}

// Module M3 reporting: "Journaux" -- a chronological, line-by-line feed of
// every SYSCOHADA journal entry booked for the selected client, across all
// auxiliary journals (Achats/Ventes/Banque/Caisse). Only comptabilisées
// ("valide") entries make up the general ledger, so that's what this view
// shows -- same rule as the Grand Livre and États Financiers.
export default function ComptabiliteJournaux() {
  const [, params] = useRoute<{ clientId: string }>("/comptabilite/:clientId/journaux")
  const clientId   = params?.clientId ? Number(params.clientId) : null

  const yearOptions = useMemo(() => buildYearOptions(), [])
  const [year, setYear]                 = useState(yearOptions[0])
  const [journalFilter, setJournalFilter] = useState<JournalCodeFilter>("ALL")

  const { data: transactions, isLoading } = useListTransactions(
    clientId ? { clientId, status: "valide" } : undefined,
    {
      query: {
        enabled:  !!clientId,
        queryKey: getListTransactionsQueryKey({ clientId: clientId ?? 0, status: "valide" }),
      },
    },
  )

  // Build flat journal-line rows filtered by selected year and journal code.
  const allRows = useMemo(
    () =>
      (transactions ?? [])
        .flatMap((t) => {
          const code = getJournalCode(t)
          return t.journalLines.map((line) => ({
            key:          `${t.id}-${line.id}`,
            date:         t.date,
            journalCode:  code,
            accountNumber: line.accountNumber,
            label:        line.label ?? t.label,
            debitAmount:  line.debitAmount,
            creditAmount: line.creditAmount,
          }))
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [transactions],
  )

  const rows = useMemo(() => {
    const yearStr = String(year)
    return allRows.filter((r) => {
      const rowYear = new Date(r.date).getFullYear()
      const matchesYear = rowYear === year
      const matchesCode = journalFilter === "ALL" || r.journalCode === journalFilter
      return matchesYear && matchesCode
    })
  }, [allRows, year, journalFilter])

  // Column totals
  const totalDebit  = rows.reduce((s, r) => s + r.debitAmount,  0)
  const totalCredit = rows.reduce((s, r) => s + r.creditAmount, 0)

  // When viewing ALL journals, build section breaks keyed by journal code
  // so the accountant can visually scan each auxiliary journal.
  const sections = useMemo(() => {
    if (journalFilter !== "ALL") return null
    const order: JournalCodeFilter[] = ["HA", "VT", "BQ", "CA"]
    return order
      .map((code) => ({ code, rows: rows.filter((r) => r.journalCode === code) }))
      .filter((s) => s.rows.length > 0)
  }, [rows, journalFilter])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité &amp; Travaux</h1>
        <p className="text-muted-foreground mt-1">
          Journaux — écritures comptabilisées, classées chronologiquement par journal auxiliaire.
        </p>
      </div>

      <ClientAccountingNav activeTab="journaux" />

      {!clientId ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <BookText className="h-8 w-8 mb-2 opacity-20" />
            <p>Sélectionnez un client pour afficher ses journaux.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---- Filters toolbar ---- */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Year picker */}
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-[130px]" data-testid="select-journal-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      Exercice {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Journal code filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {JOURNAL_CODE_FILTERS.map(({ value, label }) => (
                <Badge
                  key={value}
                  variant={journalFilter === value ? "default" : "outline"}
                  className={`cursor-pointer ${
                    journalFilter !== value && value !== "ALL"
                      ? JOURNAL_CODE_COLORS[value]
                      : ""
                  }`}
                  onClick={() => setJournalFilter(value)}
                  data-testid={`filter-journal-${value}`}
                >
                  {label}
                </Badge>
              ))}
            </div>
          </div>

          {/* ---- Content ---- */}
          {isLoading ? (
            <Card className="shadow-sm">
              <CardContent className="p-10 text-center text-muted-foreground">Chargement...</CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <Card className="shadow-sm">
              <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
                <BookText className="h-8 w-8 mb-2 opacity-20" />
                <p>Aucune écriture pour ce filtre.</p>
              </CardContent>
            </Card>
          ) : journalFilter !== "ALL" ? (
            // ---- Single journal view ----
            <JournalTable
              rows={rows}
              totalDebit={totalDebit}
              totalCredit={totalCredit}
              title={getJournalCodeLabel(journalFilter as "HA" | "VT" | "BQ" | "CA")}
              colorClass={JOURNAL_CODE_COLORS[journalFilter]}
            />
          ) : (
            // ---- All-journals sectioned view ----
            <div className="space-y-4">
              {(sections ?? []).map((section) => {
                const sDebit  = section.rows.reduce((s, r) => s + r.debitAmount,  0)
                const sCredit = section.rows.reduce((s, r) => s + r.creditAmount, 0)
                return (
                  <JournalTable
                    key={section.code}
                    rows={section.rows}
                    totalDebit={sDebit}
                    totalCredit={sCredit}
                    title={getJournalCodeLabel(section.code as "HA" | "VT" | "BQ" | "CA")}
                    colorClass={JOURNAL_CODE_COLORS[section.code]}
                  />
                )
              })}

              {/* Grand total across all journals */}
              <Card className="shadow-sm bg-muted/30">
                <CardContent className="p-4 flex items-center justify-between text-sm font-semibold">
                  <span>Total général — Exercice {year}</span>
                  <div className="flex gap-8">
                    <span className="text-right">
                      <span className="text-muted-foreground font-normal mr-2">Débits</span>
                      {formatFcfa(totalDebit)}
                    </span>
                    <span className="text-right">
                      <span className="text-muted-foreground font-normal mr-2">Crédits</span>
                      {formatFcfa(totalCredit)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared table component reused for both single-journal and sectioned views
// ---------------------------------------------------------------------------
interface JournalRow {
  key:           string
  date:          string
  journalCode:   "HA" | "VT" | "BQ" | "CA"
  accountNumber: string
  label:         string
  debitAmount:   number
  creditAmount:  number
}

function JournalTable({
  rows,
  totalDebit,
  totalCredit,
  title,
  colorClass,
}: {
  rows:         JournalRow[]
  totalDebit:   number
  totalCredit:  number
  title:        string
  colorClass:   string
}) {
  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="py-3 px-4 border-b bg-muted/20">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Badge variant="outline" className={colorClass}>
            {title}
          </Badge>
          <span className="text-muted-foreground font-normal">
            {rows.length} écriture{rows.length > 1 ? "s" : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Journal</TableHead>
              <TableHead>Compte</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="text-right">Débit</TableHead>
              <TableHead className="text-right">Crédit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} data-testid={`row-journal-line-${row.key}`}>
                <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={JOURNAL_CODE_COLORS[row.journalCode]}
                    title={getJournalCodeLabel(row.journalCode)}
                  >
                    {row.journalCode}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{row.accountNumber}</TableCell>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-right font-mono">
                  {row.debitAmount > 0 ? formatFcfa(row.debitAmount) : ""}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.creditAmount > 0 ? formatFcfa(row.creditAmount) : ""}
                </TableCell>
              </TableRow>
            ))}
            {/* Subtotal row */}
            <TableRow className="font-semibold bg-muted/30 border-t-2">
              <TableCell colSpan={4} className="text-sm">
                Sous-total {title}
              </TableCell>
              <TableCell className="text-right font-mono">{formatFcfa(totalDebit)}</TableCell>
              <TableCell className="text-right font-mono">{formatFcfa(totalCredit)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
