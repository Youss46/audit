import { useState, useEffect } from "react"
import { useListAuditLogs } from "@workspace/api-client-react"
import { formatDateTime } from "@/lib/utils"
import { getRoleLabel, getRoleBadgeColor, getAuditActionLabel, isAiOverrideAction } from "@/lib/status"
import { getToken } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"
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
  Download,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Module M14 (Immutable Audit Trail & Activity Logging) -- Espace Cabinet:
// "Journal de Conformité". Read-only visual front-end for the
// append-only audit_logs table (see lib/db/src/schema/audit-logs.ts and
// artifacts/api-server/src/lib/audit.ts). Restricted to expert_comptable
// via router.get("/audit-logs", requireRole("expert_comptable"), ...) on
// the backend and the App.tsx route guard on this page.

const PAGE_SIZE = 50

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
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>("ALL")
  const [aiOverrideOnly, setAiOverrideOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  const { data: logs, isLoading } = useListAuditLogs({
    userRole: roleFilter === "ALL" ? undefined : roleFilter,
    aiOverrideOnly: aiOverrideOnly || undefined,
  })

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [searchTerm, roleFilter, aiOverrideOnly])

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

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE))
  const safeCurrentPage = Math.min(page, totalPages)
  const pagedLogs = filteredLogs.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE)
  const aiOverrideCount = (logs ?? []).filter((l) => isAiOverrideAction(l.action)).length

  // ── Export CSV (client-side) ─────────────────────────────────────────────
  function handleExportCsv() {
    const headers = [
      "Date & Heure", "Utilisateur", "Rôle",
      "Événement", "Détails", "Entité", "ID Entité", "Adresse IP",
    ]
    const rows = filteredLogs.map((log) => [
      formatDateTime(log.createdAt),
      log.userName ?? "Système",
      getRoleLabel(log.userRole ?? ""),
      getAuditActionLabel(log.action, log.entityId),
      log.details ?? "",
      log.entityType,
      log.entityId ?? "",
      log.ipAddress ?? "",
    ])
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `journal-conformite-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Export PDF (via backend) ─────────────────────────────────────────────
  async function handleExportPdf() {
    setIsExportingPdf(true)
    try {
      const token = getToken()
      const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? ""
      const params = new URLSearchParams()
      if (roleFilter !== "ALL") params.set("userRole", roleFilter)
      if (aiOverrideOnly) params.set("aiOverrideOnly", "true")
      const url = `${apiBase}/api/audit-logs/export-pdf?${params.toString()}`
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      })
      if (!res.ok) throw new Error("Erreur lors de la génération du PDF")
      const blob = await res.blob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `journal-conformite-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      toast({
        title: "Export PDF impossible",
        description: err instanceof Error ? err.message : "Une erreur s'est produite.",
        variant: "destructive",
      })
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Journal de Conformité
        </h1>
        <p className="text-muted-foreground mt-1">
          Traçabilité légale et inaltérable de toutes les actions effectuées sur la plateforme
          (Module M14 — réservé aux experts-comptables du cabinet).
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <CardTitle>Registre des événements</CardTitle>
              <CardDescription>
                Historique immuable — aucune entrée ne peut être modifiée ou supprimée.
                {!isLoading && logs && (
                  <span className="ml-2 font-medium text-foreground">
                    {filteredLogs.length.toLocaleString("fr-FR")} entrée{filteredLogs.length > 1 ? "s" : ""}
                    {filteredLogs.length < (logs?.length ?? 0) && ` (sur ${(logs?.length ?? 0).toLocaleString("fr-FR")} au total)`}
                  </span>
                )}
              </CardDescription>
            </div>

            {/* Boutons d'export */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 shrink-0" disabled={isExportingPdf || isLoading}>
                  {isExportingPdf ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Exporter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCsv} className="gap-2">
                  <FileDown className="h-4 w-4" />
                  Exporter en CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPdf} className="gap-2">
                  <FileDown className="h-4 w-4" />
                  Exporter en PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Filtres */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
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
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[160px]">Date &amp; Heure</TableHead>
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
                    Chargement du registre de conformité…
                  </TableCell>
                </TableRow>
              ) : pagedLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                    Aucun événement trouvé.
                  </TableCell>
                </TableRow>
              ) : (
                pagedLogs.map((log) => {
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

          {/* ── Pagination ─────────────────────────────────────────────── */}
          {!isLoading && filteredLogs.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Page {safeCurrentPage} sur {totalPages} —{" "}
                {((safeCurrentPage - 1) * PAGE_SIZE + 1).toLocaleString("fr-FR")} à{" "}
                {Math.min(safeCurrentPage * PAGE_SIZE, filteredLogs.length).toLocaleString("fr-FR")}{" "}
                sur {filteredLogs.length.toLocaleString("fr-FR")} entrées
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
