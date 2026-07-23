import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { useIdleTimeout } from "@/hooks/use-idle-timeout"
import { SessionTimeoutDialog } from "@/components/SessionTimeoutDialog"
import { Link, useLocation, useSearch } from "wouter"
import { 
  Building2, 
  Users, 
  Files, 
  ActivitySquare, 
  LogOut, 
  Menu,
  ChevronRight,
  Stamp,
  FolderOpen,
  Wallet,
  BookOpenCheck,
  Banknote,
  Gauge,
  ShieldCheck,
  Layers,
  Landmark,
  BarChart3,
  Receipt,
  MessagesSquare,
  TrendingDown,
  TrendingUp,
  FileSpreadsheet,
  SlidersHorizontal,
  Percent,
  KeyRound,
  LayoutDashboard,
  ShieldAlert,
  MapPin,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getRoleBadgeColor, getUserRoleLabel, isPortalRole, isSuperAdmin, hasPermission } from "@/lib/status"
import { UserCog, Fuel, CircleDollarSign, Smartphone, ShoppingCart, ClipboardCheck } from "lucide-react"
import { useGetFirmPendingCounts, getGetFirmPendingCountsQueryKey, useGetClient } from "@workspace/api-client-react"
import { NotificationBell } from "@/components/collaboration/NotificationBell"
import { HelpButton } from "@/components/support/HelpSupportPanel"
import { AICopilotDrawer } from "@/components/ai/AICopilotDrawer"
import { CabinetAccountSmartSearch } from "@/components/ai/CabinetAccountSmartSearch"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

// Module M33: /force-password-change is reachable with a restricted token
// that /auth/me (and every other authenticated route) rejects -- treat it
// like a public route so the Shell doesn't bounce back to /login while the
// interceptor page does its own thing with that token.
const PUBLIC_ROUTES = ["/login", "/register", "/force-password-change", "/forgot-password", "/reset-password"]

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useAuth()
  const [location, setLocation] = useLocation()
  const search = useSearch()
  const typeParam = new URLSearchParams(search).get("type")
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)
  const [smartSearchOpen, setSmartSearchOpen] = React.useState(false)
  const isPublicRoute = PUBLIC_ROUTES.includes(location)

  // Bug fix: the sidebar's scroll position used to reset to the top on
  // every navigation (React re-renders the nav list on each route change),
  // burying the active link below the fold and forcing the user to
  // rescroll to see where they are. Re-scroll the active link into view
  // whenever the route (or the query-string tab, e.g. "Comptabilité"'s
  // Dépenses/Recettes sub-views) changes, or when the mobile sidebar opens.
  // The active link is identified the same way it's already styled --
  // it's the one link carrying the "bg-primary" active class -- so this
  // needs no extra state threaded through every nav item.
  const desktopNavScrollRef = React.useRef<HTMLDivElement>(null)
  const mobileNavScrollRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const scrollActiveLinkIntoView = () => {
      for (const container of [desktopNavScrollRef.current, mobileNavScrollRef.current]) {
        if (!container) continue
        const activeLink = container.querySelector<HTMLElement>("a.bg-primary")
        activeLink?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }
    // A single requestAnimationFrame can still fire mid-layout right after
    // the mobile Sheet mounts (Radix portals it in and starts its 500ms
    // slide-in transition), so the very first frame sometimes measures the
    // container before its final size/scrollHeight settle -- wait two
    // frames, which reliably lands after that first layout pass.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(scrollActiveLinkIntoView)
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [location, search, isMobileMenuOpen])

  // Module M32: firm-wide "à valider" counters, live behind the global
  // "Révision Dépenses" / "Révision Recettes" nav badges below. Cabinet
  // staff only -- an Espace PME account never sees these links. The
  // WebSocket push (see use-realtime.ts) invalidates this query on every
  // create/approve/reject, with a 30s poll as a fallback if the socket
  // never connects.
  // Session timeout: 15 min inactivity warning + auto-logout.
  // Only active when a user is authenticated and not on a public route.
  const isAuthenticated = !!user && !isPublicRoute
  const { showWarning, secondsLeft, stayConnected } = useIdleTimeout(logout, isAuthenticated)

  const isCabinetStaff = !!user && !isPortalRole(user.role)
  const { data: firmPendingCounts } = useGetFirmPendingCounts({
    query: { queryKey: getGetFirmPendingCountsQueryKey(), enabled: isCabinetStaff, refetchInterval: 30_000 },
  })

  // Menus station service (pompes, carburant…) : visibles uniquement si la
  // PME est de secteur STATION_SERVICE.
  const pmeClientId = user?.role === "client_pme" ? (user?.clientId ?? 0) : 0
  const { data: pmeClient } = useGetClient(pmeClientId, {
    query: { enabled: !!pmeClientId },
  })
  const isStationService = pmeClient?.sector === "STATION_SERVICE"

  // Close mobile menu when location changes
  React.useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location])

  // Ctrl+K / Cmd+K — Plan Comptable smart search palette (cabinet only)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        if (!user || isPortalRole(user.role) || isSuperAdmin(user.role)) return
        e.preventDefault()
        setSmartSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [user])

  // Redirect to login once we know there's no authenticated session.
  // Without this, protected pages are left firing API calls that 401
  // forever and stay stuck on their loading skeleton.
  React.useEffect(() => {
    if (!isLoading && !user && !isPublicRoute) {
      setLocation("/login")
    }
  }, [isLoading, user, isPublicRoute, setLocation])

  // Redirect away from login/register once already authenticated.
  // Les super_admin rejoignent la console d'administration système.
  React.useEffect(() => {
    if (!isLoading && user && isPublicRoute) {
      if (isSuperAdmin(user.role)) {
        setLocation("/admin/dashboard")
      } else {
        setLocation(isPortalRole(user.role) ? "/portal" : "/dashboard")
      }
    }
  }, [isLoading, user, isPublicRoute, setLocation])

  // Super Admin : toujours confiné à /admin/*.
  // Tout accès direct à une autre route le redirige vers son tableau de bord.
  React.useEffect(() => {
    if (!isLoading && isSuperAdmin(user?.role) && !location.startsWith("/admin")) {
      setLocation("/admin/dashboard")
    }
  }, [isLoading, user, location, setLocation])

  // Non-super_admin : interdit sur /admin/*.
  // Redirige vers l'espace approprié selon le rôle.
  React.useEffect(() => {
    if (!isLoading && user && !isSuperAdmin(user.role) && location.startsWith("/admin")) {
      setLocation(isPortalRole(user.role) ? "/portal" : "/dashboard")
    }
  }, [isLoading, user, location, setLocation])

  // Espace PME (client_pme + client_staff, module M29) accounts have their
  // own dedicated portal and must never reach the cabinet-facing screens
  // (dashboard, client list, team, audit log) even if they navigate there
  // directly by URL.
  const CABINET_ONLY_PREFIXES = ["/dashboard", "/clients", "/missions", "/documents", "/users", "/audit-log", "/comptabilite", "/immobilisations", "/financements", "/dsf", "/paie", "/teledeclaration", "/scoring", "/cabinet/client", "/cabinet/compliance", "/cabinet/communication", "/cabinet/settings", "/cabinet/plan-comptable"]
  const CLIENT_PME_PREFIXES = ["/mes-operations", "/caisse", "/pilotage", "/facturation", "/tresorerie-mobile-money", "/client/settings"]
  React.useEffect(() => {
    if (
      !isLoading &&
      isPortalRole(user?.role) &&
      (location === "/" || CABINET_ONLY_PREFIXES.some((p) => location.startsWith(p)))
    ) {
      setLocation("/portal")
    }
  }, [isLoading, user, location, setLocation])

  // "Mes Opérations" (module P3) and "Caisse Terrain" (module P5) are the
  // Espace PME's own entry screens -- cabinet staff have no client context
  // there and use "/comptabilite" instead.
  React.useEffect(() => {
    if (
      !isLoading &&
      user &&
      !isPortalRole(user.role) &&
      CLIENT_PME_PREFIXES.some((p) => location.startsWith(p))
    ) {
      setLocation("/dashboard")
    }
  }, [isLoading, user, location, setLocation])

  // Module M29: only the PME owner account ("client_pme") manages staff --
  // even an ADMIN-role client_staff account is redirected away.
  React.useEffect(() => {
    if (
      !isLoading &&
      user &&
      user.role !== "client_pme" &&
      (location.startsWith("/client/settings/staff") ||
        location.startsWith("/client/settings/pumps") ||
        location.startsWith("/client/settings/fuel-prices") ||
        location.startsWith("/client/settings/pump-assignments"))
    ) {
      setLocation(isPortalRole(user.role) ? "/portal" : "/dashboard")
    }
  }, [isLoading, user, location, setLocation])

  // Module M29: a client_staff account is redirected away from any Espace
  // PME screen its role's permissions don't grant, e.g. a POMPISTE hitting
  // "/pilotage" directly by URL only ever sees Dashboard + Facturation.
  React.useEffect(() => {
    if (!isLoading && user?.role === "client_staff") {
      const blocked =
        (location.startsWith("/mes-operations") && !hasPermission(user, "operations.view")) ||
        (location.startsWith("/caisse") && !hasPermission(user, "caisse.view")) ||
        (location.startsWith("/pilotage") && !hasPermission(user, "pilotage.view")) ||
        (location.startsWith("/facturation") && !hasPermission(user, "facturation.view")) ||
        (location.startsWith("/tresorerie-mobile-money") && !hasPermission(user, "facturation.view"))
      if (blocked) setLocation("/portal")
    }
  }, [isLoading, user, location, setLocation])

  // Module M14: the Journal de Conformité is a senior-accountant/admin
  // surface -- collaborateur and stagiaire accounts see the general
  // "/audit-log" instead, matching the backend's
  // requireRole("expert_comptable") guard on GET /audit-logs.
  React.useEffect(() => {
    if (!isLoading && user && user.role !== "expert_comptable" && location.startsWith("/cabinet/compliance")) {
      setLocation(isPortalRole(user.role) ? "/portal" : "/dashboard")
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
  if (isPortalRole(user.role) && isCabinetOnlyRoute) {
    return <div className="min-h-screen bg-background" />
  }
  if (!isPortalRole(user.role) && CLIENT_PME_PREFIXES.some((p) => location.startsWith(p))) {
    return <div className="min-h-screen bg-background" />
  }
  if (
    user.role !== "client_pme" &&
    (location.startsWith("/client/settings/staff") ||
      location.startsWith("/client/settings/stations") ||
      location.startsWith("/client/settings/pumps") ||
      location.startsWith("/client/settings/fuel-prices") ||
      location.startsWith("/client/settings/pump-assignments"))
  ) {
    return <div className="min-h-screen bg-background" />
  }
  if (user.role !== "expert_comptable" && location.startsWith("/cabinet/compliance")) {
    return <div className="min-h-screen bg-background" />
  }

  // Super Admin hors de /admin/* → écran blanc pendant la redirection.
  if (isSuperAdmin(user.role) && !location.startsWith("/admin")) {
    return <div className="min-h-screen bg-background" />
  }
  // Non-super_admin sur /admin/* → écran blanc pendant la redirection.
  if (!isSuperAdmin(user.role) && location.startsWith("/admin")) {
    return <div className="min-h-screen bg-background" />
  }

  const NavItems = () => (
    <nav className="space-y-1 mt-6 px-3" data-testid="nav-menu">
      {isSuperAdmin(user?.role) ? (
        <>
          {/* ── Console Super Admin ─────────────────────────── */}
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
            Console Système
          </p>

          <Link href="/admin/dashboard" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location === "/admin/dashboard" || location === "/admin"
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-admin-dashboard">
            <LayoutDashboard className="h-5 w-5" />
            Tableau de bord
          </Link>

          <Link href="/admin/firms" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/admin/firms")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-admin-firms">
            <Building2 className="h-5 w-5" />
            Cabinets
          </Link>

          <Link href="/admin/licenses" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/admin/licenses")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-admin-licenses">
            <KeyRound className="h-5 w-5" />
            Licences
          </Link>
        </>
      ) : isPortalRole(user?.role) ? (
        <>
          <Link href="/portal" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location === "/portal"
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-portal">
            <Building2 className="h-5 w-5" />
            {user?.roleCode === 'POMPISTE' ? 'Espace Pompiste' : 'Espace PME'}
          </Link>

          {hasPermission(user, "operations.view") && (
            <Link href="/mes-operations" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/mes-operations")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-comptabilite-pme">
              <Wallet className="h-5 w-5 shrink-0" />
              <span className="flex flex-col leading-tight">
                <span>Mes Opérations</span>
                <span className="text-[10px] font-normal opacity-60 leading-tight">Recettes & dépenses courantes</span>
              </span>
            </Link>
          )}

          {hasPermission(user, "caisse.view") && user?.roleCode !== 'POMPISTE' && (
            <Link href="/caisse" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/caisse")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-caisse-express">
              <Banknote className="h-5 w-5" />
              Caisse Terrain
            </Link>
          )}

          {hasPermission(user, "operations.view") && user?.roleCode !== 'POMPISTE' && (
            <Link href="/depenses-achats" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/depenses-achats")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-depenses-achats">
              <ShoppingCart className="h-5 w-5 shrink-0" />
              <span className="flex flex-col leading-tight">
                <span>Dépenses & Achats</span>
                <span className="text-[10px] font-normal opacity-60 leading-tight">Factures fournisseurs (TVA / AIB)</span>
              </span>
            </Link>
          )}

          {hasPermission(user, "pilotage.view") && (
            <Link href="/pilotage" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/pilotage")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-pilotage">
              <Gauge className="h-5 w-5" />
              Pilotage
            </Link>
          )}

          {hasPermission(user, "facturation.view") && user?.roleCode !== 'POMPISTE' && (
            <Link href="/facturation" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/facturation")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-facturation">
              <Receipt className="h-5 w-5" />
              Mon Facturier
            </Link>
          )}

          {hasPermission(user, "facturation.view") && user?.roleCode !== 'POMPISTE' && (
            <Link href="/tresorerie-mobile-money" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/tresorerie-mobile-money")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-tresorerie-mobile-money">
              <Smartphone className="h-5 w-5" />
              Trésorerie Mobile Money
            </Link>
          )}

          {/* Module M29: only the account that owns the dossier ("client_pme")
              manages staff -- not a staff account, even an ADMIN one. */}
          {user?.role === "client_pme" && (
            <Link href="/client/settings/staff" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/client/settings/staff")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-staff">
              <UserCog className="h-5 w-5" />
              Équipe
            </Link>
          )}

          {/* Multi-station (P8): physical station management -- station PMEs only. */}
          {user?.role === "client_pme" && isStationService && (
            <Link href="/client/settings/stations" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/client/settings/stations")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-stations">
              <MapPin className="h-5 w-5" />
              Gestion des stations
            </Link>
          )}

          {/* Module P7: pump registration & initial calibration -- station PMEs only. */}
          {user?.role === "client_pme" && isStationService && (
            <Link href="/client/settings/pumps" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/client/settings/pumps")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-pumps">
              <Fuel className="h-5 w-5" />
              Gestion des pompes
            </Link>
          )}

          {/* Module P7 (Sécurisation du prix carburant): active FCFA price
              per litre for each fuel type -- station PMEs only. */}
          {user?.role === "client_pme" && isStationService && (
            <Link href="/client/settings/fuel-prices" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/client/settings/fuel-prices")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-fuel-prices">
              <CircleDollarSign className="h-5 w-5" />
              Prix du carburant
            </Link>
          )}

          {/* Module P7: daily pump-to-pompiste assignment -- station PMEs only. */}
          {user?.role === "client_pme" && isStationService && (
            <Link href="/client/settings/pump-assignments" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/client/settings/pump-assignments")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-pump-assignments">
              <UserCog className="h-5 w-5" />
              Attribution des pompes
            </Link>
          )}
        </>
      ) : (
        <>
          {/* ── Vue d'ensemble ─────────────────────────────── */}
          <Link href="/dashboard" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location === "/dashboard"
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-dashboard">
            <ActivitySquare className="h-5 w-5" />
            Tableau de bord
          </Link>

          {/* ── Gestion des dossiers clients ────────────────── */}
          <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
            Dossiers
          </p>

          <Link href="/clients" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/clients")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-clients">
            <Building2 className="h-5 w-5" />
            Registre des Clients
          </Link>

          <Link href="/missions" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/missions")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-missions">
            <Stamp className="h-5 w-5" />
            Missions de Visa
          </Link>

          <Link href="/documents" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/documents")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-documents">
            <FolderOpen className="h-5 w-5" />
            Gestion Documentaire (GED)
          </Link>

          {/* ── Comptabilité ────────────────────────────────── */}
          <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
            Comptabilité
          </p>

          <Link href="/comptabilite" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/comptabilite") && !typeParam
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-comptabilite-cabinet">
            <BookOpenCheck className="h-5 w-5" />
            Comptabilité &amp; Travaux
          </Link>

          {/* Module M32: quick-access "à valider" queues with live counts */}
          <Link href="/comptabilite?type=depense" className={cn(
            "flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/comptabilite") && typeParam === "depense"
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-revision-depenses">
            <span className="flex items-center gap-3">
              <TrendingDown className="h-4 w-4" />
              Révision Dépenses
            </span>
            {!!firmPendingCounts?.pendingExpenses && (
              <Badge className="h-5 min-w-5 justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white hover:bg-red-600" data-testid="badge-pending-depenses">
                {firmPendingCounts.pendingExpenses}
              </Badge>
            )}
          </Link>

          <Link href="/comptabilite?type=recette" className={cn(
            "flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/comptabilite") && typeParam === "recette"
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-revision-recettes">
            <span className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4" />
              Révision Recettes
            </span>
            {!!firmPendingCounts?.pendingRevenues && (
              <Badge className="h-5 min-w-5 justify-center rounded-full bg-orange-500 px-1.5 text-[11px] font-bold text-white hover:bg-orange-500" data-testid="badge-pending-recettes">
                {firmPendingCounts.pendingRevenues}
              </Badge>
            )}
          </Link>

          <Link href="/cabinet/depenses-revision" className={cn(
            "flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/cabinet/depenses-revision")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-depenses-revision">
            <span className="flex items-center gap-3">
              <ClipboardCheck className="h-4 w-4" />
              Dépenses PME à valider
            </span>
          </Link>

          {/* ── États financiers ────────────────────────────── */}
          <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
            États financiers
          </p>

          <Link href="/immobilisations" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            (location.startsWith("/immobilisations") || (location.startsWith("/cabinet/client") && location.includes("/immobilisations")))
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-immobilisations">
            <Layers className="h-5 w-5" />
            Immobilisations
          </Link>

          <Link href="/financements" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            (location.startsWith("/financements") || (location.startsWith("/cabinet/client") && location.includes("/finance")))
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-financements">
            <Landmark className="h-5 w-5" />
            Financements &amp; Dettes
          </Link>

          <Link href="/dsf" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            (location.startsWith("/dsf") || (location.startsWith("/cabinet/client") && location.includes("/dsf")))
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-dsf">
            <FileSpreadsheet className="h-5 w-5" />
            Déclaration DSF
          </Link>

          <Link href="/paie" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            (location.startsWith("/paie") || (location.startsWith("/cabinet/client") && location.includes("/paie")))
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-paie">
            <Banknote className="h-5 w-5" />
            Gestion de la Paie
          </Link>

          <Link href="/teledeclaration" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            (location.startsWith("/teledeclaration") || (location.startsWith("/cabinet/client") && location.includes("/teledeclaration")))
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-teledeclaration">
            <Receipt className="h-5 w-5" />
            Télédéclaration TVA
          </Link>

          <Link href="/scoring" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            (location.startsWith("/scoring") || (location.startsWith("/cabinet/client") && location.includes("/scoring")))
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-scoring">
            <ActivitySquare className="h-5 w-5" />
            Scoring &amp; Évaluation
          </Link>

          {/* ── Pilotage ────────────────────────────────────── */}
          {(user?.role === "expert_comptable" || user?.role === "collaborateur") && (
            <>
              <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
                Pilotage
              </p>
              <Link href="/cabinet/interne/rentabilite" className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                location.startsWith("/cabinet/interne/rentabilite")
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )} data-testid="link-rentabilite">
                <BarChart3 className="h-5 w-5" />
                Pilotage Interne
              </Link>
            </>
          )}

          {/* ── Outils ──────────────────────────────────────── */}
          <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
            Outils
          </p>

          <Link href="/cabinet/plan-comptable" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/cabinet/plan-comptable")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-plan-comptable"
            onClick={() => setSmartSearchOpen(false)}
          >
            <Sparkles className="h-5 w-5 shrink-0" />
            <span className="flex flex-col leading-tight">
              <span>Plan Comptable</span>
              <span className={cn(
                "text-[10px] font-normal leading-tight",
                location.startsWith("/cabinet/plan-comptable")
                  ? "opacity-70"
                  : "text-sidebar-foreground/50"
              )}>Recherche Intelligente IA</span>
            </span>
          </Link>

          {/* ── Administration ──────────────────────────────── */}
          <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
            Administration
          </p>

          {/* Module M31: internal cabinet chat, available to all cabinet roles */}
          <Link href="/cabinet/communication" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/cabinet/communication")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )} data-testid="link-communication">
            <MessagesSquare className="h-5 w-5" />
            Messagerie
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

          {user?.role === "expert_comptable" && (
            <Link href="/cabinet/compliance" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location.startsWith("/cabinet/compliance")
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )} data-testid="link-compliance">
              <ShieldCheck className="h-5 w-5" />
              Journal de Conformité
            </Link>
          )}

          {/* ── Paramètres cabinet ──────────────────────────── */}
          {(user?.role === "expert_comptable" || user?.role === "collaborateur" || user?.role === "stagiaire") && (
            <>
              <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
                Paramètres
              </p>
              <Link href="/cabinet/settings/payroll" className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                location.startsWith("/cabinet/settings/payroll")
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )} data-testid="link-payroll-settings">
                <SlidersHorizontal className="h-5 w-5" />
                Taux de Paie
              </Link>
              <Link href="/cabinet/settings/vat" className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                location.startsWith("/cabinet/settings/vat")
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )} data-testid="link-vat-settings">
                <Percent className="h-5 w-5" />
                Configuration TVA
              </Link>
            </>
          )}
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
          <span className="text-xs text-sidebar-foreground/60 truncate">
            {getUserRoleLabel(user)}
          </span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
              data-testid="button-logout"
              title="Déconnexion"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
              <AlertDialogDescription>
                Vous devrez vous reconnecter avec votre email et votre mot de passe pour accéder à nouveau à votre espace.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-logout">Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={logout} data-testid="button-confirm-logout">
                Se déconnecter
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-background text-foreground flex-col md:flex-row overflow-hidden">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between h-16 px-4 border-b bg-card">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight text-primary">
          <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono">
            M15
          </div>
          AUDIT
        </div>
        <div className="flex items-center gap-1">
          <HelpButton />
          <NotificationBell />
        {user?.roleCode !== 'POMPISTE' && (
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
              <div className="flex-1 overflow-y-auto py-2" ref={mobileNavScrollRef}>
                <NavItems />
              </div>
              <UserMenu />
            </SheetContent>
          </Sheet>
        )}
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground shrink-0">
        <div className="h-16 flex items-center justify-between px-6 font-bold text-xl tracking-tight text-primary-foreground border-b border-sidebar-border shrink-0">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono mr-2 text-sm shadow-sm">
              M15
            </div>
            AUDIT
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
                title="Déconnexion"
                data-testid="button-logout-top"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vous devrez vous reconnecter avec votre email et votre mot de passe pour accéder à nouveau à votre espace.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={logout}>Se déconnecter</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="flex-1 overflow-y-auto py-2" ref={desktopNavScrollRef}>
          <NavItems />
        </div>
        <UserMenu />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Bar: current user, role badge, cabinet/tenant name */}
        <header className="hidden md:flex items-center justify-between h-16 px-8 border-b bg-card shrink-0" data-testid="header-topbar">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span className="font-medium text-foreground" data-testid="text-firm-name">
              {user?.firmName ?? "Cabinet"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <HelpButton />
            <NotificationBell />
            <span className="text-sm font-medium text-foreground" data-testid="text-topbar-username">
              {user?.fullName}
            </span>
            <Badge variant="outline" className={cn("border-transparent", getRoleBadgeColor(user?.role))} data-testid="badge-topbar-role">
              {getUserRoleLabel(user)}
            </Badge>
          </div>
        </header>
        {/* Trial banner — shown to all cabinet staff during the 30-day trial */}
        {user?.firmStatus === "trial" && user.trialEndsAt && (() => {
          const daysLeft = Math.max(0, Math.ceil(
            (new Date(user.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          ))
          return (
            <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-2 text-amber-800">
                <span className="text-base">⏳</span>
                <span>
                  <strong>Période d'essai</strong> — il vous reste{" "}
                  <strong>{daysLeft} jour{daysLeft > 1 ? "s" : ""}</strong> sur votre essai gratuit de 30 jours.
                </span>
              </div>
              <a
                href="https://wa.me/2250714174082"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900"
              >
                Activer mon abonnement
              </a>
            </div>
          )
        })()}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
      {/* Session timeout warning dialog */}
      <SessionTimeoutDialog
        open={showWarning}
        secondsLeft={secondsLeft}
        onStay={stayConnected}
        onLogout={logout}
      />
      {/* M15 AI Copilot — global FAB + chat drawer, all pages */}
      <AICopilotDrawer />

      {/* Plan Comptable Smart Search — Ctrl+K command palette (cabinet staff only) */}
      {user && !isPortalRole(user.role) && !isSuperAdmin(user.role) && (
        <Dialog open={smartSearchOpen} onOpenChange={setSmartSearchOpen}>
          <DialogContent className="p-0 gap-0 max-w-xl overflow-hidden rounded-xl">
            <CabinetAccountSmartSearch
              modal
              onClose={() => setSmartSearchOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
