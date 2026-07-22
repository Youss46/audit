import { useState } from "react"
import { Link } from "wouter"
import {
  useListDocuments,
  useDeleteDocument,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useQueryClient } from "@tanstack/react-query"
import { formatDateTime } from "@/lib/utils"
import {
  FolderOpen,
  FileText,
  Search,
  Trash2,
  Download,
  Eye,
  Lock,
  FolderLock,
  ChevronDown,
  ChevronRight,
  Archive,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToSize(bytes: number) {
  const sizes = ["Octets", "Ko", "Mo", "Go"]
  if (bytes === 0) return "0 Octet"
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round(bytes / Math.pow(1024, i)) + " " + sizes[i]
}

// Machine-readable folderCategory → French display label
const FOLDER_CATEGORY_LABELS: Record<string, string> = {
  etats_financiers: "01 — États Financiers & Liasse Fiscale (DSF)",
  journaux_grand_livre: "02 — Journaux & Grand Livre (Légal)",
  dossier_audit: "03 — Dossier d'Audit & Rapports (Cabinet)",
  pieces_justificatives: "04 — Pièces Justificatives Majeures",
}

// ---------------------------------------------------------------------------
// Download helper (reuses the base64 fileData already in the list response
// if present, or opens the client dossier as a fallback for large files).
// ---------------------------------------------------------------------------
function handleDownload(doc: { fileName: string; mimeType: string }) {
  // For the GED list view we don't have fileData (metadata-only). We redirect
  // the user to the client dossier page where they can download individually.
  // A dedicated GET /documents/:id endpoint returns the full base64 content.
  window.open(`/clients/${(doc as { clientId?: number }).clientId ?? ""}`, "_blank")
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type Doc = {
  id: number
  clientId: number
  clientName?: string | null
  missionId?: number | null
  folderId?: number | null
  folderCategory?: string | null
  category: string
  fileName: string
  mimeType: string
  fileSize: number
  isArchived: boolean
  fiscalYear?: number | null
  uploadedByName?: string | null
  createdAt: string | Date
}

/** A single document row for the active-documents table. */
function ActiveDocRow({
  doc,
  canDelete,
  onDelete,
}: {
  doc: Doc
  canDelete: boolean
  onDelete: (id: number) => void
}) {
  return (
    <TableRow data-testid={`row-document-${doc.id}`}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate max-w-[220px] block" title={doc.fileName}>
            {doc.fileName}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Link
          href={`/clients/${doc.clientId}`}
          className="text-sm text-primary hover:underline"
        >
          {doc.clientName ?? "—"}
        </Link>
      </TableCell>
      <TableCell>
        <Badge
          variant={doc.category === "Procédure de Visa" ? "default" : "secondary"}
          className="font-normal"
        >
          {doc.category}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {bytesToSize(doc.fileSize)}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {formatDateTime(doc.createdAt)}
      </TableCell>
      <TableCell className="text-sm">{doc.uploadedByName || "—"}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
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
              onClick={() => onDelete(doc.id)}
              title="Supprimer"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** An archive sub-folder section (collapsible) inside a fiscal year group. */
function ArchiveSubFolder({
  label,
  docs,
}: {
  label: string
  docs: Doc[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <FolderLock className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-sm font-medium">{label}</span>
        <Badge variant="outline" className="ml-auto font-normal text-xs">
          {docs.length} fichier{docs.length !== 1 ? "s" : ""}
        </Badge>
      </button>

      {open && (
        <div className="divide-y">
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun fichier dans ce dossier d'archive.
            </p>
          ) : (
            docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    title={doc.fileName}
                  >
                    {doc.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {bytesToSize(doc.fileSize)} · {formatDateTime(doc.createdAt)}
                    {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
                  </p>
                </div>
                {/* Archive: only View (client dossier) is permitted — no Delete */}
                <Button variant="ghost" size="icon" title="Voir le dossier client" asChild>
                  <Link href={`/clients/${doc.clientId}`}>
                    <Eye className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** A fiscal year accordion panel in the Archives Fiscales tab. */
function FiscalYearPanel({
  year,
  docs,
}: {
  year: number
  docs: Doc[]
}) {
  const [open, setOpen] = useState(true)

  // Group docs by folderCategory, then collect uncategorised ones
  const grouped = new Map<string, Doc[]>()
  const uncategorised: Doc[] = []

  for (const doc of docs) {
    const cat = doc.folderCategory
    if (cat && FOLDER_CATEGORY_LABELS[cat]) {
      const arr = grouped.get(cat) ?? []
      arr.push(doc)
      grouped.set(cat, arr)
    } else {
      uncategorised.push(doc)
    }
  }

  // Render sub-folders in canonical order
  const orderedCategories = [
    "etats_financiers",
    "journaux_grand_livre",
    "dossier_audit",
    "pieces_justificatives",
  ]

  return (
    <Card className="shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-card hover:bg-muted/30 transition-colors text-left"
      >
        <Lock className="h-4 w-4 text-amber-500 shrink-0" />
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="font-semibold text-base">Exercice {year}</span>
        <Badge className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200 font-normal text-xs">
          Archive clôturée
        </Badge>
        <span className="ml-auto text-sm text-muted-foreground">
          {docs.length} document{docs.length !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <CardContent className="pt-0 pb-4 px-5 space-y-2">
          {orderedCategories.map((cat) => (
            <ArchiveSubFolder
              key={cat}
              label={FOLDER_CATEGORY_LABELS[cat]}
              docs={grouped.get(cat) ?? []}
            />
          ))}
          {uncategorised.length > 0 && (
            <ArchiveSubFolder
              label="Autres documents archivés"
              docs={uncategorised}
            />
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

/**
 * Module M6 — Gestion Documentaire (GED).
 *
 * Cabinet-wide document library split into two tabs:
 *   • "Documents Actifs"  — regular, editable documents (isArchived=false)
 *   • "Archives Fiscales" — locked annual archives created at clôture (isArchived=true),
 *     grouped by fiscal year and sub-folder, with a 🔒 visual lock on every item.
 */
export default function GestionDocumentaire() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [docToDelete, setDocToDelete] = useState<number | null>(null)

  const { data: documents, isLoading } = useListDocuments()

  const canDelete =
    user?.role === "expert_comptable" || user?.role === "collaborateur"

  const deleteMutation = useDeleteDocument({
    mutation: {
      onSuccess: () => {
        toast({ title: "Document supprimé" })
        setDocToDelete(null)
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() })
      },
      onError: () => {
        toast({
          title: "Suppression impossible",
          description:
            "Ce document est archivé et ne peut pas être supprimé.",
          variant: "destructive",
        })
        setDocToDelete(null)
      },
    },
  })

  // Split documents into active vs archived
  const activeDocs = (documents ?? []).filter((d) => !d.isArchived)
  const archivedDocs = (documents ?? []).filter((d) => d.isArchived)

  // Filter active docs by search term
  const filteredActive = activeDocs.filter(
    (d) =>
      d.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.clientName ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.category.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Filter archived docs by search term
  const filteredArchived = archivedDocs.filter(
    (d) =>
      d.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.clientName ?? "").toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Group archived docs by fiscal year (descending)
  const archivedByYear = new Map<number, typeof filteredArchived>()
  for (const doc of filteredArchived) {
    const year = doc.fiscalYear ?? 0
    const arr = archivedByYear.get(year) ?? []
    arr.push(doc)
    archivedByYear.set(year, arr)
  }
  const sortedYears = [...archivedByYear.keys()].sort((a, b) => b - a)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Gestion Documentaire (GED)
        </h1>
        <p className="text-muted-foreground mt-1">
          Bibliothèque centralisée de tous les documents du cabinet, tous clients
          confondus.
        </p>
      </div>

      {/* Search bar */}
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

      {/* Two-tab layout */}
      <Tabs defaultValue="actifs">
        <TabsList className="mb-4">
          <TabsTrigger value="actifs" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Documents Actifs
            {!isLoading && (
              <Badge variant="secondary" className="ml-1 font-normal">
                {filteredActive.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="archives" className="gap-2">
            <Archive className="h-4 w-4" />
            Archives Fiscales
            {!isLoading && archivedDocs.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 font-normal bg-amber-100 text-amber-800"
              >
                <Lock className="h-3 w-3 mr-1" />
                {sortedYears.length} exercice
                {sortedYears.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        {/* Tab 1: Documents Actifs                                           */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="actifs">
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[520px]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
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
                        <TableCell
                          colSpan={7}
                          className="text-center h-24 text-muted-foreground"
                        >
                          Chargement des documents...
                        </TableCell>
                      </TableRow>
                    ) : filteredActive.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="text-center h-32 text-muted-foreground"
                        >
                          <div className="flex flex-col items-center justify-center">
                            <FolderOpen className="h-8 w-8 mb-2 opacity-20" />
                            <p>Aucun document actif trouvé.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredActive.map((doc) => (
                        <ActiveDocRow
                          key={doc.id}
                          doc={doc as Doc}
                          canDelete={canDelete}
                          onDelete={setDocToDelete}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* Tab 2: Archives Fiscales                                          */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="archives">
          {isLoading ? (
            <Card className="shadow-sm">
              <CardContent className="flex items-center justify-center h-32 text-muted-foreground">
                Chargement des archives...
              </CardContent>
            </Card>
          ) : sortedYears.length === 0 ? (
            <Card className="shadow-sm">
              <CardContent className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-3">
                <Archive className="h-10 w-10 opacity-20" />
                <div className="text-center">
                  <p className="font-medium">Aucune archive fiscale</p>
                  <p className="text-sm mt-1">
                    Les archives apparaissent automatiquement après la clôture
                    d'un exercice comptable.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-500" />
                Ces documents font partie d'exercices définitivement clôturés.
                Ils sont en lecture seule pour tous les rôles (téléchargement et
                consultation uniquement).
              </p>
              {sortedYears.map((year) => (
                <FiscalYearPanel
                  key={year}
                  year={year}
                  docs={(archivedByYear.get(year) ?? []) as Doc[]}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete confirmation (active docs only) */}
      <AlertDialog
        open={!!docToDelete}
        onOpenChange={(open) => !open && setDocToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le document sera définitivement
              supprimé de la GED.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                docToDelete && deleteMutation.mutate({ id: docToDelete })
              }
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
