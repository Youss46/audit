import { useState } from "react"
import { useListStaff, useListRoles, useCreateStaff, useUpdateStaff, useDeleteStaff } from "@workspace/api-client-react"
import {
  UserCog,
  Plus,
  MoreHorizontal,
  Mail,
  CheckCircle2,
  ShieldAlert,
  Trash2,
  AlertCircle,
  Copy,
  KeyRound,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"

// Module M29 (RBAC & Gestion du Personnel PME): the "Équipe" screen of the
// Espace PME, reachable only by the dossier owner ("client_pme"). Each
// collaborator ("client_staff") is assigned exactly one Role (ADMIN,
// COMMERCIAL, POMPISTE, COMPTABLE_INTERNE) whose permissions are fixed by
// the cabinet-wide catalog (GET /roles) -- there is no custom permission
// editor in this MVP.
export default function ClientStaff() {
  const { toast } = useToast()
  const { data: staff, isLoading, refetch } = useListStaff()
  const { data: roles } = useListRoles()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [staffToDelete, setStaffToDelete] = useState<number | null>(null)
  // Module M33: the auto-generated temporary password is only ever
  // returned once, in the create response -- shown here so the owner can
  // copy it before closing the dialog.
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [roleId, setRoleId] = useState<string>("")

  const resetForm = () => {
    setFullName("")
    setEmail("")
    setRoleId("")
  }

  const createMutation = useCreateStaff({
    mutation: {
      onSuccess: (data) => {
        setIsCreateOpen(false)
        setCreatedCredentials({ email: data.email, password: data.temporaryPassword ?? "" })
        resetForm()
        toast({ title: "Collaborateur ajouté avec succès" })
        refetch()
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible d'ajouter ce collaborateur",
          variant: "destructive",
        })
      },
    },
  })

  const updateMutation = useUpdateStaff({
    mutation: {
      onSuccess: () => {
        toast({ title: "Statut mis à jour" })
        refetch()
      },
    },
  })

  const deleteMutation = useDeleteStaff({
    mutation: {
      onSuccess: () => {
        setStaffToDelete(null)
        toast({ title: "Collaborateur supprimé" })
        refetch()
      },
    },
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!roleId) {
      toast({ title: "Erreur", description: "Sélectionnez un rôle.", variant: "destructive" })
      return
    }
    createMutation.mutate({
      data: { fullName, email, roleId: Number(roleId) },
    })
  }

  const copyPassword = (password: string) => {
    navigator.clipboard.writeText(password)
    toast({ title: "Mot de passe copié" })
  }

  const toggleStatus = (id: number, currentStatus: string) => {
    updateMutation.mutate({
      id,
      data: { status: currentStatus === "active" ? "disabled" : "active" },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Équipe</h1>
          <p className="text-muted-foreground mt-1">
            Créez des accès restreints pour vos collaborateurs (agent terrain, comptable interne, commercial...).
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-add-staff">
          <Plus className="mr-2 h-4 w-4" />
          Ajouter un collaborateur
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle>Collaborateurs</CardTitle>
          <CardDescription>Chaque collaborateur n'a accès qu'aux fonctions permises par son rôle.</CardDescription>
        </CardHeader>
        <CardContent className="mt-6 p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Collaborateur</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                    Chargement des collaborateurs...
                  </TableCell>
                </TableRow>
              ) : !staff || staff.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                    Aucun collaborateur pour le moment.
                  </TableCell>
                </TableRow>
              ) : (
                staff.map((member) => (
                  <TableRow key={member.id} data-testid={`row-staff-${member.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                          {member.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{member.fullName}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {member.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-transparent bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
                        {member.roleLabel ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {member.status === "active" ? (
                          <CheckCircle2 className="h-4 w-4 text-teal-500" />
                        ) : (
                          <ShieldAlert className="h-4 w-4 text-destructive" />
                        )}
                        <span className="text-sm">{member.status === "active" ? "Actif" : "Désactivé"}</span>
                      </div>
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
                          <DropdownMenuItem onClick={() => toggleStatus(member.id, member.status)}>
                            {member.status === "active" ? "Désactiver le compte" : "Réactiver le compte"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            onClick={() => setStaffToDelete(member.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Ajouter un collaborateur
            </DialogTitle>
            <DialogDescription>
              Ce compte n'aura accès qu'aux fonctions autorisées par le rôle choisi. Un mot de
              passe temporaire sera généré automatiquement — vous n'aurez qu'à le transmettre.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="staff-name">Nom complet</Label>
              <Input id="staff-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-email">Adresse email</Label>
              <Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-role">Rôle</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger id="staff-role">
                  <SelectValue placeholder="Sélectionner un rôle" />
                </SelectTrigger>
                <SelectContent>
                  {roles?.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {roleId && (
                <p className="text-xs text-muted-foreground">
                  {roles?.find((r) => String(r.id) === roleId)?.description}
                </p>
              )}
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={createMutation.isPending}>
                Annuler
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Création..." : "Créer le compte"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdCredentials} onOpenChange={(open) => !open && setCreatedCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Compte créé avec succès
            </DialogTitle>
            <DialogDescription>
              Transmettez ces identifiants au collaborateur de manière sécurisée. Ce mot de passe
              temporaire ne sera plus affiché après la fermeture de cette fenêtre — il devra le
              remplacer dès sa première connexion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <Label>Adresse email</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-mono" data-testid="text-created-email">
                {createdCredentials?.email}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Mot de passe temporaire</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border bg-muted/30 px-3 py-2 text-sm font-mono" data-testid="text-created-password">
                  {createdCredentials?.password}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => createdCredentials && copyPassword(createdCredentials.password)}
                  data-testid="button-copy-password"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" onClick={() => setCreatedCredentials(null)} data-testid="button-close-credentials">
              J'ai transmis les identifiants
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!staffToDelete} onOpenChange={(open) => !open && setStaffToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Supprimer ce collaborateur ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le collaborateur n'aura plus accès à votre espace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => staffToDelete && deleteMutation.mutate({ id: staffToDelete })}
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
