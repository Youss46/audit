/**
 * Console Super Admin — Gestion des Licences
 * Historique de toutes les licences d'activation SaaS avec révocation
 * et générateur de nouvelles licences.
 */

import { useState, useEffect, useCallback } from "react"
import { adminApi } from "@/lib/admin-api"
import type { LicenceAvecCabinet, CabinetAvecDetails, GenerationLicenceInput, PlanAbonnement } from "@/lib/admin-types"
import {
  LABELS_PLAN,
  LABELS_STATUT_LICENCE,
  COULEURS_PLAN,
  COULEURS_STATUT_LICENCE,
} from "@/lib/admin-types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  KeyRound, Loader2, ShieldX, Plus, X, Check, Copy, AlertCircle, Clock,
} from "lucide-react"

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  })
}
function formatFcfa(n: number) {
  return n > 0 ? new Intl.NumberFormat("fr-FR").format(n) + " FCFA" : "—"
}
function joursRestants(s: string) {
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000)
}

// ── Modal de génération ───────────────────────────────────────────────────────

function ModalNouvelleLicence({
  cabinets,
  onFermer,
  onSucces,
}: {
  cabinets: CabinetAvecDetails[]
  onFermer: () => void
  onSucces: () => void
}) {
  const [form, setForm] = useState({
    firmId: "",
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
      const resultat = await adminApi.genererLicence({
        firmId: Number(form.firmId),
        tier: form.tier,
        durationMonths: Number(form.durationMonths),
        pricePaid: Number(form.pricePaid),
        notes: form.notes || undefined,
      } as GenerationLicenceInput)
      setCleGeneree(resultat.license.licenseKey)
      onSucces()
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Erreur serveur.")
    } finally {
      setChargement(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onFermer} />
      <Card className="relative w-full max-w-md shadow-2xl z-10">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Nouvelle Licence</CardTitle>
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
              <p className="font-semibold">Licence générée avec succès !</p>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm font-bold tracking-widest text-primary break-all text-center">
                {cleGeneree}
              </div>
              <Button
                variant={copie ? "default" : "outline"}
                className="w-full gap-2"
                onClick={() => {
                  navigator.clipboard.writeText(cleGeneree).then(() => {
                    setCopie(true)
                    setTimeout(() => setCopie(false), 2000)
                  })
                }}
              >
                {copie ? <><Check className="h-4 w-4" />Copié !</> : <><Copy className="h-4 w-4" />Copier la clé</>}
              </Button>
              <button onClick={onFermer} className="text-xs text-muted-foreground hover:text-foreground">
                Fermer
              </button>
            </div>
          ) : (
            <form onSubmit={soumettre} className="space-y-4">
              {erreur && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{erreur}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Cabinet *</label>
                <select
                  required
                  value={form.firmId}
                  onChange={e => set("firmId", e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Sélectionner…</option>
                  {cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    {[1, 3, 6, 12, 24, 36].map(m => <option key={m} value={m}>{m} mois</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Prix (FCFA)</label>
                  <Input type="number" min="0" value={form.pricePaid} onChange={e => set("pricePaid", e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <Input
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Référence de paiement…"
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

export default function AdminLicences() {
  const [licences, setLicences] = useState<LicenceAvecCabinet[]>([])
  const [cabinets, setCabinets] = useState<CabinetAvecDetails[]>([])
  const [chargement, setChargement] = useState(true)
  const [revocationEnCours, setRevocationEnCours] = useState<number | null>(null)
  const [modal, setModal] = useState(false)

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      const [l, c] = await Promise.all([adminApi.listerLicences(), adminApi.listerCabinets()])
      setLicences(l)
      setCabinets(c)
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => { charger() }, [charger])

  async function revoquer(lic: LicenceAvecCabinet) {
    if (!confirm(`Révoquer la licence ${lic.licenseKey} ?`)) return
    setRevocationEnCours(lic.id)
    try {
      const maj = await adminApi.revoquerLicence(lic.id)
      setLicences(prev => prev.map(l => l.id === maj.id ? { ...l, ...maj } : l))
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur serveur.")
    } finally {
      setRevocationEnCours(null)
    }
  }

  return (
    <>
      {modal && (
        <ModalNouvelleLicence
          cabinets={cabinets.filter(c => c.status !== "suspended")}
          onFermer={() => setModal(false)}
          onSucces={() => charger()}
        />
      )}

      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Licences</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Historique de toutes les licences d'activation SaaS
            </p>
          </div>
          <Button onClick={() => setModal(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouvelle Licence
          </Button>
        </div>

        <Card>
          {chargement ? (
            <CardContent className="py-20 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </CardContent>
          ) : (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {["Clé de Licence", "Cabinet", "Plan", "Statut", "Validité", "Montant", "Actions"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {licences.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                          Aucune licence générée.
                        </td>
                      </tr>
                    ) : licences.map(lic => {
                      const jours = joursRestants(lic.endDate)
                      const enRevocation = revocationEnCours === lic.id
                      return (
                        <tr key={lic.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-bold text-primary tracking-widest whitespace-nowrap">
                              {lic.licenseKey}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {lic.firm?.name ?? `Cabinet #${lic.firmId}`}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={COULEURS_PLAN[lic.tier]}>
                              {LABELS_PLAN[lic.tier]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={COULEURS_STATUT_LICENCE[lic.status]}>
                              {LABELS_STATUT_LICENCE[lic.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <p className="whitespace-nowrap text-muted-foreground">
                              {formatDate(lic.startDate)} → {formatDate(lic.endDate)}
                            </p>
                            {lic.status === "active" && (
                              <p className={`flex items-center gap-0.5 mt-0.5 ${jours <= 7 ? "text-red-600 dark:text-red-400" : jours <= 30 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                                <Clock className="h-2.5 w-2.5" />
                                {jours > 0 ? `${jours}j restants` : "Expirée"}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatFcfa(lic.pricePaid)}
                          </td>
                          <td className="px-4 py-3">
                            {lic.status === "active" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1 text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                                disabled={enRevocation}
                                onClick={() => revoquer(lic)}
                              >
                                {enRevocation
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <><ShieldX className="h-3 w-3" />Révoquer</>}
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </>
  )
}
