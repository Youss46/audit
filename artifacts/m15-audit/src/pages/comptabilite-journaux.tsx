import { useRoute } from "wouter"
import { useListTransactions, getListTransactionsQueryKey } from "@workspace/api-client-react"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import { formatFcfa, getJournalCode, getJournalCodeLabel } from "@/lib/status"
import { BookText } from "lucide-react"

// Module M3 reporting: "Journaux" -- a chronological, line-by-line feed of
// every SYSCOHADA journal entry booked for the selected client, across all
// auxiliary journals (Achats/Ventes/Banque/Caisse). Only comptabilisées
// ("valide") entries make up the general ledger, so that's what this view
// shows -- same rule as the Grand Livre and États Financiers.
export default function ComptabiliteJournaux() {
  const [, params] = useRoute<{ clientId: string }>("/comptabilite/:clientId/journaux")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const { data: transactions, isLoading } = useListTransactions(
    clientId ? { clientId, status: "valide" } : undefined,
    { query: { enabled: !!clientId, queryKey: getListTransactionsQueryKey({ clientId: clientId ?? 0, status: "valide" }) } },
  )

  const rows = (transactions ?? [])
    .flatMap((t) =>
      t.journalLines.map((line) => ({
        key: `${t.id}-${line.id}`,
        date: t.date,
        journalCode: getJournalCode(t),
        accountNumber: line.accountNumber,
        label: line.label ?? t.label,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
      })),
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité & Travaux</h1>
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
      ) : isLoading ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground">Chargement...</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <BookText className="h-8 w-8 mb-2 opacity-20" />
            <p>Aucune écriture comptabilisée pour ce client.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
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
                      <Badge variant="outline" title={getJournalCodeLabel(row.journalCode)}>
                        {row.journalCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.accountNumber}</TableCell>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right">
                      {row.debitAmount > 0 ? formatFcfa(row.debitAmount) : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.creditAmount > 0 ? formatFcfa(row.creditAmount) : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
