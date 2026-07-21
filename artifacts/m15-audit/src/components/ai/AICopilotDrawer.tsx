/**
 * AICopilotDrawer — M15 AI Copilot
 *
 * Widget de chat IA accessible sur toutes les pages de la plateforme.
 * - FAB fixe en bas à droite
 * - Panneau latéral droit sur desktop, drawer bas sur mobile
 * - Streaming SSE via POST /api/ai/copilot
 * - Rendu Markdown léger (sans dépendance externe)
 * - Prompts suggérés selon le rôle utilisateur
 * - Indicateur de contexte (page courante, dossier actif)
 */

import * as React from "react"
import { useLocation } from "wouter"
import { useAuth } from "@/hooks/use-auth"
import { getApiBase, getToken } from "@/lib/auth"
import { isPortalRole } from "@/lib/status"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Bot,
  X,
  Send,
  Sparkles,
  RotateCcw,
  ChevronDown,
  Loader2,
  Building2,
  FileText,
  AlertCircle,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  isStreaming?: boolean
  isError?: boolean
}

// ---------------------------------------------------------------------------
// Prompts suggérés selon le rôle
// ---------------------------------------------------------------------------

const CABINET_PROMPTS = [
  "Expliquer l'imputation SYSCOHADA pour une facture fournisseur",
  "Quels comptes utiliser pour les frais Mobile Money Wave ?",
  "Comment vérifier l'équilibre d'une écriture comptable ?",
  "Expliquer le calcul de la TVA déductible",
  "Quand utiliser le compte 585100 (virement de fonds) ?",
  "Différence entre régime Réel Normal et Réel Simplifié",
]

const PME_PROMPTS = [
  "Comment saisir une facture fournisseur ?",
  "Comment enregistrer un encaissement Wave ?",
  "Expliquer la TVA sur mes achats",
  "Quand dois-je payer mes cotisations CNPS ?",
  "Comment suivre mes impayés clients ?",
  "Que signifie le solde de ma trésorerie ?",
]

const ADMIN_PROMPTS = [
  "Vérifier la configuration d'un cabinet",
  "Expliquer les régimes fiscaux ivoiriens",
  "Quels sont les seuils de chiffre d'affaires DGI ?",
  "Comment fonctionne la licence M15 AUDIT ?",
]

// ---------------------------------------------------------------------------
// Lightweight Markdown renderer
// ---------------------------------------------------------------------------

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="bg-muted/80 text-foreground px-1 py-0.5 rounded text-[11px] font-mono border border-border/40">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n")
  const elements: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeKey = 0

  const flushList = () => {
    if (listItems.length) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-1.5 ml-3 space-y-0.5 list-none">
          {listItems}
        </ul>
      )
      listItems = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block toggle
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        inCodeBlock = false
        flushList()
        elements.push(
          <pre key={`code-${codeKey++}`} className="my-2 p-2.5 bg-muted rounded-md text-[11px] font-mono overflow-x-auto border border-border/40 leading-relaxed">
            {codeLines.join("\n")}
          </pre>
        )
        codeLines = []
      } else {
        flushList()
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Headings
    if (line.startsWith("### ")) {
      flushList()
      elements.push(
        <p key={`h3-${i}`} className="mt-2.5 mb-1 text-[12px] font-semibold text-foreground/90 uppercase tracking-wide">
          {renderInline(line.slice(4))}
        </p>
      )
      continue
    }
    if (line.startsWith("## ")) {
      flushList()
      elements.push(
        <p key={`h2-${i}`} className="mt-3 mb-1.5 text-[13px] font-bold text-foreground border-b border-border/30 pb-0.5">
          {renderInline(line.slice(3))}
        </p>
      )
      continue
    }
    if (line.startsWith("# ")) {
      flushList()
      elements.push(
        <p key={`h1-${i}`} className="mt-3 mb-1.5 text-sm font-bold text-foreground">
          {renderInline(line.slice(2))}
        </p>
      )
      continue
    }

    // List items (- or * or 1.)
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    const orderedMatch   = line.match(/^\d+\.\s+(.+)$/)
    if (unorderedMatch || orderedMatch) {
      const itemText = (unorderedMatch?.[1] ?? orderedMatch?.[1]) as string
      listItems.push(
        <li key={`li-${i}`} className="flex gap-1.5 text-[12.5px] leading-relaxed">
          <span className="text-primary/60 shrink-0 mt-px">{orderedMatch ? "•" : "–"}</span>
          <span>{renderInline(itemText)}</span>
        </li>
      )
      continue
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      flushList()
      elements.push(<hr key={`hr-${i}`} className="my-2 border-border/40" />)
      continue
    }

    // Empty line: flush list, add spacing
    if (!line.trim()) {
      flushList()
      if (elements.length > 0) {
        elements.push(<div key={`br-${i}`} className="h-1" />)
      }
      continue
    }

    // Normal paragraph
    flushList()
    elements.push(
      <p key={`p-${i}`} className="text-[12.5px] leading-relaxed">
        {renderInline(line)}
      </p>
    )
  }

  flushList()

  return <div className="space-y-0.5">{elements}</div>
}

// ---------------------------------------------------------------------------
// Helper: page title from route
// ---------------------------------------------------------------------------

function getPageTitle(route: string): string {
  const map: Record<string, string> = {
    "/dashboard":                     "Tableau de bord Cabinet",
    "/clients":                       "Registre des Clients",
    "/missions":                      "Missions de Visa",
    "/documents":                     "Gestion Documentaire",
    "/comptabilite":                  "Comptabilité & Travaux",
    "/immobilisations":               "Immobilisations",
    "/financements":                  "Financements & Dettes",
    "/dsf":                           "Déclaration DSF",
    "/paie":                          "Gestion de la Paie",
    "/teledeclaration":               "Télédéclaration TVA",
    "/scoring":                       "Scoring & Évaluation",
    "/portal":                        "Espace PME",
    "/mes-operations":                "Mes Opérations",
    "/caisse":                        "Caisse Terrain",
    "/depenses-achats":               "Dépenses & Achats",
    "/pilotage":                      "Pilotage",
    "/facturation":                   "Mon Facturier",
    "/tresorerie-mobile-money":       "Trésorerie Mobile Money",
    "/users":                         "Équipe",
    "/audit-log":                     "Journal d'Audit",
    "/cabinet/compliance":            "Journal de Conformité",
    "/cabinet/communication":         "Messagerie",
    "/admin/dashboard":               "Console Super Admin",
    "/admin/firms":                   "Gestion des Cabinets",
  }
  for (const [prefix, label] of Object.entries(map)) {
    if (route.startsWith(prefix)) return label
  }
  return "M15 AUDIT"
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AICopilotDrawer() {
  const { user } = useAuth()
  const [location] = useLocation()

  const [isOpen,     setIsOpen]     = React.useState(false)
  const [messages,   setMessages]   = React.useState<Message[]>([])
  const [input,      setInput]      = React.useState("")
  const [isStreaming, setIsStreaming] = React.useState(false)
  const [showScrollBtn, setShowScrollBtn] = React.useState(false)

  const messagesEndRef    = React.useRef<HTMLDivElement>(null)
  const messagesAreaRef   = React.useRef<HTMLDivElement>(null)
  const inputRef          = React.useRef<HTMLTextAreaElement>(null)
  const abortRef          = React.useRef<AbortController | null>(null)

  // Don't render for unauthenticated users
  if (!user) return null

  const isPme    = isPortalRole(user.role)
  const isAdmin  = user.role === "super_admin"
  const prompts  = isAdmin ? ADMIN_PROMPTS : isPme ? PME_PROMPTS : CABINET_PROMPTS

  const pageTitle   = getPageTitle(location)
  const contextName = user.firmName ?? "M15 AUDIT"

  // Auto-scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: "end" })
  }

  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => scrollToBottom("instant"), 50)
    }
  }, [isOpen])

  React.useEffect(() => {
    if (isStreaming) scrollToBottom()
  }, [messages, isStreaming])

  // Scroll indicator
  const handleScroll = () => {
    const el = messagesAreaRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(distFromBottom > 120)
  }

  // Focus input when drawer opens
  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  const sendMessage = React.useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return

    // Abort previous if any
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const userMsg: Message = {
      id:        crypto.randomUUID(),
      role:      "user",
      content:   trimmed,
      timestamp: new Date(),
    }

    const assistantMsgId = crypto.randomUUID()
    const assistantMsg: Message = {
      id:          assistantMsgId,
      role:        "assistant",
      content:     "",
      timestamp:   new Date(),
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput("")
    setIsStreaming(true)
    setTimeout(() => scrollToBottom(), 50)

    try {
      const conversationHistory = [...messages, userMsg].map(m => ({
        role:    m.role,
        content: m.content,
      }))

      const response = await fetch(`${getApiBase()}/api/ai/copilot`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          messages: conversationHistory,
          context: {
            route:       location,
            pageTitle,
            companyName: contextName,
          },
        }),
        signal: abortRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader  = response.body!.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ""
      let   accText = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()

          try {
            const parsed = JSON.parse(payload)
            if (parsed.error) {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: parsed.error, isStreaming: false, isError: true }
                  : m
              ))
              return
            }
            if (parsed.content) {
              accText += parsed.content
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: accText }
                  : m
              ))
            }
            if (parsed.done) break
          } catch {
            // malformed JSON chunk — skip
          }
        }
      }

      // Finalize: mark streaming complete
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, isStreaming: false }
          : m
      ))
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return

      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? {
              ...m,
              content:     "Une erreur s'est produite. Vérifiez votre connexion et réessayez.",
              isStreaming: false,
              isError:     true,
            }
          : m
      ))
    } finally {
      setIsStreaming(false)
    }
  }, [messages, isStreaming, location, pageTitle, contextName])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const clearConversation = () => {
    abortRef.current?.abort()
    setMessages([])
    setIsStreaming(false)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* ── Floating Action Button ─────────────────────────────────────────── */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Ouvrir M15 AI Copilot"
        className={cn(
          "fixed bottom-6 right-6 z-40",
          "h-14 w-14 rounded-full shadow-lg shadow-primary/25",
          "bg-primary text-primary-foreground",
          "flex items-center justify-center",
          "transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-primary/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isOpen && "opacity-0 pointer-events-none scale-90",
        )}
      >
        <Sparkles className="h-6 w-6" />
      </button>

      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        onClick={() => setIsOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]",
          "transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        aria-hidden="true"
      />

      {/* ── Chat Panel ────────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-label="M15 AI Copilot"
        aria-modal="true"
        className={cn(
          // Position: right side on all screens
          "fixed top-0 right-0 z-50 h-full",
          "w-full sm:w-[420px]",
          // Background + border
          "bg-card border-l border-border shadow-2xl",
          // Slide transition
          "transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
          // Flex column layout
          "flex flex-col",
        )}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground leading-none">
                  M15 AI Copilot
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Assistant SYSCOHADA • Fiscalité ivoirienne
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={clearConversation}
                  title="Nouvelle conversation"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setIsOpen(false)}
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Context badge */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 rounded-full bg-muted/60 border border-border/50 px-2 py-0.5">
              <Building2 className="h-3 w-3 text-primary/70 shrink-0" />
              <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                {contextName}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-muted/60 border border-border/50 px-2 py-0.5">
              <FileText className="h-3 w-3 text-primary/70 shrink-0" />
              <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                {pageTitle}
              </span>
            </div>
          </div>
        </div>

        {/* ── Messages area ──────────────────────────────────────────────── */}
        <div
          ref={messagesAreaRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-smooth"
        >
          {messages.length === 0 ? (
            /* Empty state — suggested prompts */
            <div className="space-y-4">
              <div className="flex flex-col items-center pt-6 pb-2 text-center">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  Bonjour{user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""} !
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px] leading-relaxed">
                  Je suis votre assistant comptable SYSCOHADA. Posez-moi vos questions sur la comptabilité, la fiscalité ivoirienne ou la plateforme.
                </p>
              </div>

              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-0.5">
                  Suggestions
                </p>
                <div className="space-y-1.5">
                  {prompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(prompt)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-xs",
                        "bg-muted/50 hover:bg-muted border border-border/40 hover:border-border",
                        "text-foreground/80 hover:text-foreground",
                        "transition-colors duration-150 leading-relaxed",
                      )}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Conversation */
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {msg.role === "assistant" && (
                    <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : cn(
                            "bg-muted/60 border border-border/40 rounded-tl-sm",
                            msg.isError && "border-red-200 bg-red-50/50",
                          ),
                    )}
                  >
                    {msg.role === "user" ? (
                      <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    ) : (
                      <div className="text-foreground">
                        {msg.isError ? (
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                            <p className="text-[12.5px] text-red-700 leading-relaxed">
                              {msg.content}
                            </p>
                          </div>
                        ) : (
                          <>
                            <MarkdownContent content={msg.content || " "} />
                            {msg.isStreaming && (
                              <span className="inline-block w-1.5 h-3.5 bg-primary/60 rounded-sm ml-0.5 animate-pulse" />
                            )}
                          </>
                        )}
                      </div>
                    )}

                    <p className={cn(
                      "text-[9px] mt-1.5 tabular-nums",
                      msg.role === "user"
                        ? "text-primary-foreground/60 text-right"
                        : "text-muted-foreground",
                    )}>
                      {msg.timestamp.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>

                  {msg.role === "user" && (
                    <div className="h-7 w-7 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-secondary-foreground">
                        {user.fullName?.[0]?.toUpperCase() ?? "U"}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Loading dots when streaming starts but content not yet arrived */}
              {isStreaming && messages[messages.length - 1]?.content === "" && (
                <div className="flex gap-2 justify-start">
                  <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
                  </div>
                  <div className="bg-muted/60 border border-border/40 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1 items-center h-4">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} className="h-1" />
            </>
          )}
        </div>

        {/* Scroll-to-bottom button */}
        {showScrollBtn && (
          <button
            onClick={() => scrollToBottom()}
            className={cn(
              "absolute bottom-[80px] right-4 z-10",
              "h-8 w-8 rounded-full bg-card border border-border shadow-md",
              "flex items-center justify-center",
              "text-muted-foreground hover:text-foreground transition-colors",
            )}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}

        {/* ── Input bar ──────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value)
                  // Auto-resize
                  e.target.style.height = "auto"
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
                }}
                onKeyDown={handleKeyDown}
                placeholder="Posez votre question comptable…"
                disabled={isStreaming}
                rows={1}
                className={cn(
                  "w-full resize-none rounded-xl border border-border bg-muted/40",
                  "px-3.5 py-2.5 text-[12.5px] leading-relaxed",
                  "placeholder:text-muted-foreground/60",
                  "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "transition-all duration-200 min-h-[40px] max-h-[120px]",
                )}
                style={{ height: "40px" }}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isStreaming}
              className="h-10 w-10 rounded-xl shrink-0"
            >
              {isStreaming
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />
              }
            </Button>
          </form>
          <p className="text-[9px] text-muted-foreground/50 text-center mt-2">
            Entrée pour envoyer • Maj+Entrée pour retour à la ligne
          </p>
        </div>
      </div>
    </>
  )
}
