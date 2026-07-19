import { useState } from "react"
import { useCreateChatChannel, type ChatColleague } from "@workspace/api-client-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getRoleLabel } from "@/lib/status"
import { useToast } from "@/hooks/use-toast"

// Module M31 (Messagerie Interne du Cabinet): "Créer un salon" dialog. A
// public channel is open to every cabinet colleague of the firm by
// default (they just haven't joined yet); a private one only ever reaches
// the members picked here at creation time.
export function CreateChannelDialog({
  open,
  onOpenChange,
  colleagues,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  colleagues: ChatColleague[]
  onCreated: (channelId: number) => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isPrivate, setIsPrivate] = useState(false)
  const [memberIds, setMemberIds] = useState<number[]>([])

  const resetForm = () => {
    setName("")
    setDescription("")
    setIsPrivate(false)
    setMemberIds([])
  }

  const createMutation = useCreateChatChannel({
    mutation: {
      onSuccess: (channel) => {
        onOpenChange(false)
        resetForm()
        toast({ title: `Salon "${channel.name}" créé` })
        onCreated(channel.id)
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de créer ce salon",
          variant: "destructive",
        })
      },
    },
  })

  const toggleMember = (userId: number) => {
    setMemberIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]))
  }

  const handleSubmit = () => {
    if (!name.trim()) return
    createMutation.mutate({
      data: {
        name: name.trim(),
        description: description.trim() || undefined,
        isPrivate,
        memberIds: isPrivate ? memberIds : undefined,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-create-channel">
        <DialogHeader>
          <DialogTitle>Créer un salon</DialogTitle>
          <DialogDescription>
            Un espace de discussion pour votre équipe cabinet — sujet, dossier transverse, ou simplement la vie du
            bureau.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Nom du salon</Label>
            <Input
              id="channel-name"
              placeholder="ex. clients-difficiles"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-channel-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-description">Description (optionnel)</Label>
            <Textarea
              id="channel-description"
              placeholder="De quoi parle-t-on ici ?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              data-testid="input-channel-description"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Salon privé</p>
              <p className="text-xs text-muted-foreground">
                Seuls les membres choisis ci-dessous pourront le voir et y participer.
              </p>
            </div>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} data-testid="switch-channel-private" />
          </div>

          {isPrivate && (
            <div className="space-y-2">
              <Label>Membres à ajouter</Label>
              <ScrollArea className="h-40 rounded-md border p-2">
                <div className="space-y-1">
                  {colleagues.length === 0 && (
                    <p className="text-sm text-muted-foreground p-2">Aucun autre collaborateur dans le cabinet.</p>
                  )}
                  {colleagues.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
                      data-testid={`checkbox-member-${c.id}`}
                    >
                      <Checkbox checked={memberIds.includes(c.id)} onCheckedChange={() => toggleMember(c.id)} />
                      <span className="text-sm">{c.fullName}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{getRoleLabel(c.role)}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || createMutation.isPending} data-testid="button-submit-create-channel">
            {createMutation.isPending ? "Création..." : "Créer le salon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
