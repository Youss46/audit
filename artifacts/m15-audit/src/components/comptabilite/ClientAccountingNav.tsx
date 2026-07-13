import {
  useListClients,
  useGetClient,
  getGetClientQueryKey,
  useListTransactions,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react"
import { useLocation, useRoute } from "wouter"
import { Building2, ChevronRight, Cpu } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Sector, AccountingSystem } from "@workspace/api-client-react"

// ---------------------------------------------------------------------------
// French labels for reference data
// ---------------------------------------------------------------------------
function getSectorLabel(sector: Sector | string | undefined): string {
  switch (sector) {
    case "commerce":  return "Commerce"
    case "artisanat": return "Artisanat"
    case "services":  return "Services"
    default:          return "—"
  }
}

function getAccountingSystemLabel(system: AccountingSystem | string | null | undefined): string {
  switch (system) {
    case "SMT":    return "Système Minimal de Trésorerie"
    case "ALLEGE": return "Système Allégé"
    case "NORMAL": return "Système Normal"
    default:       return "—"
  }
}

function getAccountingSystemBadgeClass(system: AccountingSystem | string | null | undefined): string {
  switch (system) {
    case "SMT":    return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
    case "ALLEGE": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
    case "NORMAL": return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
    default:       return "bg-muted text-muted-foreground"
  }
}

// ---------------------------------------------------------------------------
// Module M3 (Comptabilité & Travaux): the per-client accounting views share
// this header — pick a client, then switch between the ledger views, the
// fixed-asset registry, financial management, and the year-end closing
// workspace.
//
// URL routing per tab:
//   saisie / journaux / grand-livre / etats-financiers
//     → /comptabilite/:id/<slug>
//   immobilisations  → /cabinet/client/:id/immobilisations
//   finance          → /cabinet/client/:id/finance
//   cloture          → /cabinet/client/:id/cloture
// ---------------------------------------------------------------------------

const TABS = [
  { slug: "saisie",           label: "Flux de Saisie"      },
  { slug: "journaux",         label: "Journaux"             },
  { slug: "grand-livre",      label: "Grand Livre"          },
  { slug: "etats-financiers", label: "États Financiers"     },
  { slug: "immobilisations",  label: "Immobilisations"      },
  { slug: "finance",          label: "Financements & Dettes" },
  { slug: "cloture",          label: "Clôture Annuelle"     },
] as const

/** Cabinet-specific tabs that live under /cabinet/client/:id/<slug> */
const CABINET_TABS = new Set<string>(["immobilisations", "finance", "cloture"])

export type AccountingTabSlug = (typeof TABS)[number]["slug"]

export function ClientAccountingNav({ activeTab }: { activeTab: AccountingTabSlug }) {
  const [, setLocation] = useLocation()

  // Detect clientId from all possible URL patterns this nav appears on.
  const [, comptaParams]  = useRoute<{ clientId: string }>("/comptabilite/:clientId/:tab")
  const [, clotureParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/cloture")
  const [, immobParams]   = useRoute<{ clientId: string }>("/cabinet/client/:clientId/immobilisations")
  const [, financeParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/finance")
  const params   = comptaParams ?? clotureParams ?? immobParams ?? financeParams
  const clientId = params?.clientId ? Number(params.clientId) : null

  // All clients for the selector dropdown.
  const { data: clients, isLoading: clientsLoading } = useListClients()

  // Selected client detail — enriches the context header with sector,
  // accounting system, and mission status.
  const { data: selectedClient } = useGetClient(clientId ?? 0, {
    query: {
      enabled:  !!clientId,
      queryKey: getGetClientQueryKey(clientId ?? 0),
    },
  })

  // Pending-operations count for the Saisie tab badge.
  const { data: pendingTransactions } = useListTransactions(
    { clientId: clientId ?? 0, status: "a_valider" },
    {
      query: {
        enabled:  !!clientId,
        queryKey: getListTransactionsQueryKey({ clientId: clientId ?? 0, status: "a_valider" }),
      },
    },
  )
  const pendingCount = pendingTransactions?.length ?? 0

  // Route helper: build the destination URL for a given tab + clientId.
  function tabUrl(tab: string, id: number | string): string {
    return CABINET_TABS.has(tab)
      ? `/cabinet/client/${id}/${tab}`
      : `/comptabilite/${id}/${tab}`
  }

  const handleClientChange = (value: string) => {
    setLocation(tabUrl(activeTab, value))
  }

  const handleTabChange = (tab: string) => {
    if (!clientId) return
    setLocation(tabUrl(tab, clientId))
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 flex flex-col gap-4">

        {/* ---- Client selector row ---- */}
        <div className="flex items-center gap-3 flex-wrap">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="w-full max-w-xs">
            <Select
              value={clientId ? String(clientId) : undefined}
              onValueChange={handleClientChange}
              disabled={clientsLoading}
            >
              <SelectTrigger data-testid="select-client">
                <SelectValue placeholder="Sélectionner un client" />
              </SelectTrigger>
              <SelectContent>
                {(clients ?? []).map((client) => (
                  <SelectItem
                    key={client.id}
                    value={String(client.id)}
                    data-testid={`option-client-${client.id}`}
                  >
                    <span className="flex items-center gap-2">
                      {client.name}
                      <span className="text-xs text-muted-foreground">
                        — {getSectorLabel(client.sector)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ---- Client context header ---- */}
          {selectedClient && (
            <div className="flex items-center gap-2 flex-wrap text-sm pl-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-semibold">{selectedClient.name}</span>
              <Badge variant="outline" className="text-xs">
                {getSectorLabel(selectedClient.sector)}
              </Badge>
              {selectedClient.accountingSystem && (
                <Badge
                  variant="outline"
                  className={`text-xs border-transparent ${getAccountingSystemBadgeClass(selectedClient.accountingSystem)}`}
                >
                  <Cpu className="mr-1 h-3 w-3" />
                  {getAccountingSystemLabel(selectedClient.accountingSystem)}
                </Badge>
              )}
              {selectedClient.annualTurnover != null && (
                <span className="text-xs text-muted-foreground">
                  CA :{" "}
                  {new Intl.NumberFormat("fr-FR", {
                    style: "decimal",
                    maximumFractionDigits: 0,
                  }).format(selectedClient.annualTurnover)}{" "}
                  XOF
                </span>
              )}
            </div>
          )}
        </div>

        {/* ---- Sub-navigation tabs ---- */}
        {clientId && (
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="flex-wrap h-auto">
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab.slug}
                  value={tab.slug}
                  data-testid={`tab-${tab.slug}`}
                  className="relative"
                >
                  {tab.label}
                  {tab.slug === "saisie" && pendingCount > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {pendingCount}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
