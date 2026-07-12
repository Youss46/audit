import { useState, useRef } from "react"
import { useRoute, Link } from "wouter"
import { 
  useGetClient, 
  getGetClientQueryKey,
  useListMissions, 
  getListMissionsQueryKey,
  useCreateMission, 
  useListClientDocuments,
  getListClientDocumentsQueryKey,
  useUploadClientDocument,
  useDeleteDocument,
  MissionStatus,
  Sector
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { formatDateTime, formatDate } from "@/lib/utils"
import { 
  Building2, 
  ChevronLeft, 
  FileText, 
  Plus, 
  Upload, 
  Trash2,
  FolderOpen,
  Calendar,
  MoreVertical,
  Download,
  AlertCircle
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

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

function getStatusColor(status: MissionStatus) {
  switch (status) {
    case 'en_attente': return 'bg-orange-100 text-orange-800'
    case 'en_cours': return 'bg-blue-100 text-blue-800'
    case 'anomalie': return 'bg-red-100 text-red-800'
    case 'valide': return 'bg-teal-100 text-teal-800'
    case 'visa_emis': return 'bg-green-100 text-green-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'XOF',
    maximumFractionDigits: 0
  }).format(amount)
}

function bytesToSize(bytes: number) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  if (bytes === 0) return '0 Byte'
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString())
  return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i]
}

export default function ClientDetail() {
  const [match, params] = useRoute("/clients/:id")
  const clientId = match ? parseInt(params.id) : 0
  
  const { user } = useAuth()
  const { toast } = useToast()
  
  const [isNewMissionOpen, setIsNewMissionOpen] = useState(false)
  const [fiscalYear, setFiscalYear] = useState<number>(new Date().getFullYear())
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [uploadCategory, setUploadCategory] = useState("Général")
  const [docToDelete, setDocToDelete] = useState<number | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: client, isLoading: isClientLoading } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId) }
  })
  
  const { data: missions, isLoading: isMissionsLoading, refetch: refetchMissions } = useListMissions({ clientId }, {
    query: { enabled: !!clientId, queryKey: getListMissionsQueryKey({ clientId }) }
  })
  
  const { data: documents, isLoading: isDocsLoading, refetch: refetchDocs } = useListClientDocuments(clientId, {
    query: { enabled: !!clientId, queryKey: getListClientDocumentsQueryKey(clientId) }
  })

  const createMissionMutation = useCreateMission({
    mutation: {
      onSuccess: () => {
        toast({ title: "Mission créée avec succès" })
        setIsNewMissionOpen(false)
        refetchMissions()
      },
      onError: (error) => {
        toast({ 
          title: "Erreur", 
          description: error.data?.error || "Impossible de créer la mission",
          variant: "destructive"
        })
      }
    }
  })

  const uploadDocMutation = useUploadClientDocument({
    mutation: {
      onSuccess: () => {
        toast({ title: "Document téléversé avec succès" })
        setIsUploadOpen(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        refetchDocs()
      },
      onError: (error) => {
        toast({ 
          title: "Erreur de téléversement", 
          description: error.data?.error || "Une erreur est survenue",
          variant: "destructive"
        })
      }
    }
  })

  const deleteDocMutation = useDeleteDocument({
    mutation: {
      onSuccess: () => {
        toast({ title: "Document supprimé" })
        setDocToDelete(null)
        refetchDocs()
      }
    }
  })

  const handleCreateMission = (e: React.FormEvent) => {
    e.preventDefault()
    createMissionMutation.mutate({
      data: {
        clientId,
        fiscalYear
      }
    })
  }

  const handleFileUpload = (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileInputRef.current?.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64Data = event.target?.result?.toString().split(',')[1]
      if (base64Data) {
        uploadDocMutation.mutate({
          id: clientId,
          data: {
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileData: base64Data,
            category: uploadCategory,
          }
        })
      }
    }
    reader.readAsDataURL(file)
  }

  if (isClientLoading) {
    return <div className="h-[50vh] flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
        Chargement du dossier...
      </div>
    </div>
  }

  if (!client) {
    return <div className="p-8 text-center text-muted-foreground">Client introuvable</div>
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/clients">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{client.name}</h1>
            <Badge variant="outline" className={`border-transparent ${getStatusColor(client.missionStatus)}`}>
              {getStatusLabel(client.missionStatus)}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
            <span>{client.legalForm}</span>
            {client.rccm && <span>• RCCM: {client.rccm}</span>}
            {client.accountingSystem && (
              <>
                <span>•</span>
                <Badge variant="secondary" className="font-mono text-xs font-normal">
                  SYSCOHADA {client.accountingSystem}
                </Badge>
              </>
            )}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="missions">Missions de Visa</TabsTrigger>
          <TabsTrigger value="documents">Portail Documentaire</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-0">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Informations KYC</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-y-4 text-sm">
                  <div>
                    <div className="text-muted-foreground mb-1">Secteur d'activité</div>
                    <div className="font-medium capitalize">{client.sector}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">N° Compte Contribuable</div>
                    <div className="font-medium">{client.taxId || '-'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Chiffre d'Affaires</div>
                    <div className="font-medium">{client.annualTurnover ? formatCurrency(client.annualTurnover) : '-'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Création au cabinet</div>
                    <div className="font-medium">{formatDate(client.createdAt)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Contacts & Coordonnées</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-muted-foreground mb-1">Contact principal</div>
                    <div className="font-medium">{client.contactName || '-'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-muted-foreground mb-1">Téléphone</div>
                      <div className="font-medium">{client.phone || '-'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Email</div>
                      <div className="font-medium break-all">{client.email || '-'}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Adresse complète</div>
                    <div className="font-medium">{client.address || '-'}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="missions" className="mt-0">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Missions de Visa</CardTitle>
                <CardDescription>Historique des visas comptables pour ce client.</CardDescription>
              </div>
              {user?.role !== 'client_pme' && (
                <Dialog open={isNewMissionOpen} onOpenChange={setIsNewMissionOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Nouvelle Mission
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Créer une mission de visa</DialogTitle>
                      <DialogDescription>
                        Initialisez une nouvelle mission. La checklist SYSCOHADA sera générée 
                        automatiquement selon la taille (CA) et le secteur d'activité.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateMission} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="year">Exercice fiscal</Label>
                        <Input 
                          id="year" 
                          type="number" 
                          min={2000} 
                          max={2100} 
                          value={fiscalYear} 
                          onChange={(e) => setFiscalYear(parseInt(e.target.value))} 
                          required 
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsNewMissionOpen(false)} disabled={createMissionMutation.isPending}>
                          Annuler
                        </Button>
                        <Button type="submit" disabled={createMissionMutation.isPending}>
                          {createMissionMutation.isPending ? "Création..." : "Générer la mission"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent>
              {isMissionsLoading ? (
                <div className="py-8 text-center text-muted-foreground">Chargement...</div>
              ) : !missions || missions.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center">
                  <Calendar className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground font-medium">Aucune mission n'a été créée pour ce client.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exercice</TableHead>
                      <TableHead>Système de Référence</TableHead>
                      <TableHead>Progression Contrôles</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missions.map((mission) => {
                      const progress = mission.checklistTotal > 0 
                        ? Math.round((mission.checklistCompleted / mission.checklistTotal) * 100) 
                        : 0;
                        
                      return (
                        <TableRow key={mission.id}>
                          <TableCell className="font-bold text-lg">{mission.fiscalYear}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-mono text-xs">
                              {mission.accountingSystem}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-full bg-secondary rounded-full h-2 max-w-[100px]">
                                <div 
                                  className="bg-primary h-2 rounded-full transition-all" 
                                  style={{ width: `${progress}%` }}
                                ></div>
                              </div>
                              <span className="text-xs font-medium min-w-[3rem]">
                                {mission.checklistCompleted}/{mission.checklistTotal}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`border-transparent ${getStatusColor(mission.status)}`}>
                              {getStatusLabel(mission.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/clients/${client.id}/missions/${mission.id}`}>
                                Ouvrir
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-0">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Portail Documentaire</CardTitle>
                <CardDescription>Documents, états financiers et justificatifs (GED).</CardDescription>
              </div>
              <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Upload className="mr-2 h-4 w-4" />
                    Téléverser
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Ajouter un document</DialogTitle>
                    <DialogDescription>
                      Les documents seront rattachés au dossier permanent du client.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleFileUpload} className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="category">Catégorie / Dossier</Label>
                      <Input 
                        id="category" 
                        value={uploadCategory} 
                        onChange={(e) => setUploadCategory(e.target.value)} 
                        required 
                        placeholder="Ex: États financiers, Juridique, Fiscal..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="file">Fichier</Label>
                      <Input 
                        id="file" 
                        type="file" 
                        ref={fileInputRef}
                        required 
                        className="cursor-pointer"
                      />
                    </div>
                    <DialogFooter className="pt-2">
                      <Button type="button" variant="outline" onClick={() => setIsUploadOpen(false)} disabled={uploadDocMutation.isPending}>
                        Annuler
                      </Button>
                      <Button type="submit" disabled={uploadDocMutation.isPending}>
                        {uploadDocMutation.isPending ? "Envoi en cours..." : "Téléverser"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {isDocsLoading ? (
                <div className="py-8 text-center text-muted-foreground">Chargement des documents...</div>
              ) : !documents || documents.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center border-2 border-dashed border-border rounded-lg bg-muted/10">
                  <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground font-medium mb-1">La GED est vide.</p>
                  <p className="text-sm text-muted-foreground/80 max-w-xs">Téléversez des états financiers ou justificatifs pour les rattacher à ce client.</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setIsUploadOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" /> Ajouter un document
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nom du fichier</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead>Taille</TableHead>
                      <TableHead>Ajouté le</TableHead>
                      <TableHead>Par</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[200px] block" title={doc.fileName}>{doc.fileName}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-normal">{doc.category}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{bytesToSize(doc.fileSize)}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{formatDateTime(doc.createdAt)}</TableCell>
                        <TableCell className="text-sm">{doc.uploadedByName || '-'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" title="Ouvrir / Télécharger (Simulation)" onClick={() => {
                              toast({ description: "Fonction de téléchargement simulée." })
                            }}>
                              <Download className="h-4 w-4" />
                            </Button>
                            {user?.role !== 'client_pme' && (
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
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!docToDelete} onOpenChange={(open) => !open && setDocToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Supprimer le document ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible et retirera le document de la GED de façon permanente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDocMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => docToDelete && deleteDocMutation.mutate({ id: docToDelete })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDocMutation.isPending}
            >
              {deleteDocMutation.isPending ? "Suppression..." : "Oui, supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}