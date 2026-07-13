import { useRoute } from "wouter"
import { useGetGrandLivre, getGetGrandLivreQueryKey } from "@workspace/api-client-react"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { Card, CardContent } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import { formatFcfa } from "@/lib/status"
import { Layers } from "lucide-react"

function soldeLabel(amount: number, side: "debiteur" | "crediteur") {
  return `${formatFcfa(amount)} ${side === "debiteur" ? "(débiteur)" : "(créditeur)"}`
}

// Module M3 reporting: "Le Grand Livre" -- every SYSCOHADA account touched
// by the selected client's validated ledger, one accordion per account
// (e.g. "618000 - Déplacements") expanding to its full movement history
// and running balance.
export default function ComptabiliteGrandLivre() {
  const [, params] = useRoute<{ clientId: string }>("/comptabilite/:clientId/grand-livre")
  const clientId = params?.clientId ? Number(params.clientId) : null
  const year = new Date().getFullYear()

  const { data, isLoading } = useGetGrandLivre(
    { clientId: clientId ?? 0, year },
    { query: { enabled: !!clientId, queryKey: getGetGrandLivreQueryKey({ clientId: clientId ?? 0, year }) } },
  )

  const accounts = data?.accounts ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité & Travaux</h1>
        <p className="text-muted-foreground mt-1">
          Grand Livre — exercice {year}, un compte par ligne, mouvements et solde progressif.
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
      ) : isLoading ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground">Chargement...</CardContent>
        </Card>
      ) : accounts.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-20" />
            <p>Aucun compte mouvementé pour ce client sur cet exercice.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <Accordion type="multiple">
              {accounts.map((account) => (
                <AccordionItem key={account.accountNumber} value={account.accountNumber}>
                  <AccordionTrigger data-testid={`accordion-account-${account.accountNumber}`}>
                    <div className="flex items-center gap-3 text-left">
                      <span className="font-mono text-sm">{account.accountNumber}</span>
                      <span className="font-medium">{account.accountName}</span>
                      <Badge variant="outline" className="ml-2">
                        {soldeLabel(account.finalBalance, account.finalBalanceSide)}
                      </Badge>
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
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={4} className="text-muted-foreground italic">
                            Solde initial
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground italic">
                            {soldeLabel(account.initialBalance, account.initialBalanceSide)}
                          </TableCell>
                        </TableRow>
                        {account.movements.map((movement, index) => (
                          <TableRow key={`${account.accountNumber}-${index}`} data-testid={`row-movement-${account.accountNumber}-${index}`}>
                            <TableCell className="whitespace-nowrap">{formatDate(movement.date)}</TableCell>
                            <TableCell>{movement.label}</TableCell>
                            <TableCell className="text-right">
                              {movement.debitAmount > 0 ? formatFcfa(movement.debitAmount) : ""}
                            </TableCell>
                            <TableCell className="text-right">
                              {movement.creditAmount > 0 ? formatFcfa(movement.creditAmount) : ""}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {soldeLabel(movement.runningBalance, movement.runningBalanceSide)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
