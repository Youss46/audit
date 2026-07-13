import { useMemo, useState } from "react"
import { useRoute } from "wouter"
import { useGetGrandLivre, getGetGrandLivreQueryKey } from "@workspace/api-client-react"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import { formatFcfa } from "@/lib/status"
import { CalendarDays, Layers } from "lucide-react"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function soldeLabel(amount: number, side: "debiteur" | "crediteur") {
  return `${formatFcfa(amount)} ${side === "debiteur" ? "(débiteur)" : "(créditeur)"}`
}

/** SYSCOHADA class numbers with French labels. */
const CLASS_LABELS: Record<number, string> = {
  1: "Classe 1 — Capitaux",
  2: "Classe 2 — Immobilisations",
  3: "Classe 3 — Stocks",
  4: "Classe 4 — Tiers",
  5: "Classe 5 — Trésorerie",
  6: "Classe 6 — Charges",
  7: "Classe 7 — Produits",
  8: "Classe 8 — Comptes spéciaux",
  9: "Classe 9 — Comptes analytiques",
}

const CLASS_BADGE_CLASSES: Record<number, string> = {
  1: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  4: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  5: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  6: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  7: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
}

function buildYearOptions() {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let y = current; y >= current - 5; y--) years.push(y)
  return years
}

// ---------------------------------------------------------------------------
// Module M3 reporting: "Le Grand Livre" -- every SYSCOHADA account touched
// by the selected client's validated ledger, one accordion per account
// (e.g. "618000 - Déplacements") expanding to its full movement history
// and running balance. Grouped by SYSCOHADA class for easier navigation.
// ---------------------------------------------------------------------------
export default function ComptabiliteGrandLivre() {
  const [, params] = useRoute<{ clientId: string }>("/comptabilite/:clientId/grand-livre")
  const clientId   = params?.clientId ? Number(params.clientId) : null

  const yearOptions = useMemo(() => buildYearOptions(), [])
  const [year, setYear] = useState(yearOptions[0])

  const { data, isLoading } = useGetGrandLivre(
    { clientId: clientId ?? 0, year },
    {
      query: {
        enabled:  !!clientId,
        queryKey: getGetGrandLivreQueryKey({ clientId: clientId ?? 0, year }),
      },
    },
  )

  const accounts = data?.accounts ?? []

  // Group accounts by their SYSCOHADA class number.
  const byClass = useMemo(() => {
    const map = new Map<number, typeof accounts>()
    for (const account of accounts) {
      const cls = account.accountClass
      if (!map.has(cls)) map.set(cls, [])
      map.get(cls)!.push(account)
    }
    // Return sorted by class number.
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [accounts])

  // Per-class totals for the summary badges.
  const classTotals = useMemo(
    () =>
      new Map(
        byClass.map(([cls, accts]) => [
          cls,
          {
            totalDebit:  accts.reduce((s, a) => s + a.totalDebit,  0),
            totalCredit: accts.reduce((s, a) => s + a.totalCredit, 0),
            count:       accts.length,
          },
        ]),
      ),
    [byClass],
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité &amp; Travaux</h1>
        <p className="text-muted-foreground mt-1">
          Grand Livre — mouvements et solde progressif par compte SYSCOHADA.
        </p>
      </div>

      <ClientAccountingNav activeTab="grand-livre" />

      {!clientId ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-20" />
            <p>Sélectionnez un client pour afficher son grand livre.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---- Year picker ---- */}
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-[150px]" data-testid="select-grand-livre-year">
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
            {!isLoading && accounts.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {accounts.length} compte{accounts.length > 1 ? "s" : ""} mouvementé{accounts.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* ---- Content ---- */}
          {isLoading ? (
            <Card className="shadow-sm">
              <CardContent className="p-10 text-center text-muted-foreground">Chargement...</CardContent>
            </Card>
          ) : accounts.length === 0 ? (
            <Card className="shadow-sm">
              <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
                <Layers className="h-8 w-8 mb-2 opacity-20" />
                <p>Aucun compte mouvementé pour ce client sur l'exercice {year}.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {byClass.map(([cls, classAccounts]) => {
                const totals = classTotals.get(cls)!
                return (
                  <Card key={cls} className="shadow-sm overflow-hidden">
                    {/* Class header */}
                    <CardHeader className="py-3 px-4 border-b bg-muted/20">
                      <CardTitle className="text-sm font-semibold flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`border-transparent ${CLASS_BADGE_CLASSES[cls] ?? ""}`}
                          >
                            {cls}
                          </Badge>
                          <span>{CLASS_LABELS[cls] ?? `Classe ${cls}`}</span>
                          <span className="text-muted-foreground font-normal text-xs">
                            ({totals.count} compte{totals.count > 1 ? "s" : ""})
                          </span>
                        </div>
                        <div className="flex gap-6 text-xs font-mono font-normal text-muted-foreground">
                          <span>
                            <span className="font-semibold text-foreground">Débits :</span>{" "}
                            {formatFcfa(totals.totalDebit)}
                          </span>
                          <span>
                            <span className="font-semibold text-foreground">Crédits :</span>{" "}
                            {formatFcfa(totals.totalCredit)}
                          </span>
                        </div>
                      </CardTitle>
                    </CardHeader>

                    {/* Account accordions */}
                    <CardContent className="p-4">
                      <Accordion type="multiple">
                        {classAccounts.map((account) => (
                          <AccordionItem key={account.accountNumber} value={account.accountNumber}>
                            <AccordionTrigger
                              data-testid={`accordion-account-${account.accountNumber}`}
                            >
                              <div className="flex items-center gap-3 text-left flex-wrap">
                                <span className="font-mono text-sm">{account.accountNumber}</span>
                                <span className="font-medium">{account.accountName}</span>
                                <Badge
                                  variant="outline"
                                  className={`ml-2 text-xs ${
                                    account.finalBalanceSide === "debiteur"
                                      ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300"
                                      : "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300"
                                  }`}
                                >
                                  {soldeLabel(account.finalBalance, account.finalBalanceSide)}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {account.movements.length} mouvement{account.movements.length > 1 ? "s" : ""}
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Libellé</TableHead>
                                    <TableHead className="text-right">Débit</TableHead>
                                    <TableHead className="text-right">Crédit</TableHead>
                                    <TableHead className="text-right">Solde progressif</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {/* Opening balance row */}
                                  <TableRow className="bg-muted/30">
                                    <TableCell
                                      colSpan={4}
                                      className="text-muted-foreground italic text-sm"
                                    >
                                      Solde initial
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground italic text-sm">
                                      {soldeLabel(account.initialBalance, account.initialBalanceSide)}
                                    </TableCell>
                                  </TableRow>

                                  {/* Movement rows */}
                                  {account.movements.map((movement, index) => (
                                    <TableRow
                                      key={`${account.accountNumber}-${index}`}
                                      data-testid={`row-movement-${account.accountNumber}-${index}`}
                                    >
                                      <TableCell className="whitespace-nowrap">
                                        {formatDate(movement.date)}
                                      </TableCell>
                                      <TableCell>{movement.label}</TableCell>
                                      <TableCell className="text-right font-mono">
                                        {movement.debitAmount > 0 ? formatFcfa(movement.debitAmount) : ""}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {movement.creditAmount > 0 ? formatFcfa(movement.creditAmount) : ""}
                                      </TableCell>
                                      <TableCell className="text-right font-medium font-mono">
                                        {soldeLabel(movement.runningBalance, movement.runningBalanceSide)}
                                      </TableCell>
                                    </TableRow>
                                  ))}

                                  {/* Account totals row */}
                                  <TableRow className="font-semibold bg-muted/40 border-t-2">
                                    <TableCell colSpan={2} className="text-sm">
                                      Totaux — {account.accountNumber}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                      {formatFcfa(account.totalDebit)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                      {formatFcfa(account.totalCredit)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                      {soldeLabel(account.finalBalance, account.finalBalanceSide)}
                                    </TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
