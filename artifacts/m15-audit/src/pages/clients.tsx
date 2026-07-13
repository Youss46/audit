import { useListClients, useDeleteClient, MissionStatus } from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useState } from "react"
import { Link } from "wouter"
import { formatDateTime } from "@/lib/utils"
import { 
  Building2, 
  Search, 
  Plus, 
  MoreHorizontal, 
  Eye, 
  Trash2, 
  AlertCircle
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

function getStatusColor(status: MissionStatus) {
  switch (status) {
    case 'en_attente': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
    case 'en_cours': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'anomalie': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
    case 'valide': return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300'
    case 'visa_emis': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

function getStatusLabel(status: MissionStatus) {
  switch (status) {
    case 'en_attente': return 'En attente'
    case 'en_cours': return 'En cours'
    case 'anomalie': return 'Anomalie'
    case 'valide': return 'Validé'
    case 'visa_emis': return 'Visa émis'
    default: return status
  }
}

export default function Clients() {
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<MissionStatus | "ALL">("ALL")
  const [clientToDelete, setClientToDelete] = useState<number | null>(null)
  
  const { data: clients, isLoading, refetch } = useListClients(
    statusFilter !== "ALL" ? { missionStatus: statusFilter } : undefined
  )
  
  const deleteMutation = useDeleteClient({
    mutation: {
      onSuccess: () => {
        setClientToDelete(null)
        refetch()
      }
    }
  })

  const filteredClients = clients?.filter(client => 
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    client.rccm?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dossiers Clients</h1>
          <p className="text-muted-foreground mt-1">
            Gérez vos clients et suivez l'avancement des missions de visa.
          </p>
        </div>
        
        {(user?.role === 'expert_comptable' || user?.role === 'collaborateur') && (
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="mr-2 h-4 w-4" />
              Nouveau Client
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Rechercher un client..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
          <Badge 
            variant={statusFilter === "ALL" ? "default" : "outline"}
            className="cursor-pointer whitespace-nowrap"
            onClick={() => setStatusFilter("ALL")}
          >
            Tous
          </Badge>
          {(Object.keys(MissionStatus) as Array<keyof typeof MissionStatus>).map((status) => (
            <Badge 
              key={status}
              variant={statusFilter === MissionStatus[status] ? "default" : "outline"}
              className="cursor-pointer whitespace-nowrap"
              onClick={() => setStatusFilter(MissionStatus[status])}
            >
              {getStatusLabel(MissionStatus[status])}
            </Badge>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Secteur</TableHead>
              <TableHead>Système</TableHead>
              <TableHead>Statut Mission</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                    Chargement des dossiers...
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredClients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center">
                    <Building2 className="h-8 w-8 mb-2 opacity-20" />
                    <p>Aucun client trouvé.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{client.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {client.legalForm} {client.rccm ? `• RCCM: ${client.rccm}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{client.sector}</TableCell>
                  <TableCell>
                    {client.accountingSystem ? (
                      <Badge variant="secondary" className="font-mono text-xs">
                        {client.accountingSystem}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">Non défini</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-transparent ${getStatusColor(client.missionStatus)}`}>
                      {getStatusLabel(client.missionStatus)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link href={`/clients/${client.id}`} className="flex items-center cursor-pointer w-full">
                            <Eye className="mr-2 h-4 w-4" />
                            Voir le dossier
                          </Link>
                        </DropdownMenuItem>
                        {user?.role === 'expert_comptable' && (
                          <DropdownMenuItem 
                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            onClick={() => setClientToDelete(client.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Supprimer
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!clientToDelete} onOpenChange={(open) => !open && setClientToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Supprimer le client ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Toutes les missions, documents et données 
              associés à ce client seront définitivement supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => clientToDelete && deleteMutation.mutate({ id: clientToDelete })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Suppression..." : "Oui, supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}