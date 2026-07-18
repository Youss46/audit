import { Link, useLocation } from "wouter";
import { useAuth } from "@/App";
import {
  LayoutDashboard,
  Building2,
  Key,
  LogOut,
  Shield,
  ChevronRight,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/", label: "Tableau de Bord", icon: LayoutDashboard },
  { href: "/firms", label: "Cabinets", icon: Building2 },
  { href: "/licenses", label: "Licences", icon: Key },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-60 flex-shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
            <Shield className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xs font-bold text-foreground tracking-widest uppercase leading-none">
              M15-AUDIT
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Super Admin
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto admin-scrollbar">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link key={href} href={href}>
                <a
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary/20 text-primary border border-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-accent-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                  {active && (
                    <ChevronRight className="w-3 h-3 ml-auto opacity-60" />
                  )}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-sidebar-border p-4">
          <div className="mb-3">
            <p className="text-xs font-semibold text-foreground truncate">
              {user?.fullName}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {user?.email}
            </p>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto admin-scrollbar">
        {children}
      </main>
    </div>
  );
}
