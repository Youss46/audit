import { useRoute } from "wouter"
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav"
import { EtatsFinanciers } from "@/components/reporting/etats-financiers"
import { Card, CardContent } from "@/components/ui/card"
import { FileBarChart } from "lucide-react"

// Module M3 reporting: "États Financiers" tab of the per-client accounting
// workspace. Reuses the same EtatsFinanciers component already shown on
// the client detail page, so year selection, statement switching and the
// liasse fiscale export button behave identically in both places.
export default function ComptabiliteEtatsFinanciers() {
  const [, params] = useRoute<{ clientId: string }>("/comptabilite/:clientId/etats-financiers")
  const clientId = params?.clientId ? Number(params.clientId) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Comptabilité & Travaux</h1>
        <p className="text-muted-foreground mt-1">
          États Financiers — calculés à partir des écritures comptabilisées de ce client.
        </p>
      </div>

      <ClientAccountingNav activeTab="etats-financiers" />

      {!clientId ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 flex flex-col items-center justify-center text-muted-foreground">
            <FileBarChart className="h-8 w-8 mb-2 opacity-20" />
            <p>Sélectionnez un client pour afficher ses états financiers.</p>
          </CardContent>
        </Card>
      ) : (
        <EtatsFinanciers clientId={clientId} />
      )}
    </div>
  )
}
