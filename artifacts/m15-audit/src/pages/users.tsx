import { useListUsers, useUpdateUser, useCreateUser, useDeleteUser, useListClients, UserRole, UserStatus } from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useState } from "react"
import { 
  Users as UsersIcon, 
  Plus, 
  MoreHorizontal, 
  ShieldAlert, 
  Mail, 
  CheckCircle2, 
  Clock,
  Trash2,
  AlertCircle
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

function getRoleLabel(role: UserRole) {
  switch (role) {
    case 'expert_comptable': return 'Expert-comptable'
    case 'collaborateur': return 'Collaborateur'
    case 'stagiaire': return 'Stagiaire'
    case 'client_pme': return 'Client PME'
    default: return role
  }
}

function getRoleBadge(role: UserRole) {
  switch (role) {
    case 'expert_comptable': 
      return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 border-transparent dark:bg-purple-900/30 dark:text-purple-300">Expert-comptable</Badge>
    case 'collaborateur': 
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-transparent dark:bg-blue-900/30 dark:text-blue-300">Collaborateur</Badge>
    case 'stagiaire': 
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-transparent dark:bg-green-900/30 dark:text-green-300">Stagiaire</Badge>
    case 'client_pme': 
      return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-transparent dark:bg-orange-900/30 dark:text-orange-300">Client PME</Badge>
    default: return <Badge variant="outline">{role}</Badge>
  }
}

function getStatusIcon(status: UserStatus) {
  switch (status) {
    case 'active': return <CheckCircle2 className="h-4 w-4 text-teal-500" />
    case 'invited': return <Clock className="h-4 w-4 text-orange-500" />
    case 'disabled': return <ShieldAlert className="h-4 w-4 text-destructive" />
    default: return null
  }
}

export default function Users() {
  const { user: currentUser } = useAuth()
  const { toast } = useToast()
  const { data: users, isLoading, refetch } = useListUsers()
  const { data: clients } = useListClients()
  
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<number | null>(null)
  
  // Form states
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteName, setInviteName] = useState("")
  const [inviteRole, setInviteRole] = useState<UserRole>('collaborateur')
  const [invitePassword, setInvitePassword] = useState("")
  const [inviteClientId, setInviteClientId] = useState<string>("")

  const inviteMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        setIsInviteOpen(false)
        setInviteEmail("")
        setInviteName("")
        setInvitePassword("")
        setInviteRole('collaborateur')
        setInviteClientId("")
        toast({ title: "Utilisateur invité avec succès" })
        refetch()
      },
      onError: (error) => {
        toast({ 
          title: "Erreur", 
          description: error.data?.error || "Impossible d'inviter l'utilisateur",
          variant: "destructive"
        })
      }
    }
  })

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Statut mis à jour" })
        refetch()
      }
    }
  })

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        setUserToDelete(null)
        toast({ title: "Utilisateur supprimé" })
        refetch()
      }
    }
  })

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    if (inviteRole === 'client_pme' && !inviteClientId) {
      toast({
        title: "Erreur",
        description: "Un compte Espace PME doit être associé à un dossier client.",
        variant: "destructive"
      })
      return
    }
    inviteMutation.mutate({
      data: {
        email: inviteEmail,
        fullName: inviteName,
        role: inviteRole,
        password: invitePassword,
        ...(inviteRole === 'client_pme' ? { clientId: Number(inviteClientId) } : {})
      }
    })
  }

  const toggleStatus = (id: number, currentStatus: UserStatus) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    updateMutation.mutate({
      id,
      data: { status: newStatus }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Équipe & Accès</h1>
          <p className="text-muted-foreground mt-1">
            Gérez les collaborateurs du cabinet et les accès clients.
          </p>
        </div>
        
        {currentUser?.role === 'expert_comptable' && (
          <Button onClick={() => setIsInviteOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Inviter un utilisateur
          </Button>
        )}
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle>Membres du cabinet</CardTitle>
          <CardDescription>Liste de tous les comptes ayant accès à votre espace.</CardDescription>
        </CardHeader>
        <CardContent className="mt-6 p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                    Chargement des utilisateurs...
                  </TableCell>
                </TableRow>
              ) : (
                users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                          {user.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{user.fullName}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(user.status)}
                        <span className="text-sm capitalize">{user.status}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {currentUser?.role === 'expert_comptable' && currentUser.id !== user.id && (
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
                            <DropdownMenuItem 
                              onClick={() => toggleStatus(user.id, user.status)}
                            >
                              {user.status === 'active' ? 'Désactiver le compte' : 'Réactiver le compte'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-destructive focus:text-destructive focus:bg-destructive/10"
                              onClick={() => setUserToDelete(user.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un utilisateur</DialogTitle>
            <DialogDescription>
              Créez un compte pour un collaborateur ou un client. Ils recevront leurs identifiants.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nom complet</Label>
              <Input 
                id="name" 
                value={inviteName} 
                onChange={(e) => setInviteName(e.target.value)} 
                required 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Adresse email</Label>
              <Input 
                id="email" 
                type="email" 
                value={inviteEmail} 
                onChange={(e) => setInviteEmail(e.target.value)} 
                required 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe temporaire</Label>
              <Input 
                id="password" 
                type="text" 
                value={invitePassword} 
                onChange={(e) => setInvitePassword(e.target.value)} 
                required 
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">À transmettre à l'utilisateur de manière sécurisée.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Rôle</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un rôle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collaborateur">Collaborateur</SelectItem>
                  <SelectItem value="stagiaire">Stagiaire</SelectItem>
                  <SelectItem value="expert_comptable">Expert-comptable (Admin)</SelectItem>
                  <SelectItem value="client_pme">Client PME (Consultation)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteRole === 'client_pme' && (
              <div className="space-y-2">
                <Label htmlFor="client">Dossier client</Label>
                <Select value={inviteClientId} onValueChange={setInviteClientId}>
                  <SelectTrigger id="client">
                    <SelectValue placeholder="Sélectionner un client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Ce compte n'aura accès qu'au dossier sélectionné.</p>
              </div>
            )}
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsInviteOpen(false)} disabled={inviteMutation.isPending}>
                Annuler
              </Button>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? "Création..." : "Créer le compte"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Supprimer l'utilisateur ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. L'utilisateur n'aura plus accès à la plateforme.
              Ses actions passées resteront enregistrées dans le journal d'audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => userToDelete && deleteMutation.mutate({ id: userToDelete })}
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