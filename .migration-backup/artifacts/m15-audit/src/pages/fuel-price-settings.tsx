import { useState } from "react"
import { Link } from "wouter"
import {
  useListFuelPrices,
  getListFuelPricesQueryKey,
  useUpsertFuelPrice,
  FuelType,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { formatFcfa } from "@/lib/status"
import { formatDateTime } from "@/lib/utils"
import { CircleDollarSign, Pencil, ArrowLeft, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AmountInput } from "@/components/ui/amount-input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const FUEL_TYPES: FuelType[] = ["super", "gasoil"]

function fuelLabel(f: FuelType | string) {
  return f === "super" ? "Super" : f === "gasoil" ? "Gasoil" : f
}

// Module P7 (Sécurisation du prix carburant): PME owner ("client_pme")
// screen for setting the active FCFA selling price per litre for each fuel
// type. This is the ONLY place the price can be changed -- the "Ventes de
// carburant" validation form only ever displays it read-only, and the
// server independently re-resolves it from this same table at validation
// time regardless of what the client sends, so a pompiste has no way to
// influence "Montant attendu" from the sale screen.
export default function FuelPriceSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const clientId = user?.clientId ?? 0

  const [editingFuelType, setEditingFuelType] = useState<FuelType | null>(null)
  const [priceInput, setPriceInput] = useState("")

  const { data: prices = [], isLoading, refetch } = useListFuelPrices(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListFuelPricesQueryKey({ clientId }) } },
  )

  const upsertMutation = useUpsertFuelPrice({
    mutation: {
      onSuccess: () => {
        setEditingFuelType(null)
        setPriceInput("")
        toast({ title: "Prix mis à jour" })
        refetch()
      },
      onError: (err: any) => {
        toast({
          title: "Erreur",
          description: err?.data?.error ?? "Impossible de mettre à jour ce prix.",
          variant: "destructive",
        })
      },
    },
  })

  function openEdit(fuelType: FuelType) {
    const existing = prices.find((p) => p.fuelType === fuelType)
    setPriceInput(existing ? String(existing.unitPrice) : "")
    setEditingFuelType(fuelType)
  }

  function handleSave() {
    if (!editingFuelType) return
    const value = parseFloat(priceInput)
    if (isNaN(value) || value <= 0) return
    upsertMutation.mutate({
      data: { clientId, fuelType: editingFuelType, unitPrice: value },
    })
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/portal">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Retour
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CircleDollarSign className="h-6 w-6 text-amber-600" />
          Prix du carburant
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Définissez le prix de vente au litre pour chaque type de carburant. Ce prix est
          appliqué automatiquement et de façon sécurisée sur l'écran « Ventes de carburant »
          des pompistes — ils ne peuvent ni le voir modifiable, ni l'influencer.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Seul le propriétaire du dossier (vous) peut modifier ces prix. Le serveur recalcule
          systématiquement le montant attendu à partir de cette valeur, jamais depuis la saisie
          du pompiste.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Prix actifs</CardTitle>
          <CardDescription>Un prix par type de carburant vendu à la pompe.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Chargement…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Carburant</TableHead>
                  <TableHead className="text-right">Prix au litre (FCFA)</TableHead>
                  <TableHead>Dernière mise à jour</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {FUEL_TYPES.map((fuelType) => {
                  const price = prices.find((p) => p.fuelType === fuelType)
                  return (
                    <TableRow key={fuelType} data-testid={`row-fuel-price-${fuelType}`}>
                      <TableCell className="font-medium">{fuelLabel(fuelType)}</TableCell>
                      <TableCell className="text-right font-mono text-sm" data-testid={`text-fuel-price-${fuelType}`}>
                        {price ? formatFcfa(price.unitPrice) : "Non configuré"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {price ? `${formatDateTime(price.updatedAt)}${price.updatedByName ? ` — ${price.updatedByName}` : ""}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(fuelType)}
                          data-testid={`button-edit-fuel-price-${fuelType}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingFuelType} onOpenChange={(open) => !open && setEditingFuelType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le prix — {editingFuelType ? fuelLabel(editingFuelType) : ""}</DialogTitle>
            <DialogDescription>
              Ce nouveau prix s'appliquera immédiatement à toutes les prochaines ventes de ce
              carburant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="fuel-price-input">Prix au litre (FCFA)</Label>
            <AmountInput
              id="fuel-price-input"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              data-testid="input-fuel-price"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFuelType(null)}>Annuler</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleSave}
              disabled={!priceInput || parseFloat(priceInput) <= 0 || upsertMutation.isPending}
              data-testid="button-confirm-fuel-price"
            >
              {upsertMutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
