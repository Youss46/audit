-- Migration 0001 : ajout des tables P8/M28 et colonnes manquantes
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─── Nouvelles colonnes sur tables existantes ────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "station_id" integer,
  ADD COLUMN IF NOT EXISTS "associated_cash_account_number" text,
  ADD COLUMN IF NOT EXISTS "requires_password_change" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "temporary_password_plain" text;
--> statement-breakpoint

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "station_id" integer,
  ADD COLUMN IF NOT EXISTS "supplier_name" text,
  ADD COLUMN IF NOT EXISTS "supplier_ncc" text,
  ADD COLUMN IF NOT EXISTS "invoice_number" text,
  ADD COLUMN IF NOT EXISTS "anomalies" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "tax_regime" text NOT NULL DEFAULT 'REEL_NORMAL',
  ADD COLUMN IF NOT EXISTS "is_vat_registered" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "capital_social" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "capital_deposited" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "is_reprise" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_capital_initialized" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "cash_registers"
  ADD COLUMN IF NOT EXISTS "syscohada_account" text,
  ADD COLUMN IF NOT EXISTS "owner_user_id" integer;
--> statement-breakpoint

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "synced_from_transaction_id" integer;
--> statement-breakpoint

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "folder_id" integer,
  ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fiscal_year" integer,
  ADD COLUMN IF NOT EXISTS "folder_category" text;
--> statement-breakpoint

ALTER TABLE "document_folders"
  ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fiscal_year" integer,
  ADD COLUMN IF NOT EXISTS "folder_category" text,
  ADD COLUMN IF NOT EXISTS "created_by_id" integer;
--> statement-breakpoint

ALTER TABLE "missions"
  ADD COLUMN IF NOT EXISTS "visa_stamp_code" text,
  ADD COLUMN IF NOT EXISTS "visa_issued_at" timestamp with time zone;
--> statement-breakpoint

-- ─── Nouvelles tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "payroll_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "firm_id" integer NOT NULL,
  "category" text NOT NULL,
  "rule_name" text NOT NULL,
  "rule_key" text NOT NULL,
  "rate_percentage" double precision,
  "ceiling_amount" integer,
  "is_editable" boolean DEFAULT true NOT NULL,
  "updated_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_settings_firm_rule_unique" UNIQUE("firm_id", "rule_key")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vat_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "firm_id" integer NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "rate_percentage" double precision NOT NULL,
  "sales_account" text,
  "purchase_account" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_editable" boolean DEFAULT true NOT NULL,
  "updated_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vat_settings_firm_code_unique" UNIQUE("firm_id", "code")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stations" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL,
  "name" text NOT NULL,
  "city" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fuel_prices" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL,
  "fuel_type" text NOT NULL,
  "unit_price" double precision NOT NULL,
  "updated_by_id" integer,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pumps" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL,
  "station_id" integer NOT NULL,
  "label" text NOT NULL,
  "fuel_type" text NOT NULL,
  "initial_index" double precision DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pump_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL,
  "pump_id" integer NOT NULL,
  "staff_user_id" integer NOT NULL,
  "shift_date" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pump_shifts" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL,
  "station_id" integer,
  "cash_register_id" integer,
  "pump_label" text NOT NULL,
  "fuel_type" text NOT NULL,
  "index_start" double precision NOT NULL,
  "index_end" double precision NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "unit_price" double precision,
  "payment_method" text,
  "expected_amount" integer,
  "declared_physical_amount" integer,
  "discrepancy_amount" integer,
  "cash_amount" integer,
  "wave_amount" integer,
  "orange_money_amount" integer,
  "mtn_momo_amount" integer,
  "transaction_id" integer,
  "discrepancy_transaction_id" integer,
  "opened_by_id" integer,
  "validated_by_id" integer,
  "validated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mobile_money_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "firm_id" integer NOT NULL,
  "client_id" integer NOT NULL,
  "provider" text NOT NULL,
  "account_number" text NOT NULL,
  "label" text,
  "is_active" text DEFAULT 'true' NOT NULL,
  "balance" integer DEFAULT 0 NOT NULL,
  "created_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mobile_money_accounts_client_provider_number_unique" UNIQUE("client_id", "provider", "account_number")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mobile_money_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "firm_id" integer NOT NULL,
  "client_id" integer NOT NULL,
  "mobile_money_account_id" integer NOT NULL,
  "invoice_id" integer,
  "transaction_id" integer,
  "parent_mobile_money_transaction_id" integer,
  "type" text NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "amount" integer NOT NULL,
  "fee_amount" integer DEFAULT 0 NOT NULL,
  "reference_code" text,
  "label" text NOT NULL,
  "date" timestamp with time zone NOT NULL,
  "created_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "purchases" (
  "id" serial PRIMARY KEY NOT NULL,
  "firm_id" integer NOT NULL,
  "client_id" integer NOT NULL,
  "supplier_name" text NOT NULL,
  "supplier_ncc" text,
  "invoice_ref" text,
  "category_key" text NOT NULL,
  "charge_account" text NOT NULL,
  "charge_name" text NOT NULL,
  "date" timestamp with time zone NOT NULL,
  "amount_ht" integer NOT NULL,
  "vat_rate" integer DEFAULT 0 NOT NULL,
  "vat_amount" integer DEFAULT 0 NOT NULL,
  "aib_rate" integer DEFAULT 0 NOT NULL,
  "aib_amount" integer DEFAULT 0 NOT NULL,
  "amount_ttc" integer NOT NULL,
  "payment_mode" text NOT NULL,
  "mobile_money_account_id" integer,
  "notes" text,
  "receipt_file_name" text,
  "receipt_mime_type" text,
  "receipt_file_data" text,
  "status" text DEFAULT 'settled' NOT NULL,
  "review_status" text DEFAULT 'en_attente' NOT NULL,
  "is_lettre" boolean DEFAULT false NOT NULL,
  "validated_by_id" integer,
  "validated_at" timestamp with time zone,
  "corrected_charge_account" text,
  "corrected_charge_name" text,
  "transaction_id" integer,
  "settlement_transaction_id" integer,
  "settled_at" timestamp with time zone,
  "created_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "subscription_licenses" (
  "id" serial PRIMARY KEY NOT NULL,
  "firm_id" integer NOT NULL,
  "license_key" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "tier" text NOT NULL,
  "start_date" timestamp with time zone NOT NULL,
  "end_date" timestamp with time zone NOT NULL,
  "price_paid" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_by_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_licenses_key_unique" UNIQUE("license_key")
);
--> statement-breakpoint

-- ─── Clés étrangères (safe : ignore si déjà présentes) ───────────────────────

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_station_id_stations_id_fk"
    FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_station_id_stations_id_fk"
    FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_updated_by_id_users_id_fk"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vat_settings" ADD CONSTRAINT "vat_settings_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vat_settings" ADD CONSTRAINT "vat_settings_updated_by_id_users_id_fk"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stations" ADD CONSTRAINT "stations_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_updated_by_id_users_id_fk"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pumps" ADD CONSTRAINT "pumps_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pumps" ADD CONSTRAINT "pumps_station_id_stations_id_fk"
    FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_assignments" ADD CONSTRAINT "pump_assignments_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_assignments" ADD CONSTRAINT "pump_assignments_pump_id_pumps_id_fk"
    FOREIGN KEY ("pump_id") REFERENCES "pumps"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_assignments" ADD CONSTRAINT "pump_assignments_staff_user_id_users_id_fk"
    FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_station_id_stations_id_fk"
    FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_cash_register_id_cash_registers_id_fk"
    FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_transaction_id_transactions_id_fk"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_opened_by_id_users_id_fk"
    FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_validated_by_id_users_id_fk"
    FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_mobile_money_account_id_mobile_money_accounts_id_fk"
    FOREIGN KEY ("mobile_money_account_id") REFERENCES "mobile_money_accounts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_transaction_id_transactions_id_fk"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "purchases" ADD CONSTRAINT "purchases_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "purchases" ADD CONSTRAINT "purchases_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "purchases" ADD CONSTRAINT "purchases_mobile_money_account_id_mobile_money_accounts_id_fk"
    FOREIGN KEY ("mobile_money_account_id") REFERENCES "mobile_money_accounts"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "purchases" ADD CONSTRAINT "purchases_validated_by_id_users_id_fk"
    FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "purchases" ADD CONSTRAINT "purchases_transaction_id_transactions_id_fk"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "subscription_licenses" ADD CONSTRAINT "subscription_licenses_firm_id_firms_id_fk"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "subscription_licenses" ADD CONSTRAINT "subscription_licenses_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ─── Index ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "transactions_station_id_idx" ON "transactions" USING btree ("station_id");
