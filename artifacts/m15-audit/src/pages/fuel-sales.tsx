import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useParams } from "wouter"
import {
  useListPumpShifts,
  getListPumpShiftsQueryKey,
  useGetPumpShift,
  getGetPumpShiftQueryKey,
  useListFuelPrices,
  getListFuelPricesQueryKey,
  useValidatePumpShift,
  type PumpShiftValidateResult,
} from "@workspace/api-client-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { formatFcfa } from "@/lib/status"
import { formatDateTime } from "@/lib/utils"
import { ArrowLeft, Fuel, CheckCircle2, Gauge, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

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
  const { user } = useAuth()
  const clientId = user?.clientId ?? 0

  const { data: shift, isLoading } = useGetPumpShift(shiftId, {
    query: { queryKey: getGetPumpShiftQueryKey(shiftId) },
  })

  // Module P7 (Sécurisation du prix carburant): the price is never entered
  // by the pompiste. It is fetched here purely for display -- based on the
  // shift's fuel type -- and the input is always read-only. The server
  // independently re-resolves the same value at validation time, so this
  // fetch is a UX convenience, not a trust boundary.
  const { data: fuelPrices, isLoading: isLoadingFuelPrice } = useListFuelPrices(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListFuelPricesQueryKey({ clientId }) } },
  )
  const activeFuelPrice = shift
    ? fuelPrices?.find((p) => p.fuelType === shift.fuelType)
    : undefined
  const unitPrice = activeFuelPrice ? String(activeFuelPrice.unitPrice) : ""

  // Split-payment breakdown state (all in FCFA)
  const [cashAmount, setCashAmount] = useState("")
  const [waveAmount, setWaveAmount] = useState("")
  const [orangeMoneyAmount, setOrangeMoneyAmount] = useState("")
  const [mtnMomoAmount, setMtnMomoAmount] = useState("")
  const [declaredAmount, setDeclaredAmount] = useState("")
  const [result, setResult] = useState<PumpShiftValidateResult | null>(null)

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

  // Theoretical sale amount from pump readings × unit price (locked, from
  // fuelPricesTable -- see activeFuelPrice above). Decimal-safe: prices can
  // include cents (e.g. 810.50 FCFA/L).
  const expectedAmount = useMemo(() => {
    if (!shift) return null
    const price = parseFloat(unitPrice)
    if (isNaN(price)) return null
    return Math.round(shift.volumeLiters * price)
  }, [shift, unitPrice])

  // Running total of all payment channels.
  const totalPayments = useMemo(() => {
    const cash = parseInt(cashAmount, 10) || 0
    const wave = parseInt(waveAmount, 10) || 0
    const orange = parseInt(orangeMoneyAmount, 10) || 0
    const mtn = parseInt(mtnMomoAmount, 10) || 0
    return cash + wave + orange + mtn
  }, [cashAmount, waveAmount, orangeMoneyAmount, mtnMomoAmount])

  const cashValue = parseInt(cashAmount, 10) || 0
  const hasCash = cashValue > 0
  const paymentMatchesExpected = expectedAmount != null && totalPayments === expectedAmount

  // Écart de caisse: declared physical cash vs. the expected cash portion.
  const discrepancy = useMemo(() => {
    if (!hasCash || expectedAmount == null) return null
    const declared = parseInt(declaredAmount, 10)
    if (isNaN(declared)) return null
    return declared - cashValue
  }, [hasCash, expectedAmount, declaredAmount, cashValue])

  function handleValidate() {
    if (!shift || expectedAmount == null || !paymentMatchesExpected) return
    if (hasCash && !declaredAmount) return
    validateMutation.mutate({
      id: shift.id,
      data: {
        // Sent for shape-compatibility only -- the server ignores this
        // field and always re-resolves the price itself from
        // fuelPricesTable (see pump-shifts.ts validate route).
        unitPrice: parseFloat(unitPrice),
        cashAmount: parseInt(cashAmount, 10) || 0,
        waveAmount: parseInt(waveAmount, 10) || 0,
        orangeMoneyAmount: parseInt(orangeMoneyAmount, 10) || 0,
        mtnMomoAmount: parseInt(mtnMomoAmount, 10) || 0,
        declaredPhysicalAmount: hasCash ? parseInt(declaredAmount, 10) : null,
      } as any, // shape aligned with PumpShiftValidateInput after codegen
    })
  }

  if (isLoading) {
    return <div className="max-w-lg mx-auto p-4 text-sm text-muted-foreground">Chargement...</div>
  }
  if (!shift) {
    return <div className="max-w-lg mx-auto p-4 text-sm text-destructive">Relevé introuvable.</div>
  }

  const isDisabled = shift.status !== "OPEN"
  const priceNotConfigured = !isLoadingFuelPrice && !activeFuelPrice
  const canValidate =
    paymentMatchesExpected &&
    !!unitPrice &&
    (!hasCash || !!declaredAmount) &&
    !validateMutation.isPending &&
    !isDisabled &&
    !priceNotConfigured

  const amountGap = expectedAmount != null ? totalPayments - expectedAmount : null

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
          {/* Volume and unit price */}
          <div className="space-y-2">
            <Label htmlFor="volume">Volume vendu (L)</Label>
            <Input id="volume" value={`${shift.volumeLiters} L`} readOnly disabled className="bg-muted" data-testid="input-volume" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unitPrice">Prix unitaire au litre (FCFA)</Label>
            <AmountInput
              id="unitPrice"
              value={isLoadingFuelPrice ? "" : unitPrice}
              placeholder={isLoadingFuelPrice ? "Chargement…" : undefined}
              readOnly
              disabled
              className="bg-muted"
              data-testid="input-unit-price"
            />
            <p className="text-xs text-muted-foreground">
              Prix fixé par le propriétaire du dossier — non modifiable ici.
            </p>
            {priceNotConfigured && (
              <div className="flex items-center gap-1.5 text-xs text-destructive pt-0.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Aucun prix n'est configuré pour {getFuelLabel(shift.fuelType)}. Demandez au
                  propriétaire du dossier de le définir dans « Prix du carburant » avant de
                  valider ce shift.
                </span>
              </div>
            )}
          </div>

          {/* ── Répartition des paiements ── */}
          <div className="space-y-1 pt-1">
            <p className="text-sm font-semibold">Répartition des paiements (FCFA)</p>
            <p className="text-xs text-muted-foreground">
              Saisissez les montants perçus par canal. La somme doit être égale au montant attendu.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cashAmount">Espèces</Label>
            <AmountInput
              id="cashAmount"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              disabled={isDisabled}
              placeholder="0"
              data-testid="input-cash-amount"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="waveAmount">Paiement Wave</Label>
            <AmountInput
              id="waveAmount"
              value={waveAmount}
              onChange={(e) => setWaveAmount(e.target.value)}
              disabled={isDisabled}
              placeholder="0"
              data-testid="input-wave-amount"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="orangeMoneyAmount">Paiement Orange Money</Label>
            <AmountInput
              id="orangeMoneyAmount"
              value={orangeMoneyAmount}
              onChange={(e) => setOrangeMoneyAmount(e.target.value)}
              disabled={isDisabled}
              placeholder="0"
              data-testid="input-orange-money-amount"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mtnMomoAmount">Paiement MTN MoMo</Label>
            <AmountInput
              id="mtnMomoAmount"
              value={mtnMomoAmount}
              onChange={(e) => setMtnMomoAmount(e.target.value)}
              disabled={isDisabled}
              placeholder="0"
              data-testid="input-mtn-momo-amount"
            />
          </div>

          {/* Physical cash count — only when espèces portion > 0 */}
          {hasCash && !isDisabled && (
            <div className="space-y-2">
              <Label htmlFor="declaredAmount">
                Montant physiquement compté en caisse — Espèces (FCFA)
              </Label>
              <AmountInput
                id="declaredAmount"
                value={declaredAmount}
                onChange={(e) => setDeclaredAmount(e.target.value)}
                disabled={isDisabled}
                data-testid="input-declared-amount"
              />
            </div>
          )}

          {/* Summary panel */}
          <div className="rounded-md border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Montant attendu</span>
              <span className="font-semibold" data-testid="text-expected-amount">
                {expectedAmount != null ? formatFcfa(expectedAmount) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total saisi</span>
              <span
                className={`font-semibold ${
                  paymentMatchesExpected
                    ? "text-green-700 dark:text-green-400"
                    : totalPayments > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : ""
                }`}
                data-testid="text-total-payments"
              >
                {totalPayments > 0 ? formatFcfa(totalPayments) : "—"}
              </span>
            </div>
            {amountGap != null && amountGap !== 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 pt-0.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {amountGap > 0 ? `Excédent de ${formatFcfa(amountGap)}` : `Manquant de ${formatFcfa(-amountGap)}`}
                </span>
              </div>
            )}
            {discrepancy != null && (
              <div className="flex items-center justify-between text-sm border-t pt-1.5 mt-0.5">
                <span className="text-muted-foreground">Écart de caisse (Espèces)</span>
                <span
                  className={`font-semibold ${
                    discrepancy === 0
                      ? ""
                      : discrepancy > 0
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-700 dark:text-red-400"
                  }`}
                  data-testid="text-discrepancy"
                >
                  {discrepancy > 0 ? "+" : ""}
                  {formatFcfa(discrepancy)}
                </span>
              </div>
            )}
          </div>

          {!isDisabled ? (
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
                <div className="font-medium text-amber-700 dark:text-amber-400">
                  Écart de caisse
                </div>
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
