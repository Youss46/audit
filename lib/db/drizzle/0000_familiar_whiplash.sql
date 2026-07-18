CREATE TABLE "firms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"subscription_tier" text DEFAULT 'basic' NOT NULL,
	"max_pme_allowed" integer DEFAULT 5 NOT NULL,
	"contact_email" text,
	"contact_name" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer,
	"role_id" integer,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"requires_password_change" boolean DEFAULT true NOT NULL,
	"temporary_password_plain" text,
	"station_id" integer,
	"associated_cash_account_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"name" text NOT NULL,
	"legal_form" text NOT NULL,
	"sector" text NOT NULL,
	"rccm" text,
	"tax_id" text,
	"address" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"annual_turnover" double precision,
	"accounting_system" text,
	"tax_regime" text DEFAULT 'REEL_NORMAL' NOT NULL,
	"is_vat_registered" boolean DEFAULT true NOT NULL,
	"capital_social" integer DEFAULT 0 NOT NULL,
	"capital_deposited" boolean DEFAULT true NOT NULL,
	"is_reprise" boolean DEFAULT false NOT NULL,
	"is_capital_initialized" boolean DEFAULT false NOT NULL,
	"mission_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"accounting_system" text NOT NULL,
	"status" text DEFAULT 'en_attente' NOT NULL,
	"visa_stamp_code" text,
	"visa_issued_at" timestamp with time zone,
	"created_by_id" integer,
	"assigned_to_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"order_index" integer NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'a_verifier' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"mission_id" integer,
	"folder_id" integer,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_data" text NOT NULL,
	"uploaded_by_id" integer,
	"is_archived" boolean DEFAULT false NOT NULL,
	"fiscal_year" integer,
	"folder_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"parent_folder_id" integer,
	"name" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"fiscal_year" integer,
	"folder_category" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_number" text NOT NULL,
	"name" text NOT NULL,
	"account_class" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_account_number_unique" UNIQUE("account_number")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"account_number" text NOT NULL,
	"debit_amount" integer DEFAULT 0 NOT NULL,
	"credit_amount" integer DEFAULT 0 NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"label" text NOT NULL,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"category" text,
	"payment_type" text DEFAULT 'cash' NOT NULL,
	"payment_method" text,
	"due_date" timestamp with time zone,
	"status" text DEFAULT 'a_valider' NOT NULL,
	"source" text NOT NULL,
	"document_id" integer,
	"clarification_note" text,
	"settled_at" timestamp with time zone,
	"parent_transaction_id" integer,
	"cash_register_id" integer,
	"station_id" integer,
	"created_by_id" integer,
	"validated_by_id" integer,
	"validated_at" timestamp with time zone,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supplier_name" text,
	"supplier_ncc" text,
	"invoice_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_registers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_id" integer NOT NULL,
	"current_balance" integer DEFAULT 0 NOT NULL,
	"syscohada_account" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"owner_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_registers_client_account_unique" UNIQUE("client_id","syscohada_account")
);
--> statement-breakpoint
CREATE TABLE "daily_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"cash_register_id" integer NOT NULL,
	"date" text NOT NULL,
	"opening_balance" integer NOT NULL,
	"expected_closing_balance" integer,
	"physical_closing_balance" integer,
	"discrepancy_amount" integer,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"comment" text,
	"closed_by_id" integer,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_closures_register_date_unique" UNIQUE("cash_register_id","date")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"user_id" integer,
	"user_name" text,
	"user_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" text,
	"changes_payload" jsonb,
	"ip_address" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_depreciation_postings_asset_year_unique" UNIQUE("asset_id","fiscal_year")
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"account_number" text NOT NULL,
	"label" text NOT NULL,
	"acquisition_date" timestamp with time zone NOT NULL,
	"acquisition_cost" integer NOT NULL,
	"depreciation_type" text DEFAULT 'LINEAIRE',
	"useful_life_years" integer,
	"salvage_value" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIF' NOT NULL,
	"synced_from_transaction_id" integer,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_assets_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"type" text NOT NULL,
	"account_number" text NOT NULL,
	"label" text NOT NULL,
	"principal_amount" integer NOT NULL,
	"annual_interest_rate" double precision DEFAULT 0 NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"term_months" integer NOT NULL,
	"payment_frequency" text DEFAULT 'MENSUEL' NOT NULL,
	"status" text DEFAULT 'ACTIF' NOT NULL,
	"installments_posted" integer DEFAULT 0 NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_year_closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"year" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"net_result" integer,
	"net_result_account" text,
	"opening_balance_generated" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_year_closings_firm_client_year_unique" UNIQUE("firm_id","client_id","year")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"cnps_number" text,
	"marital_status" text DEFAULT 'CELIBATAIRE' NOT NULL,
	"dependent_children" integer DEFAULT 0 NOT NULL,
	"base_salary" integer NOT NULL,
	"transport_allowance" integer DEFAULT 0 NOT NULL,
	"other_taxable_primes" integer DEFAULT 0 NOT NULL,
	"work_accident_rate" double precision DEFAULT 2 NOT NULL,
	"hire_date" date,
	"status" text DEFAULT 'ACTIF' NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"period" text NOT NULL,
	"gross_salary" integer NOT NULL,
	"gross_taxable" integer NOT NULL,
	"cnps_employee_amount" integer NOT NULL,
	"is_amount" integer NOT NULL,
	"cn_amount" integer NOT NULL,
	"its_amount" integer NOT NULL,
	"net_salary" integer NOT NULL,
	"cnps_employer_retraite" integer NOT NULL,
	"cnps_employer_prestations_familiales" integer NOT NULL,
	"cnps_employer_accident_travail" integer NOT NULL,
	"taxe_apprentissage" integer NOT NULL,
	"taxe_formation_continue" integer NOT NULL,
	"total_employer_cost" integer NOT NULL,
	"prime_anciennete" integer DEFAULT 0 NOT NULL,
	"fiscal_parts" double precision NOT NULL,
	"posted_transaction_id" integer,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_employee_period_unique" UNIQUE("employee_id","period")
);
--> statement-breakpoint
CREATE TABLE "vat_declarations" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"period" text NOT NULL,
	"ca_ht_18" integer NOT NULL,
	"ca_ht_9" integer NOT NULL,
	"ca_exoneree" integer NOT NULL,
	"ca_export" integer NOT NULL,
	"tva_collectee_18" integer NOT NULL,
	"tva_collectee_9" integer NOT NULL,
	"tva_deductible_immo" integer NOT NULL,
	"tva_deductible_biens_services" integer NOT NULL,
	"credit_anterieur_reporte" integer DEFAULT 0 NOT NULL,
	"tva_nette_a_payer" integer DEFAULT 0 NOT NULL,
	"credit_a_nouveau_reporter" integer DEFAULT 0 NOT NULL,
	"posted_transaction_id" integer,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_declarations_firm_client_period_unique" UNIQUE("firm_id","client_id","period")
);
--> statement-breakpoint
CREATE TABLE "cabinet_user_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"hourly_cost_rate" double precision NOT NULL,
	"billing_hourly_rate" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cabinet_user_rates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "client_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"monthly_flat_fee" double precision NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"duration_hours" double precision NOT NULL,
	"task_type" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytical_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"journal_line_id" integer NOT NULL,
	"analytical_code_id" integer NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"percentage" double precision NOT NULL,
	"allocated_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytical_axes" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytical_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"axis_id" integer NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytical_codes_axis_code_unique" UNIQUE("axis_id","code")
);
--> statement-breakpoint
CREATE TABLE "dsf_mapping_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_type" text NOT NULL,
	"line_code" text NOT NULL,
	"line_label" text NOT NULL,
	"account_patterns" text NOT NULL,
	"operation" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dsf_mapping_rules_statement_line_unique" UNIQUE("statement_type","line_code")
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_type" text NOT NULL,
	"title" text NOT NULL,
	"content_html" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_title_unique" UNIQUE("title")
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"template_type" text NOT NULL,
	"year" integer NOT NULL,
	"title" text NOT NULL,
	"content_html" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collaboration_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_by_id" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_threads_target_unique" UNIQUE("firm_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "contextual_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"message" text NOT NULL,
	"attachment_file_name" text,
	"attachment_mime_type" text,
	"attachment_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"link_to_route" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_valuations" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"year" integer NOT NULL,
	"ebitda_multiplier_value" integer NOT NULL,
	"equity_value" integer NOT NULL,
	"ebitda_multiplier_used" double precision NOT NULL,
	"capitalization_rate_used" double precision NOT NULL,
	"custom_comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_valuations_client_year_unique" UNIQUE("client_id","year")
);
--> statement-breakpoint
CREATE TABLE "financial_scoring_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"year" integer NOT NULL,
	"z_score" double precision NOT NULL,
	"solvency_ratio" double precision NOT NULL,
	"debt_to_equity" double precision NOT NULL,
	"net_working_capital" integer NOT NULL,
	"return_on_equity" double precision NOT NULL,
	"current_ratio" double precision NOT NULL,
	"risk_category" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_scoring_results_client_year_unique" UNIQUE("client_id","year")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"designation" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"vat_rate" integer DEFAULT 18 NOT NULL,
	"total_item_ht" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"invoice_number" text,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"customer_address" text,
	"subtotal_ht" integer DEFAULT 0 NOT NULL,
	"vat_rate" integer DEFAULT 18 NOT NULL,
	"vat_amount" integer DEFAULT 0 NOT NULL,
	"total_ttc" integer DEFAULT 0 NOT NULL,
	"invoice_date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"status" text DEFAULT 'BROUILLON' NOT NULL,
	"notes" text,
	"pdf_document_id" integer,
	"posted_transaction_id" integer,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_channel_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_channel_members_unique" UNIQUE("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_channel_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"firm_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"message_text" text NOT NULL,
	"attachment_file_name" text,
	"attachment_mime_type" text,
	"attachment_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_channels_firm_name_unique" UNIQUE("firm_id","name")
);
--> statement-breakpoint
CREATE TABLE "chat_direct_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"message_text" text NOT NULL,
	"attachment_file_name" text,
	"attachment_mime_type" text,
	"attachment_data" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
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
	CONSTRAINT "payroll_settings_firm_rule_unique" UNIQUE("firm_id","rule_key")
);
--> statement-breakpoint
CREATE TABLE "vat_settings" (
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
	CONSTRAINT "vat_settings_firm_code_unique" UNIQUE("firm_id","code")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"fuel_type" text NOT NULL,
	"unit_price" double precision NOT NULL,
	"updated_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pump_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"pump_id" integer NOT NULL,
	"staff_user_id" integer NOT NULL,
	"shift_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pump_shifts" (
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
CREATE TABLE "pumps" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"station_id" integer NOT NULL,
	"label" text NOT NULL,
	"fuel_type" text NOT NULL,
	"initial_index" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_money_accounts" (
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
	CONSTRAINT "mobile_money_accounts_client_provider_number_unique" UNIQUE("client_id","provider","account_number")
);
--> statement-breakpoint
CREATE TABLE "mobile_money_transactions" (
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
CREATE TABLE "purchases" (
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
CREATE TABLE "subscription_licenses" (
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
ALTER TABLE "users" ADD CONSTRAINT "users_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_parent_transaction_id_transactions_id_fk" FOREIGN KEY ("parent_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cash_register_id_cash_registers_id_fk" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_registers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_validated_by_id_users_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closures" ADD CONSTRAINT "daily_closures_cash_register_id_cash_registers_id_fk" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_registers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closures" ADD CONSTRAINT "daily_closures_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_postings" ADD CONSTRAINT "asset_depreciation_postings_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_assets_loans" ADD CONSTRAINT "financial_assets_loans_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_assets_loans" ADD CONSTRAINT "financial_assets_loans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_assets_loans" ADD CONSTRAINT "financial_assets_loans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_locked_by_id_users_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_posted_transaction_id_transactions_id_fk" FOREIGN KEY ("posted_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_declarations" ADD CONSTRAINT "vat_declarations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_declarations" ADD CONSTRAINT "vat_declarations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_declarations" ADD CONSTRAINT "vat_declarations_posted_transaction_id_transactions_id_fk" FOREIGN KEY ("posted_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_declarations" ADD CONSTRAINT "vat_declarations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cabinet_user_rates" ADD CONSTRAINT "cabinet_user_rates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cabinet_user_rates" ADD CONSTRAINT "cabinet_user_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_allocations" ADD CONSTRAINT "analytical_allocations_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_allocations" ADD CONSTRAINT "analytical_allocations_analytical_code_id_analytical_codes_id_fk" FOREIGN KEY ("analytical_code_id") REFERENCES "public"."analytical_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_allocations" ADD CONSTRAINT "analytical_allocations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_allocations" ADD CONSTRAINT "analytical_allocations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_axes" ADD CONSTRAINT "analytical_axes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_axes" ADD CONSTRAINT "analytical_axes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_codes" ADD CONSTRAINT "analytical_codes_axis_id_analytical_axes_id_fk" FOREIGN KEY ("axis_id") REFERENCES "public"."analytical_axes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_codes" ADD CONSTRAINT "analytical_codes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytical_codes" ADD CONSTRAINT "analytical_codes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_threads" ADD CONSTRAINT "collaboration_threads_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_threads" ADD CONSTRAINT "collaboration_threads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_threads" ADD CONSTRAINT "collaboration_threads_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_comments" ADD CONSTRAINT "contextual_comments_thread_id_collaboration_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."collaboration_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_comments" ADD CONSTRAINT "contextual_comments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_comments" ADD CONSTRAINT "contextual_comments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_comments" ADD CONSTRAINT "contextual_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_valuations" ADD CONSTRAINT "business_valuations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_valuations" ADD CONSTRAINT "business_valuations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_scoring_results" ADD CONSTRAINT "financial_scoring_results_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_scoring_results" ADD CONSTRAINT "financial_scoring_results_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pdf_document_id_documents_id_fk" FOREIGN KEY ("pdf_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_messages" ADD CONSTRAINT "chat_channel_messages_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_messages" ADD CONSTRAINT "chat_channel_messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_messages" ADD CONSTRAINT "chat_channel_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_direct_messages" ADD CONSTRAINT "chat_direct_messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_direct_messages" ADD CONSTRAINT "chat_direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_direct_messages" ADD CONSTRAINT "chat_direct_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_settings" ADD CONSTRAINT "vat_settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_settings" ADD CONSTRAINT "vat_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_assignments" ADD CONSTRAINT "pump_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_assignments" ADD CONSTRAINT "pump_assignments_pump_id_pumps_id_fk" FOREIGN KEY ("pump_id") REFERENCES "public"."pumps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_assignments" ADD CONSTRAINT "pump_assignments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_cash_register_id_cash_registers_id_fk" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_registers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_discrepancy_transaction_id_transactions_id_fk" FOREIGN KEY ("discrepancy_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pump_shifts" ADD CONSTRAINT "pump_shifts_validated_by_id_users_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_mobile_money_account_id_mobile_money_accounts_id_fk" FOREIGN KEY ("mobile_money_account_id") REFERENCES "public"."mobile_money_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money_transactions" ADD CONSTRAINT "mobile_money_transactions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_mobile_money_account_id_mobile_money_accounts_id_fk" FOREIGN KEY ("mobile_money_account_id") REFERENCES "public"."mobile_money_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_validated_by_id_users_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_settlement_transaction_id_transactions_id_fk" FOREIGN KEY ("settlement_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_licenses" ADD CONSTRAINT "subscription_licenses_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_licenses" ADD CONSTRAINT "subscription_licenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roles_code_idx" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "users_firm_id_idx" ON "users" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "users_role_id_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "clients_firm_id_idx" ON "clients" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "missions_firm_id_idx" ON "missions" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "missions_client_id_idx" ON "missions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "documents_firm_id_idx" ON "documents" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "documents_client_id_idx" ON "documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "documents_folder_id_idx" ON "documents" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "document_folders_firm_id_idx" ON "document_folders" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "document_folders_client_id_idx" ON "document_folders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "document_folders_parent_folder_id_idx" ON "document_folders" USING btree ("parent_folder_id");--> statement-breakpoint
CREATE INDEX "journal_lines_transaction_id_idx" ON "journal_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_firm_id_idx" ON "transactions" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "transactions_client_id_idx" ON "transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transactions_cash_register_id_idx" ON "transactions" USING btree ("cash_register_id");--> statement-breakpoint
CREATE INDEX "transactions_station_id_idx" ON "transactions" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "audit_logs_firm_id_idx" ON "audit_logs" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "asset_depreciation_postings_asset_id_idx" ON "asset_depreciation_postings" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_firm_id_idx" ON "fixed_assets" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_client_id_idx" ON "fixed_assets" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "financial_assets_loans_firm_id_idx" ON "financial_assets_loans" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "financial_assets_loans_client_id_idx" ON "financial_assets_loans" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "financial_assets_loans_type_idx" ON "financial_assets_loans" USING btree ("type");--> statement-breakpoint
CREATE INDEX "financial_assets_loans_status_idx" ON "financial_assets_loans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fiscal_year_closings_client_id_idx" ON "fiscal_year_closings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "fiscal_year_closings_firm_id_idx" ON "fiscal_year_closings" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "employees_firm_id_idx" ON "employees" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "employees_client_id_idx" ON "employees" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payslips_firm_id_idx" ON "payslips" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "payslips_client_id_idx" ON "payslips" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "payslips_employee_id_idx" ON "payslips" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payslips_period_idx" ON "payslips" USING btree ("period");--> statement-breakpoint
CREATE INDEX "vat_declarations_firm_id_idx" ON "vat_declarations" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "vat_declarations_client_id_idx" ON "vat_declarations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "vat_declarations_period_idx" ON "vat_declarations" USING btree ("period");--> statement-breakpoint
CREATE INDEX "cabinet_user_rates_firm_id_idx" ON "cabinet_user_rates" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "client_contracts_firm_id_idx" ON "client_contracts" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "client_contracts_client_id_idx" ON "client_contracts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "timesheet_entries_firm_id_idx" ON "timesheet_entries" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "timesheet_entries_user_id_idx" ON "timesheet_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "timesheet_entries_client_id_idx" ON "timesheet_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "timesheet_entries_date_idx" ON "timesheet_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "analytical_alloc_journal_line_id_idx" ON "analytical_allocations" USING btree ("journal_line_id");--> statement-breakpoint
CREATE INDEX "analytical_alloc_code_id_idx" ON "analytical_allocations" USING btree ("analytical_code_id");--> statement-breakpoint
CREATE INDEX "analytical_alloc_firm_id_idx" ON "analytical_allocations" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "analytical_alloc_client_id_idx" ON "analytical_allocations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "analytical_axes_firm_id_idx" ON "analytical_axes" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "analytical_axes_client_id_idx" ON "analytical_axes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "analytical_codes_axis_id_idx" ON "analytical_codes" USING btree ("axis_id");--> statement-breakpoint
CREATE INDEX "analytical_codes_firm_id_idx" ON "analytical_codes" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "analytical_codes_client_id_idx" ON "analytical_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "dsf_mapping_rules_statement_type_idx" ON "dsf_mapping_rules" USING btree ("statement_type");--> statement-breakpoint
CREATE INDEX "document_templates_type_idx" ON "document_templates" USING btree ("template_type");--> statement-breakpoint
CREATE INDEX "generated_documents_firm_client_idx" ON "generated_documents" USING btree ("firm_id","client_id");--> statement-breakpoint
CREATE INDEX "generated_documents_client_year_idx" ON "generated_documents" USING btree ("client_id","year");--> statement-breakpoint
CREATE INDEX "collaboration_threads_client_id_idx" ON "collaboration_threads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contextual_comments_thread_id_idx" ON "contextual_comments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "contextual_comments_target_idx" ON "contextual_comments" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_idx" ON "notifications" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "business_valuations_client_id_idx" ON "business_valuations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "financial_scoring_results_client_id_idx" ON "financial_scoring_results" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_firm_id_idx" ON "invoices" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "invoices_client_id_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_channel_members_user_id_idx" ON "chat_channel_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_channel_messages_channel_id_idx" ON "chat_channel_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_channels_firm_id_idx" ON "chat_channels" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "chat_direct_messages_sender_recipient_idx" ON "chat_direct_messages" USING btree ("sender_id","recipient_id");--> statement-breakpoint
CREATE INDEX "chat_direct_messages_recipient_sender_idx" ON "chat_direct_messages" USING btree ("recipient_id","sender_id");--> statement-breakpoint
CREATE INDEX "payroll_settings_firm_id_idx" ON "payroll_settings" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "vat_settings_firm_id_idx" ON "vat_settings" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "mobile_money_accounts_client_id_idx" ON "mobile_money_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mobile_money_transactions_account_id_idx" ON "mobile_money_transactions" USING btree ("mobile_money_account_id");--> statement-breakpoint
CREATE INDEX "mobile_money_transactions_client_id_idx" ON "mobile_money_transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mobile_money_transactions_invoice_id_idx" ON "mobile_money_transactions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "purchases_client_id_idx" ON "purchases" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "purchases_status_idx" ON "purchases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchases_review_status_idx" ON "purchases" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "purchases_date_idx" ON "purchases" USING btree ("date");--> statement-breakpoint
CREATE INDEX "subscription_licenses_firm_id_idx" ON "subscription_licenses" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "subscription_licenses_status_idx" ON "subscription_licenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_licenses_end_date_idx" ON "subscription_licenses" USING btree ("end_date");