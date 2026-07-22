import { useState } from "react"
import {
  useListClients,
  useGetClient,
  getGetClientQueryKey,
  useListTransactions,
  getListTransactionsQueryKey,
  useListThreads,
  getListThreadsQueryKey,
} from "@workspace/api-client-react"
import { useLocation, useRoute } from "wouter"
import { Building2, ChevronRight, Cpu, ChevronsUpDown, Check } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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
//   paie             → /cabinet/client/:id/paie
//   cloture          → /cabinet/client/:id/cloture
//   teledeclaration  → /cabinet/client/:id/teledeclaration
//   pilotage (M21)   → /cabinet/client/:id/pilotage
// ---------------------------------------------------------------------------

const TABS = [
  { slug: "saisie",           label: "Flux de Saisie"      },
  { slug: "journaux",         label: "Journaux"             },
  { slug: "grand-livre",      label: "Grand Livre"          },
  { slug: "etats-financiers", label: "États Financiers"     },
  { slug: "immobilisations",  label: "Immobilisations"      },
  { slug: "finance",          label: "Financements & Dettes" },
  { slug: "paie",             label: "Gestion de la Paie"    },
  { slug: "cloture",          label: "Clôture Annuelle"     },
  { slug: "teledeclaration",  label: "Télédéclaration TVA"  },
  { slug: "pilotage",         label: "Tableau de Bord"       },
  { slug: "analytique",       label: "Analytique"             },
  { slug: "dsf",              label: "Liasse Fiscale (DSF)"  },
  { slug: "revision",         label: "Révision Collaborative" },
  { slug: "scoring",          label: "Scoring & Évaluation"  },
  { slug: "audit-visa",       label: "🛡️ Audit IA (Visa)"    },
  { slug: "examen",           label: "🔍 Examen Fin d'Exercice" },
] as const

/** Cabinet-specific tabs that live under /cabinet/client/:id/<slug> */
const CABINET_TABS = new Set<string>([
  "immobilisations",
  "finance",
  "paie",
  "cloture",
  "teledeclaration",
  "pilotage",
  "analytique",
  "dsf",
  "revision",
  "scoring",
  "audit-visa",
  "examen",
])

export type AccountingTabSlug = (typeof TABS)[number]["slug"]

export function ClientAccountingNav({ activeTab }: { activeTab: AccountingTabSlug }) {
  const [, setLocation] = useLocation()
  const [comboOpen, setComboOpen] = useState(false)

  // Detect clientId from all possible URL patterns this nav appears on.
  const [, comptaParams]  = useRoute<{ clientId: string }>("/comptabilite/:clientId/:tab")
  const [, clotureParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/cloture")
  const [, immobParams]   = useRoute<{ clientId: string }>("/cabinet/client/:clientId/immobilisations")
  const [, financeParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/finance")
  const [, paieParams]    = useRoute<{ clientId: string }>("/cabinet/client/:clientId/paie")
  const [, teledeclParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/teledeclaration")
  const [, pilotageParams]   = useRoute<{ clientId: string }>("/cabinet/client/:clientId/pilotage")
  const [, analytiqueParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/analytique")
  const [, dsfParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/dsf")
  const [, revisionParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/revision")
  const [, scoringParams]   = useRoute<{ clientId: string }>("/cabinet/client/:clientId/scoring")
  const [, auditVisaParams] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/audit-visa")
  const [, examenParams]    = useRoute<{ clientId: string }>("/cabinet/client/:clientId/examen")
  const params   = comptaParams ?? clotureParams ?? immobParams ?? financeParams ?? paieParams ?? teledeclParams ?? pilotageParams ?? analytiqueParams ?? dsfParams ?? revisionParams ?? scoringParams ?? auditVisaParams ?? examenParams
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

  // Unresolved discussions count for the "Révision Collaborative" tab badge.
  const { data: unresolvedThreads } = useListThreads(
    { clientId: clientId ?? 0, unresolvedOnly: true },
    {
      query: {
        enabled:  !!clientId,
        queryKey: getListThreadsQueryKey({ clientId: clientId ?? 0, unresolvedOnly: true }),
      },
    },
  )
  const unresolvedCount = unresolvedThreads?.length ?? 0

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
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  data-testid="select-client"
                  disabled={clientsLoading}
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate">
                    {clientId
                      ? ((clients ?? []).find(c => c.id === clientId)?.name ?? "Sélectionner un client")
                      : "Sélectionner un client"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Rechercher un client…" />
                  <CommandList>
                    <CommandEmpty>Aucun client trouvé.</CommandEmpty>
                    <CommandGroup>
                      {(clients ?? []).map((client) => (
                        <CommandItem
                          key={client.id}
                          value={`${client.name} ${getSectorLabel(client.sector)}`}
                          data-testid={`option-client-${client.id}`}
                          onSelect={() => {
                            setComboOpen(false)
                            handleClientChange(String(client.id))
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4 shrink-0",
                              clientId === client.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="truncate">{client.name}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground shrink-0">
                            — {getSectorLabel(client.sector)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
                  {tab.slug === "revision" && unresolvedCount > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                      {unresolvedCount}
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
