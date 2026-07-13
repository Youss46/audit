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

// Module M3 (Comptabilité & Travaux): the four per-client accounting views
// share this header -- pick a client, then switch between the different
// ways of looking at that client's ledger. Selecting a client keeps the
// current tab and just swaps the :clientId segment in the URL, so the URL
// itself is always the source of truth for "which client am I looking at".
const TABS = [
  { slug: "saisie", label: "Flux de Saisie" },
  { slug: "journaux", label: "Journaux" },
  { slug: "grand-livre", label: "Grand Livre" },
  { slug: "etats-financiers", label: "États Financiers" },
] as const

export type AccountingTabSlug = (typeof TABS)[number]["slug"]

export function ClientAccountingNav({ activeTab }: { activeTab: AccountingTabSlug }) {
  const [, setLocation] = useLocation()
  const [, params] = useRoute<{ clientId: string }>("/comptabilite/:clientId/:tab")
  const clientId = params?.clientId ? Number(params.clientId) : null

  const { data: clients, isLoading } = useListClients()

  const handleClientChange = (value: string) => {
    setLocation(`/comptabilite/${value}/${activeTab}`)
  }

  const handleTabChange = (tab: string) => {
    if (!clientId) return
    setLocation(`/comptabilite/${clientId}/${tab}`)
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
