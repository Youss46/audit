import { createContext, useContext, useEffect, useState } from "react";
import { Route, Switch, Redirect, useLocation } from "wouter";
import { Router as WouterRouter } from "wouter";
import { getToken, clearToken } from "@/lib/api";
import type { AdminUser } from "@/lib/types";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import FirmsPage from "@/pages/FirmsPage";
import LicensesPage from "@/pages/LicensesPage";
import Layout from "@/components/Layout";

// ── Auth Context ─────────────────────────────────────────────────────────────

interface AuthContextType {
  user: AdminUser | null;
  setUser: (user: AdminUser | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ── Auth Guard ────────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();

  if (!user) {
    return <Redirect to="/login" />;
  }
  if (user.role !== "super_admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive font-semibold">Accès refusé.</p>
          <p className="text-muted-foreground text-sm mt-1">
            Ce portail est réservé aux administrateurs système.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

// ── Router ────────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        <RequireAuth>
          <Layout>
            <DashboardPage />
          </Layout>
        </RequireAuth>
      </Route>
      <Route path="/firms">
        <RequireAuth>
          <Layout>
            <FirmsPage />
          </Layout>
        </RequireAuth>
      </Route>
      <Route path="/licenses">
        <RequireAuth>
          <Layout>
            <LicensesPage />
          </Layout>
        </RequireAuth>
      </Route>
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(() => {
    // Restore session from localStorage on mount
    const token = getToken();
    const stored = localStorage.getItem("m15_admin_user");
    if (token && stored) {
      try {
        return JSON.parse(stored) as AdminUser;
      } catch {
        return null;
      }
    }
    return null;
  });

  const logout = () => {
    clearToken();
    localStorage.removeItem("m15_admin_user");
    setUser(null);
  };

  // Force dark class on <html> — admin console is always dark.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <WouterRouter base={base}>
        <Router />
      </WouterRouter>
    </AuthContext.Provider>
  );
}
