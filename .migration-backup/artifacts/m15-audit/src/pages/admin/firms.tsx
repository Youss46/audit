/**
 * Console Super Admin — Gestion des Cabinets
 * Liste complète avec recherche, modification des paramètres et
 * basculement du statut (activation / suspension).
 */

import { useState, useEffect, useCallback } from "react"
import { adminApi } from "@/lib/admin-api"
import type { Cabinet, CabinetAvecDetails, PlanAbonnement } from "@/lib/admin-types"
import {
  LABELS_PLAN,
  LABELS_STATUT_CABINET,
  COULEURS_PLAN,
  COULEURS_STATUT_CABINET,
} from "@/lib/admin-types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Building2, Loader2, Search, Shield, ShieldOff, Edit2, X, Check, AlertCircle,
} from "lucide-react"

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  })
}

// ── Modal de modification ─────────────────────────────────────────────────────

function ModalModificationCabinet({
  cabinet,
  onFermer,
  onSauvegarder,
}: {
  cabinet: CabinetAvecDetails
  onFermer: () => void
  onSauvegarder: (maj: Cabinet) => void
}) {
  const [form, setForm] = useState({
    contactName: cabinet.contactName ?? "",
    contactEmail: cabinet.contactEmail ?? "",
    phone: cabinet.phone ?? "",
    subscriptionTier: cabinet.subscriptionTier as PlanAbonnement,
    maxPmeAllowed: String(cabinet.maxPmeAllowed),
  })
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function soumettre(e: React.FormEvent) {
    e.preventDefault()
    setErreur(null)
    setChargement(true)
    try {
      const maj = await adminApi.modifierCabinet(cabinet.id, {
        contactName: form.contactName || null,
        contactEmail: form.contactEmail || null,
        phone: form.phone || null,
        subscriptionTier: form.subscriptionTier,
        maxPmeAllowed: Number(form.maxPmeAllowed),
      })
      onSauvegarder(maj)
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
            <Edit2 className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Modifier le Cabinet</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onFermer} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={soumettre} className="space-y-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{cabinet.name}</p>

            {erreur && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{erreur}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nom du responsable</label>
              <Input
                value={form.contactName}
                onChange={e => set("contactName", e.target.value)}
                placeholder="Responsable du cabinet"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Email de contact</label>
                <Input
                  type="email"
                  value={form.contactEmail}
                  onChange={e => set("contactEmail", e.target.value)}
                  placeholder="contact@cabinet.ci"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Téléphone</label>
                <Input
                  value={form.phone}
                  onChange={e => set("phone", e.target.value)}
                  placeholder="+225 00 00 00 00"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Plan d'abonnement</label>
                <select
                  value={form.subscriptionTier}
                  onChange={e => set("subscriptionTier", e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="basic">Basique</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Entreprise</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Limite PME</label>
                <Input
                  type="number"
                  min="1"
                  max="999"
                  value={form.maxPmeAllowed}
                  onChange={e => set("maxPmeAllowed", e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onFermer}>
                Annuler
              </Button>
              <Button type="submit" disabled={chargement} className="flex-1 gap-2">
                {chargement
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Enregistrement…</>
                  : <><Check className="h-4 w-4" />Enregistrer</>}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AdminCabinets() {
  const [cabinets, setCabinets] = useState<CabinetAvecDetails[]>([])
  const [chargement, setChargement] = useState(true)
  const [recherche, setRecherche] = useState("")
  const [actionEnCours, setActionEnCours] = useState<number | null>(null)
  const [cabinetEnModif, setCabinetEnModif] = useState<CabinetAvecDetails | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      setCabinets(await adminApi.listerCabinets())
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => { charger() }, [charger])

  const filtres = cabinets.filter(c =>
    c.name.toLowerCase().includes(recherche.toLowerCase()) ||
    (c.contactEmail ?? "").toLowerCase().includes(recherche.toLowerCase())
  )

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

  return (
    <>
      {cabinetEnModif && (
        <ModalModificationCabinet
          cabinet={cabinetEnModif}
          onFermer={() => setCabinetEnModif(null)}
          onSauvegarder={maj => {
            setCabinets(prev => prev.map(c => c.id === maj.id ? { ...c, ...maj } : c))
            setCabinetEnModif(null)
          }}
        />
      )}

      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold">Cabinets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gestion du portefeuille des cabinets comptables
          </p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={e => setRecherche(e.target.value)}
            placeholder="Rechercher un cabinet…"
            className="pl-9"
          />
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
                      {["Cabinet", "Plan", "Statut", "PME", "Contact", "Inscrit le", "Actions"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtres.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                          {recherche
                            ? "Aucun cabinet ne correspond à votre recherche."
                            : "Aucun cabinet enregistré."}
                        </td>
                      </tr>
                    ) : filtres.map(c => {
                      const suspendu = c.status === "suspended"
                      const enAction = actionEnCours === c.id
                      return (
                        <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <p className={`font-semibold ${suspendu ? "line-through text-muted-foreground" : ""}`}>
                              {c.name}
                            </p>
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
                          <td className="px-4 py-3">
                            <p className="text-xs">{c.contactName ?? "—"}</p>
                            <p className="text-[11px] text-muted-foreground">{c.contactEmail ?? ""}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(c.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => setCabinetEnModif(c)}
                              >
                                <Edit2 className="h-3 w-3" />
                                Modifier
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
          )}
        </Card>
      </div>
    </>
  )
}
