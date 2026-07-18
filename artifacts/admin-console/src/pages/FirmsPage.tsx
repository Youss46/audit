import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { FirmWithDetails, Firm, SubscriptionTier } from "@/lib/types";
import {
  TIER_LABELS, STATUS_LABELS, TIER_COLORS, FIRM_STATUS_COLORS,
} from "@/lib/types";
import {
  Building2, Loader2, Search, Shield, ShieldOff, Edit2, X,
  Check, AlertCircle,
} from "lucide-react";

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditFirmModal({
  firm,
  onClose,
  onSave,
}: {
  firm: FirmWithDetails;
  onClose: () => void;
  onSave: (updated: Firm) => void;
}) {
  const [form, setForm] = useState({
    contactName: firm.contactName ?? "",
    contactEmail: firm.contactEmail ?? "",
    phone: firm.phone ?? "",
    subscriptionTier: firm.subscriptionTier,
    maxPmeAllowed: String(firm.maxPmeAllowed),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const updated = await api.updateFirm(firm.id, {
        contactName: form.contactName || null,
        contactEmail: form.contactEmail || null,
        phone: form.phone || null,
        subscriptionTier: form.subscriptionTier as SubscriptionTier,
        maxPmeAllowed: Number(form.maxPmeAllowed),
      } as Partial<Firm>);
      onSave(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur serveur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-card-border rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Modifier le Cabinet</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{firm.name}</p>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Nom du contact</label>
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => set("contactName", e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                placeholder="Responsable cabinet"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email de contact</label>
              <input
                type="email"
                value={form.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                placeholder="contact@cabinet.ci"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Téléphone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                placeholder="+225 00 00 00 00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Plan</label>
              <select
                value={form.subscriptionTier}
                onChange={(e) => set("subscriptionTier", e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              >
                <option value="basic">Basique</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Entreprise</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Max PME</label>
              <input
                type="number"
                min="1"
                max="999"
                value={form.maxPmeAllowed}
                onChange={(e) => set("maxPmeAllowed", e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-secondary transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FirmsPage() {
  const [firms, setFirms] = useState<FirmWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [editFirm, setEditFirm] = useState<FirmWithDetails | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFirms(await api.listFirms());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = firms.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    (f.contactEmail ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function toggleStatus(firm: FirmWithDetails) {
    setActionLoading(firm.id);
    try {
      const updated = firm.status === "suspended"
        ? await api.activateFirm(firm.id)
        : await api.suspendFirm(firm.id);
      setFirms((prev) =>
        prev.map((f) => (f.id === updated.id ? { ...f, ...updated } : f))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <>
      {editFirm && (
        <EditFirmModal
          firm={editFirm}
          onClose={() => setEditFirm(null)}
          onSave={(updated) => {
            setFirms((prev) =>
              prev.map((f) => (f.id === updated.id ? { ...f, ...updated } : f))
            );
            setEditFirm(null);
          }}
        />
      )}

      <div className="p-6 max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">Cabinets</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gestion du portefeuille des cabinets comptables
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un cabinet…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50"
          />
        </div>

        {/* Table */}
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
                    {["Cabinet", "Plan", "Statut", "PME", "Contact", "Inscrit le", "Actions"].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground text-sm">
                        {search ? "Aucun cabinet ne correspond à votre recherche." : "Aucun cabinet enregistré."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((f) => {
                      const isSuspended = f.status === "suspended";
                      const isActioning = actionLoading === f.id;
                      return (
                        <tr key={f.id} className="transition-colors">
                          <td className="px-5 py-3">
                            <p className={`font-semibold ${isSuspended ? "text-muted-foreground line-through" : "text-foreground"}`}>
                              {f.name}
                            </p>
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
                          <td className="px-5 py-3 text-sm">
                            <span className="font-mono text-foreground">{f.pmeCount}</span>
                            <span className="text-muted-foreground text-xs">/{f.maxPmeAllowed}</span>
                          </td>
                          <td className="px-5 py-3">
                            <p className="text-xs text-foreground">{f.contactName ?? "—"}</p>
                            <p className="text-[11px] text-muted-foreground">{f.contactEmail ?? ""}</p>
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {fmtDate(f.createdAt)}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setEditFirm(f)}
                                className="px-2.5 py-1 rounded text-xs border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                              >
                                <Edit2 className="w-3 h-3 inline -mt-0.5 mr-1" />
                                Modifier
                              </button>
                              <button
                                onClick={() => toggleStatus(f)}
                                disabled={isActioning}
                                className={`px-2.5 py-1 rounded text-xs border transition-colors disabled:opacity-50 ${
                                  isSuspended
                                    ? "border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/20"
                                    : "border-red-800/50 text-red-400 hover:bg-red-900/20"
                                }`}
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
          )}
        </div>
      </div>
    </>
  );
}
