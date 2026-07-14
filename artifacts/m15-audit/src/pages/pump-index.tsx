import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "wouter"
import {
  useGetLastPumpIndex,
  getGetLastPumpIndexQueryKey,
  useCreatePumpShift,
  FuelType,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Fuel, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PUMPS = ["Pompe 1", "Pompe 2", "Pompe 3", "Pompe 4"]

function getFuelTypeLabel(fuel: FuelType | "") {
  return fuel === "super" ? "Super" : fuel === "gasoil" ? "Gasoil" : ""
}

// Module P7 (Un Pompiste = Un Shift): "Relevé d'index de pompe" -- the
// pompiste's first action of a shift. The start reading is always resolved
// from the pump/fuel's own last shift (never editable), so only the
// closing reading needs to be entered; the sold volume is derived.
export default function PumpIndex() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [, navigate] = useLocation()
  const clientId = user?.clientId ?? 0

  const [pumpLabel, setPumpLabel] = useState<string>("")
  const [fuelType, setFuelType] = useState<FuelType | "">("")
  const [indexEnd, setIndexEnd] = useState("")

  const canLookUp = !!clientId && !!pumpLabel && !!fuelType

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

  useEffect(() => {
    setIndexEnd("")
  }, [pumpLabel, fuelType])

  const volumeLiters = useMemo(() => {
    const end = parseFloat(indexEnd)
    if (isNaN(end)) return null
    const diff = Math.round((end - indexStart) * 100) / 100
    return diff
  }, [indexEnd, indexStart])

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

  const canSubmit = canLookUp && volumeLiters !== null && volumeLiters >= 0 && !createShift.isPending

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
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pumpLabel">Pompe</Label>
            <Select value={pumpLabel} onValueChange={setPumpLabel}>
              <SelectTrigger id="pumpLabel" data-testid="select-pump">
                <SelectValue placeholder="Sélectionner une pompe..." />
              </SelectTrigger>
              <SelectContent>
                {PUMPS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fuelType">Type de carburant</Label>
            <Select value={fuelType} onValueChange={(v) => setFuelType(v as FuelType)}>
              <SelectTrigger id="fuelType" data-testid="select-fuel-type">
                <SelectValue placeholder="Sélectionner un carburant..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="super">Super</SelectItem>
                <SelectItem value="gasoil">Gasoil</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="indexStart">Index de début (L)</Label>
              <Input
                id="indexStart"
                value={canLookUp ? (isLoadingLastIndex ? "..." : indexStart) : "—"}
                readOnly
                disabled
                className="bg-muted"
                data-testid="input-index-start"
              />
            </div>
            <div className="space-y-2">
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

          <div className="rounded-md border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Fuel className="h-4 w-4" />
              Volume vendu
            </span>
            <span className="font-semibold text-amber-800 dark:text-amber-300" data-testid="text-volume">
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
            {createShift.isPending ? "Enregistrement..." : "Enregistrer le relevé"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
