---
name: M28 Invoicing & PDF Receipt Design
description: Key decisions and gotchas for the invoice module — schema, route, PDF, accounting, and Shell routing.
---

## Schema
- Tables: `invoicesTable`, `invoiceItemsTable` in `lib/db/src/schema/invoicing.ts`.
- All amounts are integers in FCFA (matching every other table). VAT rate stored as integer percentage (18 = 18%).
- `invoiceNumber` is NULL until validation (FAC-YYYY-XXXX format). `pdfDocumentId` and `postedTransactionId` filled on validation.
- Relations in `relations.ts` follow existing pattern.

## Route gotcha: HttpError is local
`HttpError` is NOT in a shared lib — it is a private class defined inside `accounting.ts`. Every route that needs it must define its own local copy (same pattern):
```typescript
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
```

## PDF generation
`generateInvoicePdf(inv: InvoiceForPdf): Promise<Buffer>` is exported from `lib/export-engine.ts`.
Uses `renderPdf()` (internal) + `THEME`/`BASE_STYLES`/`tableLayout()`/`headerCell()`/`totalCell()` primitives from the same file.

## Accounting entry on validation
Direct DB insert (bypasses PME validation flow, same pattern as closing/payroll engines):
- transaction: `type:"recette"`, `source:"manual_cabinet"`, `status:"valide"`, `paymentType:"credit"`
- journal lines: Débit 411 (TTC) / Crédit 706 (HT) / Crédit 443100 (TVA)
- Credit note (avoir) reversal: Débit 706 + Débit 443100 / Crédit 411, `type:"depense"`.

## Invoice number sequencing
`getNextInvoiceNumber()` queries all existing numbers via `like(invoiceNumber, "FAC-YYYY-%")` and picks `max_seq + 1`.
Prefix "AVO-YYYY-XXXX" for credit notes (avoirs). No DB-level sequence — relies on the LIKE query.

## Shell routing guards
- `CLIENT_PME_PREFIXES` constant defined alongside `CABINET_ONLY_PREFIXES` in Shell.tsx.
- `/facturation` is a client_pme-only route — added to `CLIENT_PME_PREFIXES` so cabinet staff are redirected to `/dashboard`.
- Nav item uses `<Receipt>` lucide icon.

## OpenAPI spec fix
`cat >> openapi.yaml` appends to the END of the file, which lands after `components:` and breaks Orval validation.
**Fix**: use a Python script to extract the appended blocks and reinsert paths before `components:` and schemas inside `components: schemas:`.
