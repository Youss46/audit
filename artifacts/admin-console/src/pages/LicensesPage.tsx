import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { LicenseWithFirm, FirmWithDetails, GenerateLicenseInput, SubscriptionTier } from "@/lib/types";
import {
  TIER_LABELS, LICENSE_STATUS_LABELS, TIER_COLORS, LICENSE_STATUS_COLORS,
} from "@/lib/types";
import {
  KeyRound, Loader2, ShieldX, Plus, X, Check, Copy, AlertCircle,
} from "lucide-react";

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function fmtFcfa(n: number) {
  return n > 0 ? new Intl.NumberFormat("fr-FR").format(n) + " FCFA" : "—";
}
function daysUntil(s: string) {
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

// ── Generator Modal ───────────────────────────────────────────────────────────

function GenerateModal({
  firms,
  onClose,
  onSuccess,
}: {
  firms: FirmWithDetails[];
  onClose: () => void;
  onSuccess: (key: string) => void;
}) {
  const [form, setForm] = useState({
    firmId: "",
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
      const result = await api.generateLicense({
        firmId: Number(form.firmId),
        tier: form.tier,
        durationMonths: Number(form.durationMonths),
        pricePaid: Number(form.pricePaid),
        notes: form.notes || undefined,
      } as GenerateLicenseInput);
      setGeneratedKey(result.license.licenseKey);
      onSuccess(result.license.licenseKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur serveur.");
    } finally {
      setLoading(false);
    }
  }

  function copy() {
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Nouvelle Licence</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {generatedKey ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-900/40 border border-emerald-700/50 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-foreground">Licence générée avec succès !</p>
              <div className="bg-background border border-border rounded-lg p-4">
                <p className="license-key text-primary text-center font-bold tracking-widest">{generatedKey}</p>
              </div>
              <button
                onClick={copy}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  copied
                    ? "bg-emerald-900/40 border border-emerald-700/50 text-emerald-400"
                    : "bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30"
                }`}
              >
                {copied ? <><Check className="w-4 h-4" />Copié !</> : <><Copy className="w-4 h-4" />Copier la clé</>}
              </button>
              <button onClick={onClose} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground">
                Fermer
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Cabinet *</label>
                <select
                  required
                  value={form.firmId}
                  onChange={(e) => set("firmId", e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  <option value="">Sélectionner…</option>
                  {firms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Plan *</label>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Durée *</label>
                  <select
                    value={form.durationMonths}
                    onChange={(e) => set("durationMonths", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                  >
                    {[1, 3, 6, 12, 24, 36].map((m) => (
                      <option key={m} value={m}>{m} mois</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Prix (FCFA)</label>
                  <input
                    type="number" min="0"
                    value={form.pricePaid}
                    onChange={(e) => set("pricePaid", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Référence de paiement…"
                  className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/50"
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<LicenseWithFirm[]>([]);
  const [firms, setFirms] = useState<FirmWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeLoading, setRevokeLoading] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, f] = await Promise.all([api.listLicenses(), api.listFirms()]);
      setLicenses(l);
      setFirms(f);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function revoke(lic: LicenseWithFirm) {
    if (!confirm(`Révoquer la licence ${lic.licenseKey} ?`)) return;
    setRevokeLoading(lic.id);
    try {
      const updated = await api.revokeLicense(lic.id);
      setLicenses((prev) =>
        prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setRevokeLoading(null);
    }
  }

  return (
    <>
      {showModal && (
        <GenerateModal
          firms={firms.filter((f) => f.status !== "suspended")}
          onClose={() => setShowModal(false)}
          onSuccess={() => { load(); }}
        />
      )}

      <div className="p-6 max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">Licences</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Historique de toutes les licences d'activation SaaS
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nouvelle Licence
          </button>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full admin-table text-sm">
                <thead>
                  <tr className="border-b border-border bg-background/30">
                    {["Clé de Licence", "Cabinet", "Plan", "Statut", "Validité", "Montant", "Actions"].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {licenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground text-sm">
                        Aucune licence générée.
                      </td>
                    </tr>
                  ) : (
                    licenses.map((lic) => {
                      const days = daysUntil(lic.endDate);
                      const isRevoking = revokeLoading === lic.id;
                      return (
                        <tr key={lic.id} className="transition-colors">
                          <td className="px-5 py-3">
                            <p className="license-key text-xs text-primary font-bold tracking-widest whitespace-nowrap">
                              {lic.licenseKey}
                            </p>
                          </td>
                          <td className="px-5 py-3 text-sm text-foreground">
                            {lic.firm?.name ?? `Cabinet #${lic.firmId}`}
                          </td>
                          <td className="px-5 py-3">
                            <Badge className={TIER_COLORS[lic.tier]}>{TIER_LABELS[lic.tier]}</Badge>
                          </td>
                          <td className="px-5 py-3">
                            <Badge className={LICENSE_STATUS_COLORS[lic.status]}>
                              {LICENSE_STATUS_LABELS[lic.status]}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-xs">
                            <p className="text-foreground whitespace-nowrap">
                              {fmtDate(lic.startDate)} → {fmtDate(lic.endDate)}
                            </p>
                            {lic.status === "active" && (
                              <p className={`mt-0.5 ${days <= 7 ? "text-red-400" : days <= 30 ? "text-amber-400" : "text-muted-foreground"}`}>
                                {days > 0 ? `${days}j restants` : "Expirée"}
                              </p>
                            )}
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {fmtFcfa(lic.pricePaid)}
                          </td>
                          <td className="px-5 py-3">
                            {lic.status === "active" && (
                              <button
                                onClick={() => revoke(lic)}
                                disabled={isRevoking}
                                className="px-2.5 py-1 rounded text-xs border border-red-800/50 text-red-400 hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                              >
                                {isRevoking ? (
                                  <Loader2 className="w-3 h-3 animate-spin inline" />
                                ) : (
                                  <><ShieldX className="w-3 h-3 inline -mt-0.5 mr-1" />Révoquer</>
                                )}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
