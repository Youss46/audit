import { useState } from "react"
import { useListAuditLogs } from "@workspace/api-client-react"
import { formatDateTime } from "@/lib/utils"
import { getRoleLabel, getRoleBadgeColor, getAuditActionLabel, isAiOverrideAction } from "@/lib/status"
import {
  ShieldCheck,
  Search,
  Sparkles,
  ArrowRight,
  Files,
  User,
  Building2,
  FileText,
  ActivitySquare,
  Wallet,
} from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Module M14 (Immutable Audit Trail & Activity Logging) -- Espace Cabinet:
// "Journal de Conformité". Read-only visual front-end for the
// append-only audit_logs table (see lib/db/src/schema/audit-logs.ts and
// artifacts/api-server/src/lib/audit.ts). Restricted to expert_comptable
// via router.get("/audit-logs", requireRole("expert_comptable"), ...) on
// the backend and the App.tsx route guard on this page.

function getEntityIcon(entityType: string) {
  switch (entityType.toLowerCase()) {
    case 'user': return <User className="h-4 w-4 text-blue-500" />
    case 'client': return <Building2 className="h-4 w-4 text-indigo-500" />
    case 'mission': return <ActivitySquare className="h-4 w-4 text-purple-500" />
    case 'document': return <FileText className="h-4 w-4 text-orange-500" />
    case 'transaction': return <Wallet className="h-4 w-4 text-emerald-500" />
    default: return <Files className="h-4 w-4 text-gray-500" />
  }
}

export default function Compliance() {
  const [searchTerm, setSearchTerm] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>("ALL")
  const [aiOverrideOnly, setAiOverrideOnly] = useState(false)

  const { data: logs, isLoading } = useListAuditLogs({
    userRole: roleFilter === "ALL" ? undefined : roleFilter,
    aiOverrideOnly: aiOverrideOnly || undefined,
  })

  const filteredLogs = (logs ?? []).filter((log) => {
    if (!searchTerm) return true
    const haystack = [
      log.userName,
      log.entityType,
      log.details,
      getAuditActionLabel(log.action, log.entityId),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return haystack.includes(searchTerm.toLowerCase())
  })

  const aiOverrideCount = (logs ?? []).filter((l) => isAiOverrideAction(l.action)).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Journal de Conformité
        </h1>
        <p className="text-muted-foreground mt-1">
          Traçabilité légale et inaltérable de toutes les actions effectuées sur la plateforme
          (Module M14 -- réservé aux experts-comptables du cabinet).
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <CardTitle>Registre des événements</CardTitle>
              <CardDescription>
                Historique immuable des opérations du cabinet -- aucune entrée ne peut être modifiée ou supprimée.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Rechercher un événement..."
                  className="pl-8 bg-muted/50"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-compliance-search"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[200px]" data-testid="select-role-filter">
                  <SelectValue placeholder="Filtrer par rôle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tous les rôles</SelectItem>
                  <SelectItem value="expert_comptable">Expert-comptable</SelectItem>
                  <SelectItem value="collaborateur">Collaborateur</SelectItem>
                  <SelectItem value="stagiaire">Stagiaire</SelectItem>
                  <SelectItem value="client_pme">Espace PME</SelectItem>
                </SelectContent>
              </Select>
              <Badge
                variant={aiOverrideOnly ? "default" : "outline"}
                className="cursor-pointer whitespace-nowrap gap-1.5 h-10 px-3"
                onClick={() => setAiOverrideOnly((v) => !v)}
                data-testid="filter-ai-override-only"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Corrections IA uniquement
                {aiOverrideCount > 0 && (
                  <span className="ml-1 rounded-full bg-background/20 px-1.5 text-[10px]">
                    {aiOverrideCount}
                  </span>
                )}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[180px]">Date &amp; Heure</TableHead>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Événement</TableHead>
                <TableHead>Entité</TableHead>
                <TableHead>Adresse IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    Chargement du registre de conformité...
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                    Aucun événement trouvé.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log) => {
                  const isOverride = isAiOverrideAction(log.action)
                  return (
                    <TableRow
                      key={log.id}
                      className={
                        isOverride
                          ? "text-sm border-l-2 border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/20"
                          : "text-sm"
                      }
                      data-testid={`row-audit-log-${log.id}`}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {log.userName || 'Système'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`border-transparent ${getRoleBadgeColor(log.userRole)}`}>
                          {getRoleLabel(log.userRole)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="flex items-center gap-1.5">
                          {isOverride && (
                            <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300 gap-1">
                              <Sparkles className="h-3 w-3" />
                              Correction IA
                            </Badge>
                          )}
                          <span>{log.details || getAuditActionLabel(log.action, log.entityId)}</span>
                        </div>
                        {isOverride && log.changesPayload && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                            {Object.entries(log.changesPayload.before ?? {}).map(([field, beforeValue]) => {
                              const afterValue = (log.changesPayload?.after ?? {})[field]
                              return (
                                <span
                                  key={field}
                                  className="inline-flex items-center gap-1 rounded-md bg-amber-100/80 dark:bg-amber-900/30 px-2 py-0.5 font-mono"
                                  data-testid={`diff-${log.id}-${field}`}
                                >
                                  <span className="text-muted-foreground">{field}:</span>
                                  <span className="text-red-700 dark:text-red-400 line-through">{String(beforeValue)}</span>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{String(afterValue)}</span>
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getEntityIcon(log.entityType)}
                          <span className="capitalize">{log.entityType}</span>
                          {log.entityId && (
                            <span className="text-xs text-muted-foreground font-mono">#{log.entityId}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {log.ipAddress || '-'}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
