-- Migration 0002: add amount_paid + last_reminded_at to invoices, add invoice_products table
-- Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to run against a DB that
-- already has these columns/tables (e.g. a Railway instance that was bootstrapped with push).

-- invoices: partial-payment tracking
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "last_reminded_at" timestamp with time zone;--> statement-breakpoint

-- invoice_products: re-usable article/service catalog per cabinet
CREATE TABLE IF NOT EXISTS "invoice_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"designation" text NOT NULL,
	"default_unit_price" integer DEFAULT 0 NOT NULL,
	"vat_rate" integer DEFAULT 18 NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_products" ADD CONSTRAINT "invoice_products_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_products_firm_id_idx" ON "invoice_products" USING btree ("firm_id");
