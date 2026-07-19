/**
 * Console Super Admin — Tableau de bord
 * Métriques globales de la plateforme, portfolio des cabinets,
 * générateur de licences et activité récente.
 */

import { useState, useEffect, useCallback } from "react"
import { adminApi } from "@/lib/admin-api"
import type {
  MetriquesAdmin,
  CabinetAvecDetails,
  LicenceAvecCabinet,
  GenerationLicenceInput,
  PlanAbonnement,
} from "@/lib/admin-types"
import {
  LABELS_PLAN,
  LABELS_STATUT_CABINET,
  LABELS_STATUT_LICENCE,
  COULEURS_PLAN,
  COULEURS_STATUT_CABINET,
  COULEURS_STATUT_LICENCE,
} from "@/lib/admin-types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  TrendingUp, Building2, AlertTriangle, Users, Loader2, X,
  Copy, Check, KeyRound, RefreshCw, Shield, ShieldOff, Plus, Clock,
} from "lucide-react"

// ── Formatage ─────────────────────────────────────────────────────────────────

function formatFcfa(n: number) {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA"
}
function formatDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  })
}
function joursRestants(s: string) {
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000)
}

// ── Modal de génération de licence ───────────────────────────────────────────

function ModalGenerationLicence({
  cabinets,
  firmIdInitial,
  onFermer,
  onSucces,
}: {
  cabinets: CabinetAvecDetails[]
  firmIdInitial?: number
  onFermer: () => void
  onSucces: () => void
}) {
  const [form, setForm] = useState({
    firmId: String(firmIdInitial ?? ""),
    tier: "pro" as PlanAbonnement,
    durationMonths: "12",
    pricePaid: "0",
    notes: "",
  })
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [cleGeneree, setCleGeneree] = useState<string | null>(null)
  const [copie, setCopie] = useState(false)

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function soumettre(e: React.FormEvent) {
    e.preventDefault()
    if (!form.firmId) { setErreur("Sélectionnez un cabinet."); return }
    setErreur(null)
    setChargement(true)
    try {
      const payload: GenerationLicenceInput = {
        firmId: Number(form.firmId),
        tier: form.tier,
        durationMonths: Number(form.durationMonths),
        pricePaid: Number(form.pricePaid),
        notes: form.notes || undefined,
      }
      const resultat = await adminApi.genererLicence(payload)
      setCleGeneree(resultat.license.licenseKey)
      onSucces()
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur serveur.")
    } finally {
      setChargement(false)
    }
  }

  function copierCle() {
    if (!cleGeneree) return
    navigator.clipboard.writeText(cleGeneree).then(() => {
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onFermer} />
      <Card className="relative w-full max-w-md shadow-2xl z-10">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Générer une Licence</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onFermer} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {cleGeneree ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-semibold">Licence générée avec succès !</p>
                <p className="text-sm text-muted-foreground mt-1">Transmettez cette clé au cabinet.</p>
              </div>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm font-bold tracking-widest text-primary break-all text-center">
                {cleGeneree}
              </div>
              <Button
                variant={copie ? "default" : "outline"}
                className="w-full gap-2"
                onClick={copierCle}
              >
                {copie ? <><Check className="h-4 w-4" />Copié !</> : <><Copy className="h-4 w-4" />Copier la clé</>}
              </Button>
              <button
                onClick={() => { setCleGeneree(null); setForm(f => ({ ...f, notes: "" })) }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Générer une autre licence
              </button>
            </div>
          ) : (
            <form onSubmit={soumettre} className="space-y-4">
              {erreur && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {erreur}
                </p>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Cabinet *</label>
                <select
                  value={form.firmId}
                  onChange={e => set("firmId", e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Sélectionner un cabinet…</option>
                  {cabinets.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Plan *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["basic", "pro", "enterprise"] as PlanAbonnement[]).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set("tier", t)}
                      className={`py-2 rounded-md text-xs font-semibold border transition-colors ${
                        form.tier === t
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {LABELS_PLAN[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Durée *</label>
                  <select
                    value={form.durationMonths}
                    onChange={e => set("durationMonths", e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {[1, 3, 6, 12, 24, 36].map(m => (
                      <option key={m} value={m}>{m} mois</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Prix (FCFA)</label>
                  <Input
                    type="number"
                    min="0"
                    value={form.pricePaid}
                    onChange={e => set("pricePaid", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notes (optionnel)</label>
                <Input
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Référence de paiement, bon de commande…"
                />
              </div>

              <Button type="submit" disabled={chargement} className="w-full gap-2">
                {chargement
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Génération…</>
                  : <><KeyRound className="h-4 w-4" />Générer la Licence</>}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [metriques, setMetriques] = useState<MetriquesAdmin | null>(null)
  const [cabinets, setCabinets] = useState<CabinetAvecDetails[]>([])
  const [licences, setLicences] = useState<LicenceAvecCabinet[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [modal, setModal] = useState<{ ouvert: boolean; firmId?: number }>({ ouvert: false })
  const [actionEnCours, setActionEnCours] = useState<number | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const [m, c, l] = await Promise.all([
        adminApi.obtenirMetriques(),
        adminApi.listerCabinets(),
        adminApi.listerLicences(),
      ])
      setMetriques(m)
      setCabinets(c)
      setLicences(l.slice(0, 8))
    } catch {
      setErreur("Impossible de charger les données. Vérifiez votre connexion.")
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => { charger() }, [charger])

  async function basculerStatut(cabinet: CabinetAvecDetails) {
    setActionEnCours(cabinet.id)
    try {
      const maj = cabinet.status === "suspended"
        ? await adminApi.activerCabinet(cabinet.id)
        : await adminApi.suspendreCABINET(cabinet.id)
      setCabinets(prev => prev.map(c => c.id === maj.id ? { ...c, ...maj } : c))
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur serveur.")
    } finally {
      setActionEnCours(null)
    }
  }

  if (chargement) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (erreur) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-destructive text-sm font-medium">{erreur}</p>
        <Button variant="outline" size="sm" onClick={charger}>Réessayer</Button>
      </div>
    )
  }

  return (
    <>
      {modal.ouvert && (
        <ModalGenerationLicence
          cabinets={cabinets.filter(c => c.status !== "suspended")}
          firmIdInitial={modal.firmId}
          onFermer={() => setModal({ ouvert: false })}
          onSucces={() => charger()}
        />
      )}

      <div className="space-y-6">
        {/* En-tête */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Tableau de bord</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Vue d'ensemble de la plateforme M15-AUDIT
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={charger}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={() => setModal({ ouvert: true })} className="gap-2">
              <Plus className="h-4 w-4" />
              Nouvelle Licence
            </Button>
          </div>
        </div>

        {/* Cartes métriques */}
        {metriques && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Chiffre d'Affaires",
                valeur: formatFcfa(metriques.totalRevenueFcfa),
                sous: `${metriques.totalFirms} cabinets enregistrés`,
                icone: TrendingUp,
              },
              {
                label: "Cabinets Actifs",
                valeur: metriques.activeFirms,
                sous: `${metriques.trialFirms} en essai · ${metriques.suspendedFirms} suspendu(s)`,
                icone: Building2,
              },
              {
                label: "Licences Expirant",
                valeur: metriques.expiringLicenses,
                sous: "dans les 30 prochains jours",
                icone: AlertTriangle,
              },
              {
                label: "Total PME",
                valeur: metriques.totalPme,
                sous: "dossiers clients actifs",
                icone: Users,
              },
            ].map(({ label, valeur, sous, icone: Icone }) => (
              <Card key={label}>
                <CardContent className="p-5 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icone className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold mt-0.5">{valeur}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{sous}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Tableau des cabinets */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">
                Portfolio des Cabinets ({cabinets.length})
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {["Cabinet", "Plan", "Statut", "PME", "Licence", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cabinets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">
                        Aucun cabinet enregistré.
                      </td>
                    </tr>
                  ) : cabinets.map(c => {
                    const jours = c.activeLicense ? joursRestants(c.activeLicense.endDate) : null
                    const suspendu = c.status === "suspended"
                    const enAction = actionEnCours === c.id
                    return (
                      <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <p className={`font-medium ${suspendu ? "line-through text-muted-foreground" : ""}`}>{c.name}</p>
                          {c.contactEmail && <p className="text-xs text-muted-foreground">{c.contactEmail}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={COULEURS_PLAN[c.subscriptionTier]}>
                            {LABELS_PLAN[c.subscriptionTier]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={COULEURS_STATUT_CABINET[c.status]}>
                            {LABELS_STATUT_CABINET[c.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="font-mono font-medium">{c.pmeCount}</span>
                          <span className="text-muted-foreground text-xs">/{c.maxPmeAllowed}</span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {c.activeLicense ? (
                            <>
                              <p className={`font-medium ${jours !== null && jours <= 30 ? "text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}>
                                {formatDate(c.activeLicense.endDate)}
                              </p>
                              {jours !== null && (
                                <p className="text-muted-foreground flex items-center gap-0.5 mt-0.5">
                                  <Clock className="h-2.5 w-2.5" />
                                  {jours > 0 ? `${jours}j restants` : "Expirée"}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              disabled={suspendu}
                              onClick={() => setModal({ ouvert: true, firmId: c.id })}
                            >
                              <KeyRound className="h-3 w-3" />
                              Licence
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className={`h-7 px-2 text-xs gap-1 ${
                                suspendu
                                  ? "text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950"
                                  : "text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                              }`}
                              disabled={enAction}
                              onClick={() => basculerStatut(c)}
                            >
                              {enAction ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : suspendu ? (
                                <><Shield className="h-3 w-3" />Activer</>
                              ) : (
                                <><ShieldOff className="h-3 w-3" />Suspendre</>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Activité récente des licences */}
        {licences.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Activité Récente des Licences</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {licences.map(lic => {
                  const jours = joursRestants(lic.endDate)
                  return (
                    <div key={lic.id} className="px-4 py-3 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{lic.firm?.name ?? `Cabinet #${lic.firmId}`}</p>
                          <Badge variant="outline" className={COULEURS_PLAN[lic.tier]}>{LABELS_PLAN[lic.tier]}</Badge>
                          <Badge variant="outline" className={COULEURS_STATUT_LICENCE[lic.status]}>{LABELS_STATUT_LICENCE[lic.status]}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{lic.licenseKey}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted-foreground">{formatDate(lic.startDate)} → {formatDate(lic.endDate)}</p>
                        {lic.status === "active" && (
                          <p className={`text-[11px] mt-0.5 ${jours <= 30 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {jours > 0 ? `${jours}j restants` : "Expirée"}
                          </p>
                        )}
                        {lic.pricePaid > 0 && <p className="text-[11px] text-muted-foreground">{formatFcfa(lic.pricePaid)}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
