import { useRef, useState } from "react"
import {
  useListComments,
  getListCommentsQueryKey,
  useCreateComment,
  useResolveThread,
  getListThreadsQueryKey,
  type CollaborationTargetType,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { formatDateTime } from "@/lib/utils"
import { getRoleLabel } from "@/lib/status"
import { useQueryClient } from "@tanstack/react-query"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Paperclip, Send, CheckCircle2, MessageSquare, UploadCloud } from "lucide-react"

interface CommentThreadSidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: number
  targetType: CollaborationTargetType
  targetId: number
  /** Short context block shown above the thread (e.g. the ledger line's date/libellé/montant). */
  targetSummary?: React.ReactNode
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

// Module M26 (Révision Collaborative & Chat Contextuel): the "Slack-style"
// slide-over. It attaches to a single (targetType, targetId) discussion —
// a ledger line, a pending document, or a tax declaration — and is reused
// identically from the cabinet's ledger review screen and the client
// portal, so both sides of the conversation see the exact same UI.
export function CommentThreadSidebar({
  open,
  onOpenChange,
  clientId,
  targetType,
  targetId,
  targetSummary,
}: CommentThreadSidebarProps) {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ fileName: string; mimeType: string; fileData: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: thread, isLoading } = useListComments(targetType, targetId, {
    query: {
      enabled: open,
      queryKey: getListCommentsQueryKey(targetType, targetId),
    },
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListCommentsQueryKey(targetType, targetId) })
    queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey({ clientId }) })
    queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() })
  }

  const createMutation = useCreateComment({
    mutation: {
      onSuccess: () => {
        setMessage("")
        setPendingFile(null)
        invalidateAll()
      },
      onError: (error) => {
        toast({
          title: "Échec de l'envoi",
          description: error.data?.error || "Une erreur est survenue.",
          variant: "destructive",
        })
      },
    },
  })

  const resolveMutation = useResolveThread({
    mutation: {
      onSuccess: () => {
        toast({ title: "Discussion marquée comme résolue" })
        invalidateAll()
      },
      onError: (error) => {
        toast({
          title: "Échec de l'opération",
          description: error.data?.error || "Une erreur est survenue.",
          variant: "destructive",
        })
      },
    },
  })

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({ title: "Fichier trop volumineux", description: "8 Mo maximum.", variant: "destructive" })
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const base64Data = event.target?.result?.toString().split(",")[1]
      if (!base64Data) return
      setPendingFile({ fileName: file.name, mimeType: file.type || "application/octet-stream", fileData: base64Data })
    }
    reader.readAsDataURL(file)
  }

  const handleSend = () => {
    if (!message.trim() && !pendingFile) return
    createMutation.mutate({
      data: {
        clientId,
        targetType,
        targetId,
        message: message.trim() || "(pièce jointe)",
        ...(pendingFile
          ? {
              attachmentFileName: pendingFile.fileName,
              attachmentMimeType: pendingFile.mimeType,
              attachmentData: pendingFile.fileData,
            }
          : {}),
      },
    })
  }

  const isClient = user?.role === "client_pme"
  const comments = thread?.comments ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0" data-testid="sheet-comment-thread">
        <SheetHeader className="p-4 border-b space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" />
              Discussion
            </SheetTitle>
            {thread?.isResolved ? (
              <Badge className="bg-teal-100 text-teal-800 border-0 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Résolu
              </Badge>
            ) : (
              <Badge variant="outline">En cours</Badge>
            )}
          </div>
          {targetSummary ?? (
            <SheetDescription className="text-xs">{thread?.targetLabel}</SheetDescription>
          )}
          {thread?.isResolved && thread.resolvedByName && (
            <p className="text-xs text-muted-foreground">
              Résolu par {thread.resolvedByName}
              {thread.resolvedAt ? ` le ${formatDateTime(thread.resolvedAt)}` : ""}
            </p>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 px-4">
          <div className="py-4 space-y-4" data-testid="list-comments">
            {isLoading && (
              <p className="text-sm text-muted-foreground text-center py-6">Chargement…</p>
            )}
            {!isLoading && comments.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Aucun message pour le moment. Démarrez la discussion ci-dessous.
              </p>
            )}
            {comments.map((comment) => {
              const isMine = comment.userId === user?.id
              return (
                <div
                  key={comment.id}
                  className={`flex gap-2 ${isMine ? "flex-row-reverse text-right" : ""}`}
                  data-testid={`comment-${comment.id}`}
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-[10px]">{initials(comment.userName)}</AvatarFallback>
                  </Avatar>
                  <div className={`max-w-[80%] ${isMine ? "items-end" : "items-start"} flex flex-col gap-1`}>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{comment.userName}</span>
                      <span>·</span>
                      <span>{getRoleLabel(comment.userRole)}</span>
                    </div>
                    <div
                      className={`rounded-lg px-3 py-2 text-sm ${
                        isMine ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                    >
                      {comment.message}
                      {comment.attachmentUrl && (
                        <a
                          href={comment.attachmentUrl}
                          download={comment.attachmentFileName ?? undefined}
                          className={`mt-1.5 flex items-center gap-1.5 text-xs underline underline-offset-2 ${
                            isMine ? "text-primary-foreground/90" : "text-primary"
                          }`}
                        >
                          <Paperclip className="h-3 w-3" />
                          {comment.attachmentFileName ?? "Pièce jointe"}
                        </a>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>

        <div className="border-t p-4 space-y-3">
          {!isClient && (
            <Button
              variant={thread?.isResolved ? "outline" : "secondary"}
              size="sm"
              className="w-full"
              disabled={thread?.isResolved || resolveMutation.isPending}
              onClick={() => resolveMutation.mutate({ targetType, targetId })}
              data-testid="button-resolve-thread"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {thread?.isResolved ? "Discussion résolue" : "Marquer comme résolu"}
            </Button>
          )}

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              handleFile(e.dataTransfer.files?.[0])
            }}
            className={`rounded-md border border-dashed p-2 text-xs text-muted-foreground flex items-center gap-2 cursor-pointer transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "hover:border-primary/50"
            }`}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-comment-attachment"
          >
            <UploadCloud className="h-3.5 w-3.5 shrink-0" />
            {pendingFile ? (
              <span className="truncate font-medium text-foreground">{pendingFile.fileName}</span>
            ) : (
              <span>Glissez un fichier ici ou cliquez pour joindre une pièce</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          <div className="flex gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Écrivez un message…"
              className="min-h-[60px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              data-testid="textarea-comment-message"
            />
            <Button
              size="icon"
              className="shrink-0 self-end"
              onClick={handleSend}
              disabled={createMutation.isPending || (!message.trim() && !pendingFile)}
              data-testid="button-send-comment"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
