import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Global error boundary — wraps the entire app in main.tsx.
 * Catches any unhandled render error and shows a recovery screen
 * instead of a blank white page.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep in console for debugging; can be forwarded to a monitoring
    // service (Sentry, etc.) here without blocking the fallback UI.
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null })
    window.location.href = "/"
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          {/* Logo badge */}
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-[#1e3a5f] flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-xl tracking-tight">M15</span>
            </div>
          </div>

          {/* Error icon + message */}
          <div className="space-y-3">
            <div className="flex justify-center">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">
              Une erreur inattendue s'est produite
            </h1>
            <p className="text-sm text-slate-500">
              L'application a rencontré un problème et n'a pas pu s'afficher correctement.
              Rechargez la page — vos données ne sont pas perdues.
            </p>
          </div>

          {/* Error detail (collapsible feel via small muted block) */}
          {this.state.error && (
            <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 text-left">
              <p className="text-xs font-mono text-slate-500 break-all line-clamp-3">
                {this.state.error.message}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={this.handleReload} className="gap-2 bg-[#1e3a5f] hover:bg-[#16304f]">
              <RefreshCw className="h-4 w-4" />
              Recharger la page
            </Button>
            <Button variant="outline" onClick={this.handleGoHome}>
              Retour à l'accueil
            </Button>
          </div>

          <p className="text-xs text-slate-400">
            Si l'erreur persiste, contactez le support M15-AUDIT.
          </p>
        </div>
      </div>
    )
  }
}
