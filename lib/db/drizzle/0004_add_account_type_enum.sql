-- Migration 0004 : create the account_type pg enum and add the column to accounts.
--
-- Context: the enum was defined in the Drizzle schema (accounting.ts) and created
-- locally via `drizzle-kit push` but was NEVER captured in a migration file.
-- Railway databases that were bootstrapped via migrations therefore do not have
-- the enum type nor the column, causing seedPlanComptable() to fail and leaving
-- the accounts table empty (no 612, 621, etc.).
--
-- All statements are idempotent: EXCEPTION / IF NOT EXISTS guards make it safe
-- to run against a DB that already has the enum and column.

DO $$ BEGIN
  CREATE TYPE "public"."account_type" AS ENUM(
    'CAPITAL',
    'IMMOBILISATION',
    'STOCK',
    'TIERS',
    'TRESORERIE',
    'CHARGE',
    'PRODUIT',
    'HAO',
    'ATTENTE',
    'ANALYTIQUE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "account_type" "account_type";
