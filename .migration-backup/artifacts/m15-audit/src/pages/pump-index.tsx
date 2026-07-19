import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "wouter"
import {
  useGetLastPumpIndex,
  getGetLastPumpIndexQueryKey,
  useCreatePumpShift,
  useGetMyPumpAssignments,
  getGetMyPumpAssignmentsQueryKey,
  FuelType,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Fuel, Gauge, Lock, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function getFuelTypeLabel(fuel: FuelType | "") {
  return fuel === "super" ? "Super" : fuel === "gasoil" ? "Gasoil" : ""
}

// Module P7 (Un Pompiste = Un Shift): "Relevé d'index de pompe" -- the
// pompiste's first action of a shift. Pump selection is restricted to the
// pumps assigned to this user for today by the PME owner; the server also
// enforces this restriction when the shift is saved.
// Multi-station (P8): if the authenticated user has a stationId, a station
// badge is shown so they know which site they are operating on.
export default function PumpIndex() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [, navigate] = useLocation()
  const clientId = user?.clientId ?? 0
  const stationName = (user as any)?.stationName as string | null | undefined

  // The selected assignment ID drives both pumpLabel and fuelType.
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null)
  const [indexEnd, setIndexEnd] = useState("")

  // ── Fetch today's assigned pumps for this pompiste ──────────────────────
  const { data: assignments = [], isLoading: isLoadingAssignments } = useGetMyPumpAssignments(
    { clientId },
    {
      query: {
        enabled: !!clientId,
        queryKey: getGetMyPumpAssignmentsQueryKey({ clientId }),
      },
    },
  )

  // Auto-select when there is exactly one assigned pump
  useEffect(() => {
    if (assignments.length === 1 && selectedAssignmentId === null) {
      setSelectedAssignmentId(assignments[0].id)
    }
  }, [assignments, selectedAssignmentId])

  // Derive the pump label + fuel type from the selection
  const selectedAssignment = assignments.find((a) => a.id === selectedAssignmentId) ?? null
  const pumpLabel = selectedAssignment?.label ?? ""
  const fuelType: FuelType | "" = (selectedAssignment?.fuelType as FuelType) ?? ""

  const canLookUp = !!clientId && !!pumpLabel && !!fuelType

  // ── Fetch the start index for this pump/fuel combo ──────────────────────
  const { data: lastIndex, isFetching: isLoadingLastIndex } = useGetLastPumpIndex(
    { clientId, pumpLabel, fuelType: fuelType as FuelType },
    {
      query: {
        enabled: canLookUp,
        queryKey: getGetLastPumpIndexQueryKey({ clientId, pumpLabel, fuelType: fuelType as FuelType }),
      },
    },
  )

  const indexStart = lastIndex?.indexEnd ?? 0

  // Reset index end whenever the pump selection changes
  useEffect(() => {
    setIndexEnd("")
  }, [selectedAssignmentId])

  // ── Volume calculation ──────────────────────────────────────────────────
  const volumeLiters = useMemo(() => {
    const end = parseFloat(indexEnd)
    if (isNaN(end)) return null
    return Math.round((end - indexStart) * 100) / 100
  }, [indexEnd, indexStart])

  // ── Submit ──────────────────────────────────────────────────────────────
  const createShift = useCreatePumpShift({
    mutation: {
      onSuccess: (shift) => {
        toast({
          title: "Relevé enregistré",
          description: `${shift.volumeLiters} L relevés pour ${shift.pumpLabel}.`,
        })
        navigate(`/ventes-carburant/${shift.id}`)
      },
      onError: (error: any) => {
        toast({
          title: "Erreur",
          description: error?.data?.error || "Impossible d'enregistrer le relevé.",
          variant: "destructive",
        })
      },
    },
  })

  function handleSubmit() {
    if (!clientId || !pumpLabel || !fuelType) return
    const end = parseFloat(indexEnd)
    if (isNaN(end)) return
    createShift.mutate({ data: { clientId, pumpLabel, fuelType, indexEnd: end } })
  }

  const canSubmit =
    canLookUp && volumeLiters !== null && volumeLiters >= 0 && !createShift.isPending

  const isSingleAssignment = assignments.length === 1
  const hasNoAssignment = !isLoadingAssignments && assignments.length === 0

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/portal">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Retour
        </Link>
      </Button>

      <Card className="shadow-sm border-amber-200 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <Gauge className="h-5 w-5" />
            Relevé d'index de pompe
          </CardTitle>
          <CardDescription>
            Saisissez le compteur de fin de service pour calculer le volume vendu.
          </CardDescription>
          {stationName && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 mt-1">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>Station : <span className="font-semibold">{stationName}</span></span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">

          {/* ── Chargement ─────────────────────────────────────────────── */}
          {isLoadingAssignments && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Chargement des attributions…
            </p>
          )}

          {/* ── Aucune attribution ─────────────────────────────────────── */}
          {hasNoAssignment && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 p-4 flex gap-3 items-start">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Aucune pompe attribuée pour aujourd'hui
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Votre responsable n'a pas encore configuré votre attribution de pompe pour ce
                  jour. Contactez-le pour qu'il procède à l'attribution avant de commencer votre
                  service.
                </p>
              </div>
            </div>
          )}

          {/* ── Formulaire principal (affiché uniquement si attribution) ─ */}
          {!isLoadingAssignments && assignments.length > 0 && (
            <>
              {/* Pompe — mono-attribution : label figé / multi : menu filtré */}
              <div className="space-y-1.5">
                <Label>Pompe</Label>

                {isSingleAssignment ? (
                  // Unique attribution : lecture seule avec verrou visuel
                  <div
                    className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2.5"
                    data-testid="assigned-pump-label"
                  >
                    <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium flex-1">
                      Pompe attribuée :&nbsp;
                      <span className="text-amber-800 dark:text-amber-300 font-semibold">
                        {selectedAssignment?.label}
                      </span>
                    </span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {getFuelTypeLabel(fuelType)}
                    </Badge>
                  </div>
                ) : (
                  // Plusieurs attributions : menu restreint aux pompes attribuées
                  <Select
                    value={selectedAssignmentId !== null ? String(selectedAssignmentId) : ""}
                    onValueChange={(v) => setSelectedAssignmentId(Number(v))}
                  >
                    <SelectTrigger data-testid="select-pump">
                      <SelectValue placeholder="Sélectionner votre pompe attribuée…" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignments.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.label}&nbsp;—&nbsp;{getFuelTypeLabel(a.fuelType as FuelType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Index début / fin */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="indexStart">Index de début (L)</Label>
                  <Input
                    id="indexStart"
                    value={canLookUp ? (isLoadingLastIndex ? "…" : indexStart) : "—"}
                    readOnly
                    disabled
                    className="bg-muted"
                    data-testid="input-index-start"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="indexEnd">Index de fin (L)</Label>
                  <Input
                    id="indexEnd"
                    type="number"
                    inputMode="decimal"
                    placeholder="Ex : 12450.5"
                    value={indexEnd}
                    onChange={(e) => setIndexEnd(e.target.value)}
                    disabled={!canLookUp}
                    data-testid="input-index-end"
                  />
                </div>
              </div>

              {/* Volume vendu */}
              <div className="rounded-md border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Fuel className="h-4 w-4" />
                  Volume vendu
                </span>
                <span
                  className="font-semibold text-amber-800 dark:text-amber-300"
                  data-testid="text-volume"
                >
                  {volumeLiters !== null ? `${volumeLiters} L` : "—"}
                </span>
              </div>

              {volumeLiters !== null && volumeLiters < 0 && (
                <p className="text-sm text-destructive">
                  L'index de fin ne peut pas être inférieur à l'index de début ({indexStart} L).
                </p>
              )}

              <Button
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                size="lg"
                disabled={!canSubmit}
                onClick={handleSubmit}
                data-testid="button-save-reading"
              >
                {createShift.isPending ? "Enregistrement…" : "Enregistrer le relevé"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
