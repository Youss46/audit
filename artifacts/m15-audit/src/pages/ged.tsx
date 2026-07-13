import { useState } from "react"
import { Link } from "wouter"
import { useListDocuments, useDeleteDocument, getListDocumentsQueryKey } from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import { formatDateTime } from "@/lib/utils"
import { FolderOpen, FileText, Search, Trash2, Download, Eye } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { useToast } from "@/hooks/use-toast"

function bytesToSize(bytes: number) {
  const sizes = ['Octets', 'Ko', 'Mo', 'Go']
  if (bytes === 0) return '0 Octet'
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString())
  return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i]
}

// Module M6: cabinet-wide GED library across every client dossier. Complements
// the per-client document tree on the client detail page with a single view
// for the firm to search/audit all files at once.
export default function GestionDocumentaire() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [docToDelete, setDocToDelete] = useState<number | null>(null)

  const { data: documents, isLoading } = useListDocuments()

  const canDelete = user?.role === "expert_comptable" || user?.role === "collaborateur"

  const deleteMutation = useDeleteDocument({
    mutation: {
      onSuccess: () => {
        toast({ title: "Document supprimé" })
        setDocToDelete(null)
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() })
      },
    },
  })

  const filteredDocs = (documents ?? []).filter(
    (d) =>
      d.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.clientName ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.category.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gestion Documentaire (GED)</h1>
        <p className="text-muted-foreground mt-1">
          Bibliothèque centralisée de tous les documents du cabinet, tous clients confondus.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Rechercher un document, un client, une catégorie..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom du fichier</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Taille</TableHead>
                  <TableHead>Ajouté le</TableHead>
                  <TableHead>Par</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                      Chargement des documents...
                    </TableCell>
                  </TableRow>
                ) : filteredDocs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <FolderOpen className="h-8 w-8 mb-2 opacity-20" />
                        <p>Aucun document trouvé.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDocs.map((doc) => (
                    <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                      <TableCell className="font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="truncate max-w-[220px] block" title={doc.fileName}>
                          {doc.fileName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link href={`/clients/${doc.clientId}`} className="text-sm text-primary hover:underline">
                          {doc.clientName ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={doc.category === "Procédure de Visa" ? "default" : "secondary"} className="font-normal">
                          {doc.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{bytesToSize(doc.fileSize)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDateTime(doc.createdAt)}</TableCell>
                      <TableCell className="text-sm">{doc.uploadedByName || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" title="Voir le dossier client" asChild>
                            <Link href={`/clients/${doc.clientId}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDocToDelete(doc.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!docToDelete} onOpenChange={(open) => !open && setDocToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le document sera définitivement supprimé de la GED.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => docToDelete && deleteMutation.mutate({ id: docToDelete })}
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
