import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useParams } from "wouter"
import {
  useListPumpShifts,
  getListPumpShiftsQueryKey,
  useGetPumpShift,
  getGetPumpShiftQueryKey,
  useValidatePumpShift,
  PaymentMethod,
  type PumpShiftValidateResult,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { getPaymentMethodLabel, formatFcfa } from "@/lib/status"
import { formatDateTime } from "@/lib/utils"
import { ArrowLeft, Fuel, CheckCircle2, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PAYMENT_METHODS: PaymentMethod[] = ["especes", "mobile_money", "cheque", "virement"]

// Module P7: default local pump price ("Ex : 875 FCFA pour le Super en Côte
// d'Ivoire") -- a starting point the pompiste can still override before
// validating.
const DEFAULT_UNIT_PRICE: Record<string, number> = {
  super: 875,
  gasoil: 810,
}

function getFuelLabel(fuel: string) {
  return fuel === "super" ? "Super" : fuel === "gasoil" ? "Gasoil" : fuel
}

// Module P7: "Ventes de carburant" -- step 2 of a pump shift. Without a
// :id, lists shifts still awaiting sale validation ("Relevé d'index"
// created them); with a :id, finalizes that one shift and posts the
// SYSCOHADA draft entry.
export default function FuelSales() {
  const params = useParams<{ id?: string }>()
  const shiftId = params.id ? parseInt(params.id, 10) : null

  return shiftId ? <ValidateShift shiftId={shiftId} /> : <PendingShiftsList />
}

function PendingShiftsList() {
  const { user } = useAuth()
  const clientId = user?.clientId ?? 0

  const { data: shifts, isLoading } = useListPumpShifts(
    { clientId, status: "OPEN" },
    { query: { enabled: !!clientId, queryKey: getListPumpShiftsQueryKey({ clientId, status: "OPEN" }) } },
  )

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
            <Fuel className="h-5 w-5" />
            Ventes de carburant
          </CardTitle>
          <CardDescription>
            Sélectionnez un relevé en attente pour enregistrer sa vente et valider le shift.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Chargement...</p>}
          {!isLoading && (shifts ?? []).length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Gauge className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucun relevé en attente.</p>
              <Button asChild variant="link" size="sm" className="mt-1">
                <Link href="/releve-index">Faire un relevé d'index</Link>
              </Button>
            </div>
          )}
          {(shifts ?? []).map((s) => (
            <Link key={s.id} href={`/ventes-carburant/${s.id}`}>
              <button
                className="w-full text-left rounded-md border p-3 hover:bg-accent transition-colors flex items-center justify-between"
                data-testid={`row-pending-shift-${s.id}`}
              >
                <div>
                  <div className="font-medium">
                    {s.pumpLabel} · {getFuelLabel(s.fuelType)}
                  </div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(s.createdAt)}</div>
                </div>
                <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {s.volumeLiters} L
                </Badge>
              </button>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function ValidateShift({ shiftId }: { shiftId: number }) {
  const { toast } = useToast()
  const [, navigate] = useLocation()

  const { data: shift, isLoading } = useGetPumpShift(shiftId, {
    query: { queryKey: getGetPumpShiftQueryKey(shiftId) },
  })

  const [unitPrice, setUnitPrice] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("")
  const [declaredAmount, setDeclaredAmount] = useState("")
  const [result, setResult] = useState<PumpShiftValidateResult | null>(null)

  useEffect(() => {
    if (shift && !unitPrice) {
      setUnitPrice(String(DEFAULT_UNIT_PRICE[shift.fuelType] ?? ""))
    }
  }, [shift, unitPrice])

  const validateMutation = useValidatePumpShift({
    mutation: {
      onSuccess: (data) => {
        setResult(data)
        toast({ title: "Shift validé", description: "L'écriture SYSCOHADA a été enregistrée." })
      },
      onError: (error: any) => {
        toast({
          title: "Erreur",
          description: error?.data?.error || "Impossible de valider le shift.",
          variant: "destructive",
        })
      },
    },
  })

  const expectedAmount = useMemo(() => {
    if (!shift) return null
    const price = parseInt(unitPrice, 10)
    if (isNaN(price)) return null
    return Math.round(shift.volumeLiters * price)
  }, [shift, unitPrice])

  const discrepancy = useMemo(() => {
    if (paymentMethod !== "especes" || expectedAmount == null) return null
    const declared = parseInt(declaredAmount, 10)
    if (isNaN(declared)) return null
    return declared - expectedAmount
  }, [paymentMethod, expectedAmount, declaredAmount])

  function handleValidate() {
    if (!shift || expectedAmount == null || !paymentMethod) return
    if (paymentMethod === "especes" && !declaredAmount) return
    validateMutation.mutate({
      id: shift.id,
      data: {
        unitPrice: parseInt(unitPrice, 10),
        paymentMethod,
        declaredPhysicalAmount: paymentMethod === "especes" ? parseInt(declaredAmount, 10) : null,
      },
    })
  }

  if (isLoading) {
    return <div className="max-w-lg mx-auto p-4 text-sm text-muted-foreground">Chargement...</div>
  }
  if (!shift) {
    return <div className="max-w-lg mx-auto p-4 text-sm text-destructive">Relevé introuvable.</div>
  }

  const canValidate =
    !!paymentMethod &&
    !!unitPrice &&
    (paymentMethod !== "especes" || !!declaredAmount) &&
    !validateMutation.isPending &&
    shift.status === "OPEN"

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/ventes-carburant">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Retour
        </Link>
      </Button>

      <Card className="shadow-sm border-amber-200 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <Fuel className="h-5 w-5" />
            Ventes de carburant
          </CardTitle>
          <CardDescription>
            {shift.pumpLabel} · {getFuelLabel(shift.fuelType)} — relevé du {formatDateTime(shift.createdAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="volume">Volume vendu (L)</Label>
            <Input id="volume" value={`${shift.volumeLiters} L`} readOnly disabled className="bg-muted" data-testid="input-volume" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unitPrice">Prix unitaire au litre (FCFA)</Label>
            <AmountInput
              id="unitPrice"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              disabled={shift.status !== "OPEN"}
              data-testid="input-unit-price"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Mode de paiement</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
              disabled={shift.status !== "OPEN"}
            >
              <SelectTrigger id="paymentMethod" data-testid="select-payment-method">
                <SelectValue placeholder="Sélectionner un mode..." />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {getPaymentMethodLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paymentMethod === "especes" && (
            <div className="space-y-2">
              <Label htmlFor="declaredAmount">Montant physiquement compté en caisse (FCFA)</Label>
              <AmountInput
                id="declaredAmount"
                value={declaredAmount}
                onChange={(e) => setDeclaredAmount(e.target.value)}
                disabled={shift.status !== "OPEN"}
                data-testid="input-declared-amount"
              />
            </div>
          )}

          <div className="rounded-md border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Montant attendu</span>
              <span className="font-semibold" data-testid="text-expected-amount">
                {expectedAmount != null ? formatFcfa(expectedAmount) : "—"}
              </span>
            </div>
            {discrepancy != null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Écart de caisse</span>
                <span
                  className={`font-semibold ${discrepancy === 0 ? "" : discrepancy > 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
                  data-testid="text-discrepancy"
                >
                  {discrepancy > 0 ? "+" : ""}
                  {formatFcfa(discrepancy)}
                </span>
              </div>
            )}
          </div>

          {shift.status === "OPEN" ? (
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              size="lg"
              disabled={!canValidate}
              onClick={handleValidate}
              data-testid="button-validate-shift"
            >
              {validateMutation.isPending ? "Validation..." : "Valider le Shift"}
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Shift déjà validé.
            </div>
          )}
        </CardContent>
      </Card>

      {(result ?? (shift.status === "VALIDATED" ? shift : null)) && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Écriture SYSCOHADA (brouillon)</CardTitle>
            <CardDescription>Écriture comptable générée automatiquement, en attente de validation par le cabinet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {result?.saleTransaction && (
              <div className="text-sm space-y-1">
                <div className="font-medium">{result.saleTransaction.label}</div>
                {result.saleTransaction.journalLines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span>{line.accountNumber} — {line.label}</span>
                    <span>
                      {line.debitAmount > 0 ? `D ${formatFcfa(line.debitAmount)}` : `C ${formatFcfa(line.creditAmount)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {result?.discrepancyTransaction && (
              <div className="text-sm space-y-1 pt-2 border-t">
                <div className="font-medium">{result.discrepancyTransaction.label}</div>
                {result.discrepancyTransaction.journalLines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span>{line.accountNumber} — {line.label}</span>
                    <span>
                      {line.debitAmount > 0 ? `D ${formatFcfa(line.debitAmount)}` : `C ${formatFcfa(line.creditAmount)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Button asChild variant="outline" className="w-full mt-2">
              <Link href="/ventes-carburant">Voir les autres relevés en attente</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
