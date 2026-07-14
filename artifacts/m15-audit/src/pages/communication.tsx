import { useEffect, useMemo, useRef, useState } from "react"
import {
  useListChatChannels,
  getListChatChannelsQueryKey,
  useListChatColleagues,
  getListChatColleaguesQueryKey,
  useGetChatChannel,
  getGetChatChannelQueryKey,
  useListChatChannelMessages,
  getListChatChannelMessagesQueryKey,
  useCreateChatChannelMessage,
  useListChatDirectMessages,
  getListChatDirectMessagesQueryKey,
  useCreateChatDirectMessage,
  useJoinChatChannel,
  type ChatMessage,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { useRealtime } from "@/hooks/use-realtime"
import { useToast } from "@/hooks/use-toast"
import { formatDateTime } from "@/lib/utils"
import { getRoleLabel } from "@/lib/status"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CreateChannelDialog } from "@/components/chat/CreateChannelDialog"
import {
  MessagesSquare,
  Hash,
  Lock,
  Plus,
  Send,
  Paperclip,
  Users,
  UserCircle2,
} from "lucide-react"

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

type ActiveConversation = { type: "channel"; id: number } | { type: "dm"; id: number } | null

// Module M31 (Messagerie Interne du Cabinet — "le Slack du Cabinet"):
// internal chat for cabinet staff only. Portal accounts (client_pme /
// client_staff) never reach this route -- see the nav guard in Shell.tsx
// and the server-side isPortalRole check in routes/chat.ts.
export default function Communication() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  useRealtime(true)

  const [active, setActive] = useState<ActiveConversation>(null)
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [pendingFile, setPendingFile] = useState<{ fileName: string; mimeType: string; fileData: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollBottomRef = useRef<HTMLDivElement>(null)

  const { data: channels } = useListChatChannels({ query: { queryKey: getListChatChannelsQueryKey() } })
  const { data: colleagues } = useListChatColleagues({ query: { queryKey: getListChatColleaguesQueryKey() } })

  useEffect(() => {
    if (active !== null) return
    if (channels && channels.length > 0) {
      setActive({ type: "channel", id: channels[0].id })
    }
  }, [channels, active])

  const activeChannelId = active?.type === "channel" ? active.id : null
  const activeDmUserId = active?.type === "dm" ? active.id : null

  const { data: channelDetail } = useGetChatChannel(activeChannelId ?? 0, {
    query: { enabled: !!activeChannelId, queryKey: getGetChatChannelQueryKey(activeChannelId ?? 0) },
  })
  const { data: channelMessages, isLoading: isLoadingChannelMessages } = useListChatChannelMessages(
    activeChannelId ?? 0,
    { query: { enabled: !!activeChannelId, queryKey: getListChatChannelMessagesQueryKey(activeChannelId ?? 0) } },
  )
  const { data: dmMessages, isLoading: isLoadingDmMessages } = useListChatDirectMessages(activeDmUserId ?? 0, {
    query: { enabled: !!activeDmUserId, queryKey: getListChatDirectMessagesQueryKey(activeDmUserId ?? 0) },
  })

  const activeColleague = colleagues?.find((c) => c.id === activeDmUserId) ?? null
  const messages: ChatMessage[] = active?.type === "channel" ? channelMessages ?? [] : dmMessages ?? []
  const isLoadingMessages = active?.type === "channel" ? isLoadingChannelMessages : isLoadingDmMessages

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, active])

  const resetComposer = () => {
    setMessage("")
    setPendingFile(null)
  }

  const invalidateActive = () => {
    if (active?.type === "channel") {
      queryClient.invalidateQueries({ queryKey: getListChatChannelMessagesQueryKey(active.id) })
      queryClient.invalidateQueries({ queryKey: getListChatChannelsQueryKey() })
    } else if (active?.type === "dm") {
      queryClient.invalidateQueries({ queryKey: getListChatDirectMessagesQueryKey(active.id) })
    }
  }

  const createChannelMessageMutation = useCreateChatChannelMessage({
    mutation: {
      onSuccess: () => {
        resetComposer()
        invalidateActive()
      },
      onError: (error) => {
        toast({ title: "Échec de l'envoi", description: error.data?.error || "Une erreur est survenue.", variant: "destructive" })
      },
    },
  })

  const createDmMutation = useCreateChatDirectMessage({
    mutation: {
      onSuccess: () => {
        resetComposer()
        invalidateActive()
      },
      onError: (error) => {
        toast({ title: "Échec de l'envoi", description: error.data?.error || "Une erreur est survenue.", variant: "destructive" })
      },
    },
  })

  const joinChannelMutation = useJoinChatChannel({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListChatChannelsQueryKey() })
        if (activeChannelId) queryClient.invalidateQueries({ queryKey: getGetChatChannelQueryKey(activeChannelId) })
      },
    },
  })

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({ title: "Fichier trop volumineux", description: "4 Mo maximum.", variant: "destructive" })
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
    const attachment = pendingFile
      ? { attachmentFileName: pendingFile.fileName, attachmentMimeType: pendingFile.mimeType, attachmentData: pendingFile.fileData }
      : {}
    const text = message.trim() || "(pièce jointe)"

    if (active?.type === "channel") {
      createChannelMessageMutation.mutate({ id: active.id, data: { messageText: text, ...attachment } })
    } else if (active?.type === "dm") {
      createDmMutation.mutate({ data: { recipientId: active.id, messageText: text, ...attachment } })
    }
  }

  const isSending = createChannelMessageMutation.isPending || createDmMutation.isPending

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Messagerie Interne</h1>
        <p className="text-muted-foreground mt-1">
          Le Slack du cabinet — discutez en salons ou en messages directs avec votre équipe, sans quitter la plateforme.
        </p>
      </div>

      <div className="flex h-[calc(100vh-14rem)] min-h-[500px] rounded-lg border bg-card overflow-hidden shadow-sm">
        {/* Sidebar */}
        <div className="w-72 shrink-0 border-r flex flex-col">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              <div>
                <div className="flex items-center justify-between px-1 mb-1.5">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Salons</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setIsCreateChannelOpen(true)}
                    data-testid="button-create-channel"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-0.5" data-testid="list-channels">
                  {(channels ?? []).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActive({ type: "channel", id: c.id })}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                        active?.type === "channel" && active.id === c.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent text-foreground/80",
                      )}
                      data-testid={`button-channel-${c.id}`}
                    >
                      {c.isPrivate ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Hash className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate flex-1">{c.name}</span>
                      {!c.isMember && !c.isPrivate && (
                        <span className="text-[10px] opacity-70 shrink-0">Rejoindre</span>
                      )}
                    </button>
                  ))}
                  {(channels ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-1">Aucun salon pour l'instant.</p>
                  )}
                </div>
              </div>

              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                  Messages Directs
                </span>
                <div className="space-y-0.5 mt-1.5" data-testid="list-colleagues">
                  {(colleagues ?? []).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActive({ type: "dm", id: c.id })}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                        active?.type === "dm" && active.id === c.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent text-foreground/80",
                      )}
                      data-testid={`button-colleague-${c.id}`}
                    >
                      <span className="relative shrink-0">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[9px]">{initials(c.fullName)}</AvatarFallback>
                        </Avatar>
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card",
                            c.isOnline ? "bg-green-500" : "bg-gray-300",
                          )}
                        />
                      </span>
                      <span className="truncate">{c.fullName}</span>
                    </button>
                  ))}
                  {(colleagues ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-1">Aucun autre collaborateur.</p>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Main panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessagesSquare className="h-8 w-8 mb-2 opacity-20" />
              <p>Créez un salon ou choisissez un collègue pour démarrer une conversation.</p>
            </div>
          ) : (
            <>
              <div className="border-b p-3 flex items-center justify-between gap-2 shrink-0">
                {active.type === "channel" ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {channelDetail?.isPrivate ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{channelDetail?.name}</p>
                      {channelDetail?.description && (
                        <p className="text-xs text-muted-foreground truncate">{channelDetail.description}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCircle2 className="h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{activeColleague?.fullName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {getRoleLabel(activeColleague?.role)} · {activeColleague?.isOnline ? "En ligne" : "Hors ligne"}
                      </p>
                    </div>
                  </div>
                )}

                {active.type === "channel" && (
                  <div className="flex items-center gap-2 shrink-0">
                    {channelDetail && !channelDetail.isMember && !channelDetail.isPrivate && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => joinChannelMutation.mutate({ id: active.id })}
                        disabled={joinChannelMutation.isPending}
                        data-testid="button-join-channel"
                      >
                        Rejoindre
                      </Button>
                    )}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-channel-members">
                          <Users className="h-3.5 w-3.5" />
                          {channelDetail?.memberCount ?? 0}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-64">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          Membres du salon
                        </p>
                        <div className="space-y-1.5 max-h-64 overflow-y-auto">
                          {(channelDetail?.members ?? []).map((m) => (
                            <div key={m.id} className="flex items-center gap-2 text-sm">
                              <span className="relative shrink-0">
                                <Avatar className="h-6 w-6">
                                  <AvatarFallback className="text-[10px]">{initials(m.fullName)}</AvatarFallback>
                                </Avatar>
                                <span
                                  className={cn(
                                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-popover",
                                    m.isOnline ? "bg-green-500" : "bg-gray-300",
                                  )}
                                />
                              </span>
                              <span className="truncate">{m.fullName}</span>
                              <Badge variant="outline" className="ml-auto text-[10px]">
                                {getRoleLabel(m.role)}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>

              <ScrollArea className="flex-1 px-4">
                <div className="py-4 space-y-4" data-testid="list-messages">
                  {isLoadingMessages && <p className="text-sm text-muted-foreground text-center py-6">Chargement…</p>}
                  {!isLoadingMessages && messages.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      Aucun message pour le moment. Démarrez la conversation ci-dessous.
                    </p>
                  )}
                  {messages.map((m) => {
                    const isMine = m.senderId === user?.id
                    return (
                      <div key={m.id} className={cn("flex gap-2", isMine && "flex-row-reverse text-right")} data-testid={`message-${m.id}`}>
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="text-[10px]">{initials(m.senderName)}</AvatarFallback>
                        </Avatar>
                        <div className={cn("max-w-[75%] flex flex-col gap-1", isMine ? "items-end" : "items-start")}>
                          {active.type === "channel" && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{m.senderName}</span>
                              <span>·</span>
                              <span>{getRoleLabel(m.senderRole)}</span>
                            </div>
                          )}
                          <div className={cn("rounded-lg px-3 py-2 text-sm", isMine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                            {m.messageText}
                            {m.attachmentUrl && (
                              <a
                                href={m.attachmentUrl}
                                download={m.attachmentFileName ?? undefined}
                                className={cn(
                                  "mt-1.5 flex items-center gap-1.5 text-xs underline underline-offset-2",
                                  isMine ? "text-primary-foreground/90" : "text-primary",
                                )}
                              >
                                <Paperclip className="h-3 w-3" />
                                {m.attachmentFileName ?? "Pièce jointe"}
                              </a>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={scrollBottomRef} />
                </div>
              </ScrollArea>

              <div className="border-t p-3 space-y-2 shrink-0">
                {pendingFile && (
                  <div className="flex items-center gap-2 text-xs bg-muted rounded-md px-2 py-1.5">
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1">{pendingFile.fileName}</span>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => setPendingFile(null)}>
                      ✕
                    </button>
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Écrivez un message…"
                    className="min-h-[44px] max-h-32 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    data-testid="textarea-chat-message"
                  />
                  <Button
                    size="icon"
                    className="shrink-0"
                    onClick={handleSend}
                    disabled={isSending || (!message.trim() && !pendingFile)}
                    data-testid="button-send-message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <CreateChannelDialog
        open={isCreateChannelOpen}
        onOpenChange={setIsCreateChannelOpen}
        colleagues={colleagues ?? []}
        onCreated={(channelId) => setActive({ type: "channel", id: channelId })}
      />
    </div>
  )
}
