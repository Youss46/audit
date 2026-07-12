import { useListAuditLogs } from "@workspace/api-client-react"
import { formatDateTime } from "@/lib/utils"
import { 
  Files,
  User,
  Building2,
  FileText,
  ActivitySquare,
  ShieldCheck,
  Search
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
import { useState } from "react"
import { Input } from "@/components/ui/input"

function getEntityIcon(entityType: string) {
  switch (entityType.toLowerCase()) {
    case 'user': return <User className="h-4 w-4 text-blue-500" />
    case 'client': return <Building2 className="h-4 w-4 text-indigo-500" />
    case 'mission': return <ActivitySquare className="h-4 w-4 text-purple-500" />
    case 'document': return <FileText className="h-4 w-4 text-orange-500" />
    case 'checklist': return <ShieldCheck className="h-4 w-4 text-teal-500" />
    default: return <Files className="h-4 w-4 text-gray-500" />
  }
}

export default function AuditLog() {
  const [searchTerm, setSearchTerm] = useState("")
  const { data: logs, isLoading } = useListAuditLogs()

  const filteredLogs = logs?.filter(log => 
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.userName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.entityType.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.details?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Journal d'Audit</h1>
        <p className="text-muted-foreground mt-1">
          Traçabilité complète des actions effectuées sur la plateforme.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Registre des événements</CardTitle>
              <CardDescription>Historique immuable des opérations du cabinet</CardDescription>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Filtrer les événements..."
                className="pl-8 bg-muted/50"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[180px]">Date & Heure</TableHead>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entité</TableHead>
                <TableHead>Détails</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                    Chargement de l'historique...
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">
                    Aucun événement trouvé.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log) => (
                  <TableRow key={log.id} className="text-sm">
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {log.userName || 'Système'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider bg-primary/5">
                        {log.action}
                      </Badge>
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
                    <TableCell className="text-muted-foreground max-w-xs truncate" title={log.details || ''}>
                      {log.details || '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}