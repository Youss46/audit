---
name: Dépenses & Achats — audit trail, AIB, cabinet validation
description: Schema, accounting engine, API, and frontend design for the receipt/AIB/workflow upgrade to the purchases module.
---

## Schema additions to purchasesTable (lib/db/src/schema/purchases.ts)
- `reviewStatus`: `'brouillon' | 'en_attente' | 'valide'` — workflow status separate from `status` (payment: pending/settled).
- `aibRate`: integer (0, 2, 7 percent); `aibAmount`: integer — AIB Côte d'Ivoire retenue à la source.
- `receiptFileData` / `receiptFileName` / `receiptMimeType`: receipt stored inline as base64 (same pattern as documentsTable).
- `validatedById`, `validatedAt`, `correctedChargeAccount`, `correctedChargeName`: cabinet validation fields.
- `isLettre`: boolean, default false.

## Accounting engine — AIB treatment (artifacts/api-server/src/lib/accounting-engine.ts)
AIB booked at **settlement time for credit purchases**, at **purchase entry for immediate payments**:
- Immediate (bank/MM): Dr Charge + Dr 4451 / Cr 447200 AIB + Cr 5211/552 (TTC − AIB)
- Credit: Dr Charge + Dr 4451 / Cr 4011 (full TTC) → at settlement: Dr 4011 / Cr 447200 AIB + Cr 5211/552 (net)
- Account: 447200 "État, retenues à la source — AIB"

**Why:** Strict SYSCOHADA accrual — AIB is withheld at payment, not at invoice booking.

## API routes (artifacts/api-server/src/routes/purchases.ts)
- `GET /purchases` — adds `reviewStatus` filter; returns `clientName` (enriched via join).
- `POST /purchases` — inline receipt base64, aibRate, reviewStatus param.
- `GET /purchases/:id/receipt` — returns `{ fileData, fileName, mimeType }`.
- `POST /purchases/:id/receipt` — attach/replace receipt on existing purchase.
- `POST /purchases/:id/validate` — cabinet-only; flips reviewStatus to 'valide'; if correctedChargeAccount given, updates the journal line in-place (journalLinesTable WHERE transactionId + accountNumber = chargeAccount).
- `POST /purchases/:id/settle` — updated to pass `aibAmount` to `computePurchaseSettlementLines`.

## OpenAPI + codegen gotcha
Orval generates `ListPurchasesParams` (TS type) from the **endpoint's `parameters` block**, NOT from a standalone schema like `ListPurchasesQueryParams`. Must add the param inline to the `GET /purchases` parameters list, not just to the schema component.

**How to apply:** When adding a query filter to a list endpoint, always add it to both the endpoint `parameters` AND the schema component.

## Frontend — PME page (depenses-achats.tsx)
- AIB selector: three buttons (0%, 2%, 7%).
- Amount breakdown card: HT → +TVA → TTC → −AIB → Net payable.
- File picker: drag-and-drop + `<input type=file capture="environment">` for camera on mobile.
- `useGetPurchaseReceipt(id, options)` — takes `id: number` directly, NOT `{ id }`.
- `useListPurchaseCategories()` — takes no first argument.
- "Brouillon" button submits with `reviewStatus: 'brouillon'`; "Soumettre" with `en_attente`.

## Frontend — Cabinet review page (depenses-revision.tsx)
- Route: `/cabinet/depenses-revision`; nav link in Shell.tsx under Comptabilité.
- Two-panel layout: left = purchase list (clickable cards); right = receipt viewer + correction form + validate button.
- `useListPurchases({ reviewStatus: 'en_attente' })` — cabinet sees all clients (no clientId filter).
- On validate with corrected account: shows diff warning before submitting.
