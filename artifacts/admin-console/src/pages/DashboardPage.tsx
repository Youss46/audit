import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type {
  AdminMetrics,
  FirmWithDetails,
  LicenseWithFirm,
  GenerateLicenseInput,
  SubscriptionTier,
} from "@/lib/types";
import {
  TIER_LABELS,
  STATUS_LABELS,
  LICENSE_STATUS_LABELS,
  TIER_COLORS,
  FIRM_STATUS_COLORS,
  LICENSE_STATUS_COLORS,
} from "@/lib/types";
import {
  TrendingUp,
  Building2,
  AlertTriangle,
  Users,
  Loader2,
  X,
  Copy,
  Check,
  KeyRound,
  RefreshCw,
  Shield,
  ShieldOff,
  Plus,
  Clock,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtFcfa(n: number) {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function daysUntil(s: string) {
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
}

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; accent: string;
}) {
  return (
    <div className={`bg-card border border-card-border rounded-xl p-5 flex items-start gap-4 ${accent}`}>
      <div className="w-10 h-10 rounded-lg bg-card flex items-center justify-center flex-shrink-0 border border-border">
        <Icon className="w-5 h-5 text-foreground opacity-70" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

// ── License Generator Modal ───────────────────────────────────────────────────

interface ModalProps {
  firms: FirmWithDetails[];
  initialFirmId?: number;
  onClose: () => void;
  onSuccess: (firmId: number) => void;
}

function LicenseModal({ firms, initialFirmId, onClose, onSuccess }: ModalProps) {
  const [form, setForm] = useState({
    firmId: String(initialFirmId ?? ""),
    tier: "pro" as SubscriptionTier,
    durationMonths: "12",
    pricePaid: "0",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firmId) { setError("Sélectionnez un cabinet."); return; }
    setError(null);
    setLoading(true);
    try {
      const payload: GenerateLicenseInput = {
        firmId: Number(form.firmId),
        tier: form.tier,
        durationMonths: Number(form.durationMonths),
        pricePaid: Number(form.pricePaid),
        notes: form.notes || undefined,
      };
      const result = await api.generateLicense(payload);
      setGeneratedKey(result.license.licenseKey);
      onSuccess(Number(form.firmId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur serveur.");
    } finally {
      setLoading(false);
    }
  }

  function copyKey() {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-card-border rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              Générer une Licence
            </h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {/* Success state */}
          {generatedKey ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-900/40 border border-emerald-700/50 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Licence générée !</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Transmettez cette clé au cabinet.
                </p>
              </div>
              <div className="bg-background border border-border rounded-lg p-4">
                <p className="license-key text-primary text-center font-bold tracking-widest">
                  {generatedKey}
                </p>
              </div>
              <button
                onClick={copyKey}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  copied
                    ? "bg-emerald-900/40 border border-emerald-700/50 text-emerald-400"
                    : "bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30"
                }`}
              >
                {copied ? <><Check className="w-4 h-4" />Copié !</> : <><Copy className="w-4 h-4" />Copier la clé</>}
              </button>
              <button
                onClick={() => { setGeneratedKey(null); setForm(f => ({ ...f, notes: "" })); }}
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Générer une autre licence
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {/* Cabinet */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Cabinet *
                </label>
                <select
                  value={form.firmId}
                  onChange={(e) => set("firmId", e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50"
                >
                  <option value="">Sélectionner un cabinet…</option>
                  {firms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tier */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Plan *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["basic", "pro", "enterprise"] as SubscriptionTier[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set("tier", t)}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        form.tier === t
                          ? "bg-primary/20 border-primary/50 text-primary"
                          : "bg-input border-border text-muted-foreground hover:border-border/80"
                      }`}
                    >
                      {TIER_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration + Price (side by side) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Durée (mois) *
                  </label>
                  <select
                    value={form.durationMonths}
                    onChange={(e) => set("durationMonths", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50"
                  >
                    <option value="1">1 mois</option>
                    <option value="3">3 mois</option>
                    <option value="6">6 mois</option>
                    <option value="12">12 mois</option>
                    <option value="24">24 mois</option>
                    <option value="36">36 mois</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Prix (FCFA)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.pricePaid}
                    onChange={(e) => set("pricePaid", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Notes (optionnel)
                </label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Référence de paiement, bon de commande…"
                  className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors mt-2"
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Génération…</> : <><KeyRound className="w-4 h-4" />Générer la Licence</>}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [firms, setFirms] = useState<FirmWithDetails[]>([]);
  const [licenses, setLicenses] = useState<LicenseWithFirm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; firmId?: number }>({ open: false });
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, f, l] = await Promise.all([
        api.getMetrics(),
        api.listFirms(),
        api.listLicenses(),
      ]);
      setMetrics(m);
      setFirms(f);
      setLicenses(l.slice(0, 10));
    } catch {
      setError("Impossible de charger les données. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleFirmStatus(firm: FirmWithDetails) {
    setActionLoading(firm.id);
    try {
      const updated = firm.status === "suspended"
        ? await api.activateFirm(firm.id)
        : await api.suspendFirm(firm.id);
      setFirms((prev) =>
        prev.map((f) => (f.id === updated.id ? { ...f, ...updated } : f))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur serveur.");
    } finally {
      setActionLoading(null);
    }
  }

  function onLicenseGenerated(firmId: number) {
    // Refresh data after license generation
    load();
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive text-sm font-medium">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); load(); }}
            className="mt-3 text-xs text-primary hover:underline"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {modal.open && (
        <LicenseModal
          firms={firms.filter((f) => f.status !== "suspended")}
          initialFirmId={modal.firmId}
          onClose={() => setModal({ open: false })}
          onSuccess={(id) => { onLicenseGenerated(id); }}
        />
      )}

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">Tableau de Bord</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Vue d'ensemble de la plateforme M15-AUDIT
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLoading(true); load(); }}
              className="p-2 rounded-lg border border-border hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setModal({ open: true })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nouvelle Licence
            </button>
          </div>
        </div>

        {/* Metrics */}
        {metrics && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Chiffre d'Affaires"
              value={fmtFcfa(metrics.totalRevenueFcfa)}
              sub={`${metrics.totalFirms} cabinets enregistrés`}
              icon={TrendingUp}
              accent="glow-indigo"
            />
            <MetricCard
              label="Cabinets Actifs"
              value={metrics.activeFirms}
              sub={`${metrics.trialFirms} en essai · ${metrics.suspendedFirms} suspendu${metrics.suspendedFirms !== 1 ? "s" : ""}`}
              icon={Building2}
              accent="glow-emerald"
            />
            <MetricCard
              label="Licences Expirant"
              value={metrics.expiringLicenses}
              sub="dans les 30 prochains jours"
              icon={AlertTriangle}
              accent={metrics.expiringLicenses > 0 ? "glow-red border-amber-900/30" : ""}
            />
            <MetricCard
              label="Total PME"
              value={metrics.totalPme}
              sub="dossiers clients actifs"
              icon={Users}
              accent=""
            />
          </div>
        )}

        {/* Firms table */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Portfolio des Cabinets
              </h2>
              <span className="text-xs text-muted-foreground ml-1">
                ({firms.length})
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full admin-table text-sm">
              <thead>
                <tr className="border-b border-border bg-background/30">
                  {["Cabinet", "Plan", "Statut", "PME", "Licence", "Actions"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {firms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground text-sm">
                      Aucun cabinet enregistré.
                    </td>
                  </tr>
                ) : (
                  firms.map((f) => {
                    const days = f.activeLicense ? daysUntil(f.activeLicense.endDate) : null;
                    const isSuspended = f.status === "suspended";
                    const isActioning = actionLoading === f.id;
                    return (
                      <tr key={f.id} className="transition-colors">
                        <td className="px-5 py-3">
                          <div>
                            <p className={`font-medium ${isSuspended ? "text-muted-foreground line-through" : "text-foreground"}`}>
                              {f.name}
                            </p>
                            {f.contactEmail && (
                              <p className="text-xs text-muted-foreground mt-0.5">{f.contactEmail}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <Badge className={TIER_COLORS[f.subscriptionTier]}>
                            {TIER_LABELS[f.subscriptionTier]}
                          </Badge>
                        </td>
                        <td className="px-5 py-3">
                          <Badge className={FIRM_STATUS_COLORS[f.status]}>
                            {STATUS_LABELS[f.status]}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-sm text-foreground">
                          <span className="font-mono">{f.pmeCount}</span>
                          <span className="text-muted-foreground text-xs">/{f.maxPmeAllowed}</span>
                        </td>
                        <td className="px-5 py-3">
                          {f.activeLicense ? (
                            <div>
                              <p className={`text-xs font-medium ${days !== null && days <= 30 ? "text-amber-400" : days !== null && days <= 7 ? "text-red-400" : "text-emerald-400"}`}>
                                {fmtDate(f.activeLicense.endDate)}
                              </p>
                              {days !== null && (
                                <p className="text-[11px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  {days > 0 ? `${days}j restants` : "Expirée"}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setModal({ open: true, firmId: f.id })}
                              disabled={isSuspended}
                              className="px-2.5 py-1 rounded text-xs border border-border text-muted-foreground hover:text-primary hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <KeyRound className="w-3 h-3 inline -mt-0.5 mr-1" />
                              Licence
                            </button>
                            <button
                              onClick={() => toggleFirmStatus(f)}
                              disabled={isActioning}
                              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                                isSuspended
                                  ? "border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/20"
                                  : "border-red-800/50 text-red-400 hover:bg-red-900/20"
                              } disabled:opacity-50`}
                            >
                              {isActioning ? (
                                <Loader2 className="w-3 h-3 animate-spin inline" />
                              ) : isSuspended ? (
                                <><Shield className="w-3 h-3 inline -mt-0.5 mr-1" />Activer</>
                              ) : (
                                <><ShieldOff className="w-3 h-3 inline -mt-0.5 mr-1" />Suspendre</>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent licenses */}
        {licenses.length > 0 && (
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Activité Récente des Licences
              </h2>
            </div>
            <div className="divide-y divide-border">
              {licenses.map((lic) => {
                const days = daysUntil(lic.endDate);
                return (
                  <div key={lic.id} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">
                          {lic.firm?.name ?? `Cabinet #${lic.firmId}`}
                        </p>
                        <Badge className={TIER_COLORS[lic.tier]}>{TIER_LABELS[lic.tier]}</Badge>
                        <Badge className={LICENSE_STATUS_COLORS[lic.status]}>
                          {LICENSE_STATUS_LABELS[lic.status]}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                        {lic.licenseKey}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-foreground">
                        {fmtDate(lic.startDate)} → {fmtDate(lic.endDate)}
                      </p>
                      {lic.status === "active" && (
                        <p className={`text-[11px] mt-0.5 ${days <= 30 ? "text-amber-400" : "text-muted-foreground"}`}>
                          {days > 0 ? `${days}j restants` : "Expirée"}
                        </p>
                      )}
                      {lic.pricePaid > 0 && (
                        <p className="text-[11px] text-muted-foreground">{fmtFcfa(lic.pricePaid)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
