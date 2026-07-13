import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { Link, useLocation } from "wouter"
import { 
  Building2, 
  Users, 
  Files, 
  ActivitySquare, 
  LogOut, 
  Menu,
  ChevronRight
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"

const PUBLIC_ROUTES = ["/login", "/register"]

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useAuth()
  const [location, setLocation] = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)
  const isPublicRoute = PUBLIC_ROUTES.includes(location)

  // Close mobile menu when location changes
  React.useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location])

  // Redirect to login once we know there's no authenticated session.
  // Without this, protected pages are left firing API calls that 401
  // forever and stay stuck on their loading skeleton.
  React.useEffect(() => {
    if (!isLoading && !user && !isPublicRoute) {
      setLocation("/login")
    }
  }, [isLoading, user, isPublicRoute, setLocation])

  // Redirect away from login/register once already authenticated.
  React.useEffect(() => {
    if (!isLoading && user && isPublicRoute) {
      setLocation(user.role === "client_pme" ? "/portal" : "/dashboard")
    }
  }, [isLoading, user, isPublicRoute, setLocation])

  // Espace PME (client_pme) accounts have their own dedicated portal and
  // must never reach the cabinet-facing screens (dashboard, client list,
  // team, audit log) even if they navigate there directly by URL.
  const CABINET_ONLY_PREFIXES = ["/dashboard", "/clients", "/users", "/audit-log"]
  React.useEffect(() => {
    if (
      !isLoading &&
      user?.role === "client_pme" &&
      (location === "/" || CABINET_ONLY_PREFIXES.some((p) => location.startsWith(p)))
    ) {
      setLocation("/portal")
    }
  }, [isLoading, user, location, setLocation])

  // If on login/register, don't show the shell
  if (isPublicRoute) {
    return <>{children}</>
  }

  // Simple loading state while we resolve the session, or while the
  // redirect-to-login effect above is about to fire — never render
  // protected content or its data-fetching children without a user.
  if (isLoading || !user) {
    return <div className="min-h-screen bg-background" />
  }

  // Same reasoning while the Espace PME redirect above is about to fire —
  // don't flash cabinet-only pages/data to a client_pme user.
  const isCabinetOnlyRoute = location === "/" || CABINET_ONLY_PREFIXES.some((p) => location.startsWith(p))
  if (user.role === "client_pme" && isCabinetOnlyRoute) {
    return <div className="min-h-screen bg-background" />
  }

  const NavItems = () => (
    <nav className="space-y-1 mt-6 px-3" data-testid="nav-menu">
      {user?.role === 'client_pme' ? (
        <Link href="/portal" className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
          location.startsWith("/portal")
            ? "bg-primary text-primary-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )} data-testid="link-portal">
          <Building2 className="h-5 w-5" />
          Espace PME
        </Link>
      ) : (
        <>
      <Link href="/dashboard" className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
        location === "/dashboard" 
          ? "bg-primary text-primary-foreground" 
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )} data-testid="link-dashboard">
        <ActivitySquare className="h-5 w-5" />
        Tableau de bord
      </Link>
      
      <Link href="/clients" className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
        location.startsWith("/clients") 
          ? "bg-primary text-primary-foreground" 
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )} data-testid="link-clients">
        <Building2 className="h-5 w-5" />
        Dossiers Clients
      </Link>
      
          <Link href="/users" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/users") 
              ? "bg-primary text-primary-foreground" 
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-users">
            <Users className="h-5 w-5" />
            Équipe
          </Link>
          
          <Link href="/audit-log" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/audit-log") 
              ? "bg-primary text-primary-foreground" 
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-audit-log">
            <Files className="h-5 w-5" />
            Journal d'Audit
          </Link>
        </>
      )}
    </nav>
  )

  const UserMenu = () => (
    <div className="mt-auto p-4">
      <Separator className="mb-4 bg-sidebar-border" />
      <div className="flex items-center justify-between">
        <div className="flex flex-col truncate pr-2">
          <span className="text-sm font-medium text-sidebar-foreground truncate" data-testid="text-username">
            {user?.fullName}
          </span>
          <span className="text-xs text-sidebar-foreground/60 truncate capitalize">
            {user?.role.replace('_', ' ')}
          </span>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={logout} 
          className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
          data-testid="button-logout"
          title="Déconnexion"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-background text-foreground flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between h-16 px-4 border-b bg-card">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight text-primary">
          <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono">
            M15
          </div>
          AUDIT
        </div>
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="-mr-2">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0 bg-sidebar border-sidebar-border text-sidebar-foreground flex flex-col">
            <div className="h-16 flex items-center px-6 font-bold text-xl tracking-tight text-primary-foreground border-b border-sidebar-border">
              <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono mr-2 text-sm">
                M15
              </div>
              AUDIT
            </div>
            <NavItems />
            <UserMenu />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground shrink-0">
        <div className="h-16 flex items-center px-6 font-bold text-xl tracking-tight text-primary-foreground border-b border-sidebar-border shrink-0">
          <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono mr-2 text-sm shadow-sm">
            M15
          </div>
          AUDIT
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <NavItems />
        </div>
        <UserMenu />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
