import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { api, setToken } from "@/lib/api";
import { useAuth } from "@/App";
import { Shield, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const { setUser, user } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Redirect if already logged in
  if (user?.role === "super_admin") {
    navigate("/");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user: u } = await api.login(email.trim(), password);
      setToken(token);
      localStorage.setItem("m15_admin_user", JSON.stringify(u));
      setUser(u);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion.");
      setPassword("");
      emailRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(238 75% 65%) 1px, transparent 1px), linear-gradient(to right, hsl(238 75% 65%) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/20 border border-primary/30 mb-4 glow-indigo">
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            M15-AUDIT
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Console Super Administrateur
          </p>
        </div>

        {/* Card */}
        <div className="bg-card border border-card-border rounded-xl p-6 shadow-2xl">
          <h2 className="text-sm font-semibold text-foreground mb-5 text-center">
            Connexion sécurisée
          </h2>

          {error && (
            <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Adresse e-mail
              </label>
              <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition"
                placeholder="admin@m15-audit.ci"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 pr-10 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPwd ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connexion…
                </>
              ) : (
                "Se connecter"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4 opacity-60">
          Accès restreint — Administrateurs autorisés uniquement
        </p>
      </div>
    </div>
  );
}
