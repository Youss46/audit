---
name: M28 partial payment & invoice catalog
description: Design decisions for partial payments (acomptes), invoice products catalog, and payment reminders added to the invoicing module.
---

## Partial Payments (PARTIELLEMENT_PAYE)

- New status added to `INVOICE_STATUSES` in `lib/db/src/schema/invoicing.ts`.
- Two new columns on `invoicesTable`: `amountPaid` (integer, default 0) and `lastRemindedAt` (timestamp, nullable).
- `serializeInvoice()` now returns `amountPaid`, `balanceDue` (= totalTtc - amountPaid), `lastRemindedAt`.
- `POST /invoices/:id/mark-paid` body accepts optional `amount` field; if amount < remainingBalance → PARTIELLEMENT_PAYE, otherwise PAYE.
- Mobile Money path: uses `paymentAmount` instead of `inv.totalTtc`; partial MM payments are blocked (400 error).
- Guard: allows both VALIDE and PARTIELLEMENT_PAYE as starting status.

**Why:** Ivorian clients often pay in installments; the system needs to track partial receipts without losing the invoice.

## Invoice Products Catalog

- New table: `invoiceProductsTable` (firm_id, designation, defaultUnitPrice, vatRate, description, isActive, createdAt).
- Routes: `GET /invoice-products`, `POST /invoice-products`, `DELETE /invoice-products/:id` (soft delete: isActive=false).
- Frontend: "Catalogue" button in facturation.tsx header; dialog with add form + deletable list.
- Hooks: `useListInvoiceProducts`, `useCreateInvoiceProduct`, `useDeleteInvoiceProduct` added to api-client-react.

## Payment Reminders (Relances)

- Route: `POST /invoices/:id/remind` — sends email via `sendMail()` from mailer.ts if customerEmail is set.
- Updates `lastRemindedAt` on the invoice; logs an audit entry.
- Non-blocking: email failure logs to console but doesn't fail the HTTP response.
- Frontend: Bell icon button on VALIDE/PARTIELLEMENT_PAYE invoices in renderActions.

## Compliance / Audit Log

- `GET /audit-logs` limit raised from 200 → 1000.
- New `GET /audit-logs/export-pdf` endpoint: generates landscape A4 PDF via `generateAuditLogPdf()` in export-engine.ts.
- Frontend: compliance.tsx fully rewritten with 50-row client-side pagination, CSV export (client-side blob), PDF export (binary fetch to backend).

## Schema / Zod Notes

- Zod status enum in `ListInvoicesQueryParams` updated to include PARTIELLEMENT_PAYE.
- `MarkInvoicePaidBody` Zod schema and TS interface both now include optional `amount` field.
- Invoice response Zod schemas were NOT updated (backend bypasses Zod for responses; TS types in api.schemas.ts updated instead).
- New Zod schemas added at end of api-zod/src/generated/api.ts: `ListInvoiceProductsResponse`, `CreateInvoiceProductBody/Response`, `DeleteInvoiceProductParams`, `RemindInvoiceParams/Response`.
