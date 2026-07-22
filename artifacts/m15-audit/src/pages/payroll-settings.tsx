import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import {
  useListPayrollSettings,
  getListPayrollSettingsQueryKey,
  useUpdatePayrollSetting,
} from "@workspace/api-client-react"
import type { PayrollSetting } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  Settings2,
  Lock,
  Pencil,
  Loader2,
  Info,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// Module M20-Settings — Configuration des Taux de Paie
// Route: /cabinet/settings/payroll
// Access: all cabinet roles (read); expert_comptable + collaborateur (write)
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<string, { label: string; description: string; color: string }> = {
  CNPS: {
    label: "CNPS",
    description: "Caisse Nationale de Prévoyance Sociale",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  ITS: {
    label: "ITS",
    description: "Impôt sur Traitements et Salaires",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  FDFP: {
    label: "FDFP",
    description: "Fonds de Développement de la Formation Professionnelle",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
  TRANSPORT: {
    label: "Transport",
    description: "Prime de Transport — Exonération",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
}

const RULE_TOOLTIPS: Record<string, string> = {
  cnps_employee_rate: "Cotisation retraite retenue sur le salaire brut du salarié (plafonnée au plafond CNPS mensuel).",
  cnps_employer_retraite_rate: "Part patronale du régime de retraite CNPS, calculée sur le salaire brut plafonné.",
  cnps_employer_pf_rate: "Cotisation patronale pour les prestations familiales (allocations et congés maternité).",
  cnps_employer_at_rate_default: "Taux par défaut pour le risque accidents du travail (peut varier entre 2 % et 5 % selon le secteur d'activité). Ajustable par employé.",
  cnps_ceiling_monthly: "Plafond mensuel d'assiette CNPS (en FCFA). Les salaires supérieurs sont cotisés jusqu'à ce plafond uniquement.",
  its_taxable_base_abattement: "Abattement forfaitaire légal appliqué à la base imposable ITS. Non modifiable — fixé par le CGI.",
  taxe_apprentissage_rate: "Contribution patronale au fonds d'apprentissage, assise sur la masse salariale brute imposable.",
  taxe_formation_continue_rate: "Contribution patronale à la formation professionnelle continue, assise sur la masse salariale brute imposable.",
  transport_allowance_exemption: "Montant mensuel d'exonération de la prime de transport (en FCFA). L'excédent est réintégré dans la base imposable.",
}

function formatValue(setting: PayrollSetting): string {
  if (setting.ratePercentage !== null && setting.ratePercentage !== undefined) {
    return `${(setting.ratePercentage * 100).toFixed(3).replace(/\.?0+$/, "")} %`
  }
  if (setting.ceilingAmount !== null && setting.ceilingAmount !== undefined) {
    return `${setting.ceilingAmount.toLocaleString("fr-FR")} FCFA`
  }
  return "—"
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return ""
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
}

type CanEdit = "yes" | "no_role" | "no_editable"

interface EditState {
  setting: PayrollSetting
  rateInput: string   // displayed as percentage string e.g. "7.7"
  ceilingInput: string
  error: string | null
}

function useCanEdit(role: string | undefined): CanEdit {
  if (role === "expert_comptable" || role === "collaborateur") return "yes"
  return "no_role"
}

// Group settings by category in canonical order
function groupSettings(settings: PayrollSetting[]) {
  const order = ["CNPS", "ITS", "FDFP", "TRANSPORT"]
  const map: Record<string, PayrollSetting[]> = {}
  for (const s of settings) {
    if (!map[s.category]) map[s.category] = []
    map[s.category].push(s)
  }
  return order.filter((c) => map[c]).map((c) => ({ category: c, rows: map[c] }))
}

export default function PayrollSettingsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const canEdit = useCanEdit(user?.role)

  const [editState, setEditState] = useState<EditState | null>(null)

  const { data: settings, isLoading } = useListPayrollSettings({
    query: { queryKey: getListPayrollSettingsQueryKey() },
  })

  const updateMutation = useUpdatePayrollSetting({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Paramètre mis à jour",
          description: "Le taux a été enregistré et sera appliqué dès le prochain calcul de paie.",
        })
        setEditState(null)
        queryClient.invalidateQueries({ queryKey: getListPayrollSettingsQueryKey() })
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Une erreur s'est produite."
        setEditState((s) => (s ? { ...s, error: msg } : null))
      },
    },
  })

  // ── Most-recently-modified entry for the audit log footer
  const lastModified = settings
    ?.filter((s) => s.updatedByName)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]

  function openEdit(setting: PayrollSetting) {
    if (!setting.isEditable) return
    if (canEdit !== "yes") return
    setEditState({
      setting,
      rateInput:
        setting.ratePercentage !== null && setting.ratePercentage !== undefined
          ? (setting.ratePercentage * 100).toFixed(4).replace(/\.?0+$/, "")
          : "",
      ceilingInput:
        setting.ceilingAmount !== null && setting.ceilingAmount !== undefined
          ? String(setting.ceilingAmount)
          : "",
      error: null,
    })
  }

  function handleSave() {
    if (!editState) return
    const s = editState.setting

    const isRateRow = s.ratePercentage !== null && s.ratePercentage !== undefined
    const isCeilingRow = s.ceilingAmount !== null && s.ceilingAmount !== undefined

    let ratePercentage: number | undefined
    let ceilingAmount: number | undefined

    if (isRateRow) {
      const pct = parseFloat(editState.rateInput.replace(",", "."))
      if (isNaN(pct) || pct < 0 || pct > 100) {
        setEditState((e) => e && { ...e, error: "Le taux doit être compris entre 0 et 100 %." })
        return
      }
      ratePercentage = pct / 100
    }

    if (isCeilingRow) {
      const amt = parseInt(editState.ceilingInput.replace(/\s/g, ""), 10)
      if (isNaN(amt) || amt < 0) {
        setEditState((e) => e && { ...e, error: "Le plafond doit être un entier positif (en FCFA)." })
        return
      }
      ceilingAmount = amt
    }

    updateMutation.mutate({
      id: s.id,
      data: {
        ...(ratePercentage !== undefined ? { ratePercentage } : {}),
        ...(ceilingAmount !== undefined ? { ceilingAmount } : {}),
      },
    })
  }

  const grouped = groupSettings(settings ?? [])
  const isRateRow = editState
    ? editState.setting.ratePercentage !== null && editState.setting.ratePercentage !== undefined
    : false

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Settings2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuration des Taux de Paie</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Taux de cotisations sociales et fiscales appliqués lors du calcul des bulletins de paie
          </p>
        </div>
      </div>

      {/* ── Role notice for read-only users ── */}
      {canEdit === "no_role" && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Vous consultez ces paramètres en <strong>lecture seule</strong>. Seuls les rôles{" "}
            <em>Expert-Comptable</em> et <em>Collaborateur</em> peuvent modifier les taux.
          </span>
        </div>
      )}

      {/* ── Settings tables grouped by category ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Chargement des paramètres…
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ category, rows }) => {
            const meta = CATEGORY_META[category] ?? { label: category, description: "", color: "" }
            return (
              <Card key={category} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={cn("border-transparent font-semibold", meta.color)}>
                      {meta.label}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{meta.description}</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6 w-[55%]">Paramètre</TableHead>
                        <TableHead className="text-right w-[25%]">Valeur en vigueur</TableHead>
                        <TableHead className="pr-6 text-right w-[20%]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((setting) => {
                        const tooltip = RULE_TOOLTIPS[setting.ruleKey]
                        return (
                          <TableRow key={setting.id} className={!setting.isEditable ? "opacity-70" : ""}>
                            <TableCell className="pl-6">
                              <div className="flex items-center gap-2">
                                {!setting.isEditable && (
                                  <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                )}
                                <span className="font-medium text-sm">{setting.ruleName}</span>
                                {tooltip && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs text-xs">
                                      {tooltip}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              {setting.updatedByName && (
                                <p className="text-xs text-muted-foreground mt-0.5 pl-5">
                                  Modifié par <strong>{setting.updatedByName}</strong> le {formatDate(setting.updatedAt)}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-sm font-semibold">
                              {formatValue(setting)}
                            </TableCell>
                            <TableCell className="pr-6 text-right">
                              {setting.isEditable ? (
                                canEdit === "yes" ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => openEdit(setting)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Modifier
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">Lecture seule</span>
                                )
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Fixé par la loi</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Global audit trail ── */}
      {lastModified && (
        <p className="text-xs text-muted-foreground text-center py-2 border-t">
          Dernière modification par <strong>{lastModified.updatedByName}</strong> le{" "}
          {formatDate(lastModified.updatedAt)} — {lastModified.ruleName}
        </p>
      )}

      {/* ── Edit dialog ── */}
      <Dialog open={!!editState} onOpenChange={(open) => !open && setEditState(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier le paramètre</DialogTitle>
            <DialogDescription>
              {editState?.setting.ruleName}
            </DialogDescription>
          </DialogHeader>

          {editState && (
            <div className="space-y-4 pt-2">
              {/* Current value badge */}
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-4 py-3">
                <span className="text-sm text-muted-foreground">Valeur actuelle</span>
                <span className="font-mono font-semibold text-sm">{formatValue(editState.setting)}</span>
              </div>

              {/* Input */}
              {isRateRow ? (
                <div className="space-y-2">
                  <Label htmlFor="rate-input">
                    Nouveau taux <span className="text-muted-foreground">(en %)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="rate-input"
                      type="number"
                      step="0.001"
                      min="0"
                      max="100"
                      value={editState.rateInput}
                      onChange={(e) =>
                        setEditState((s) => s && { ...s, rateInput: e.target.value, error: null })
                      }
                      className="pr-8"
                      placeholder="ex : 7.700"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      %
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saisissez le taux en pourcentage (ex&nbsp;: 7,7 pour 7,7&nbsp;%). Il sera
                    converti et stocké en fraction décimale (0,077).
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="ceiling-input">
                    Nouveau plafond <span className="text-muted-foreground">(en FCFA)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="ceiling-input"
                      type="number"
                      step="1000"
                      min="0"
                      value={editState.ceilingInput}
                      onChange={(e) =>
                        setEditState((s) => s && { ...s, ceilingInput: e.target.value, error: null })
                      }
                      className="pr-16"
                      placeholder="ex : 3 375 000"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                      FCFA
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saisissez le nouveau plafond en francs CFA (entier, sans décimales).
                  </p>
                </div>
              )}

              {/* Validation notice */}
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                <strong>Attention :</strong> cette modification s'appliquera immédiatement à tous les
                prochains calculs de bulletins. Les bulletins déjà comptabilisés ne sont pas affectés.
              </div>

              {/* Error */}
              {editState.error && (
                <p className="text-sm text-destructive">{editState.error}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditState(null)} disabled={updateMutation.isPending}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
