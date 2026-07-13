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
// this header — pick a client, then switch between the ledger views and the
// year-end closing workspace. Selecting a client keeps the current tab and
// just swaps the :clientId segment in the URL (source of truth for context).
//
// The "cloture" tab has a different URL prefix (/cabinet/client/:id/cloture)
// from the comptabilite tabs (/comptabilite/:id/...) because it lives in the
// dedicated cabinet workspace rather than the reporting section.
// ---------------------------------------------------------------------------
const TABS = [
  { slug: "saisie",            label: "Flux de Saisie"   },
  { slug: "journaux",          label: "Journaux"          },
  { slug: "grand-livre",       label: "Grand Livre"       },
  { slug: "etats-financiers",  label: "États Financiers"  },
  { slug: "cloture",           label: "Clôture Annuelle"  },
] as const

export type AccountingTabSlug = (typeof TABS)[number]["slug"]

export function ClientAccountingNav({ activeTab }: { activeTab: AccountingTabSlug }) {
  const [, setLocation] = useLocation()
  // Match both the comptabilite tabs and the cabinet/client cloture tab.
  const [, comptaParams]  = useRoute<{ clientId: string }>("/comptabilite/:clientId/:tab")
  const [, cabinetParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/cloture")
  const params   = comptaParams ?? cabinetParams
  const clientId = params?.clientId ? Number(params.clientId) : null

  // All clients for the selector dropdown
  const { data: clients, isLoading: clientsLoading } = useListClients()

  // Selected client detail — enriches the context header with sector,
  // accounting system, and mission status.
  const { data: selectedClient } = useGetClient(clientId ?? 0, {
    query: {
      enabled:  !!clientId,
      queryKey: getGetClientQueryKey(clientId ?? 0),
    },
  })

  // Pending-operations count for the Saisie tab badge — only fetched when
  // a client is selected so we never fire a firm-wide query here.
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
                      {client.missionStatus && (
                        <span className="text-xs text-muted-foreground">
                          — {getSectorLabel(client.sector)}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ---- Client context header (visible once a client is chosen) ---- */}
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

        {/* ---- Sub-navigation tabs (shown only when a client is selected) ---- */}
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
                  {/* Pending-operations badge on Saisie tab */}
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
