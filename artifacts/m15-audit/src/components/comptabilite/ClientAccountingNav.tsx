import { useListClients } from "@workspace/api-client-react"
import { useLocation, useRoute } from "wouter"
import { Building2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"

// Module M3 (Comptabilité & Travaux): the per-client accounting views share
// this header — pick a client, then switch between the ledger views and the
// year-end closing workspace. Selecting a client keeps the current tab and
// just swaps the :clientId segment in the URL (source of truth for context).
//
// The "cloture" tab has a different URL prefix (/cabinet/client/:id/cloture)
// from the comptabilite tabs (/comptabilite/:id/...) because it lives in the
// dedicated cabinet workspace rather than the reporting section.
const TABS = [
  { slug: "saisie", label: "Flux de Saisie" },
  { slug: "journaux", label: "Journaux" },
  { slug: "grand-livre", label: "Grand Livre" },
  { slug: "etats-financiers", label: "États Financiers" },
  { slug: "cloture", label: "Clôture Annuelle" },
] as const

export type AccountingTabSlug = (typeof TABS)[number]["slug"]

export function ClientAccountingNav({ activeTab }: { activeTab: AccountingTabSlug }) {
  const [, setLocation] = useLocation()
  // Match both the comptabilite tabs and the cabinet/client cloture tab.
  const [, comptaParams] = useRoute<{ clientId: string }>("/comptabilite/:clientId/:tab")
  const [, cabinetParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/cloture")
  const params = comptaParams ?? cabinetParams
  const clientId = params?.clientId ? Number(params.clientId) : null

  const { data: clients, isLoading } = useListClients()

  const handleClientChange = (value: string) => {
    setLocation(`/comptabilite/${value}/${activeTab}`)
  }

  const handleTabChange = (tab: string) => {
    if (!clientId) return
    // The cloture tab lives under /cabinet/client/:id/cloture; all other
    // tabs live under /comptabilite/:id/<slug>.
    if (tab === "cloture") {
      setLocation(`/cabinet/client/${clientId}/cloture`)
    } else {
      setLocation(`/comptabilite/${clientId}/${tab}`)
    }
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="w-full max-w-xs">
            <Select
              value={clientId ? String(clientId) : undefined}
              onValueChange={handleClientChange}
              disabled={isLoading}
            >
              <SelectTrigger data-testid="select-client">
                <SelectValue placeholder="Sélectionner un client" />
              </SelectTrigger>
              <SelectContent>
                {(clients ?? []).map((client) => (
                  <SelectItem key={client.id} value={String(client.id)} data-testid={`option-client-${client.id}`}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {clientId && (
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="flex-wrap h-auto">
              {TABS.map((tab) => (
                <TabsTrigger key={tab.slug} value={tab.slug} data-testid={`tab-${tab.slug}`}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
