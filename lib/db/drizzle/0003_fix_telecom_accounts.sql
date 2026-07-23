-- Migration 0003 — Correct SYSCOHADA 62x account numbers
--
-- Root cause: the seed incorrectly placed "Frais de télécommunications" under
-- account 626 and labelled 628 as "Autres charges externes". In the official
-- SYSCOHADA révisé 2018 chart (Côte d'Ivoire):
--   626 = Études, recherches et documentation
--   628 = Frais de télécommunications  (6281=téléphone, 6282=postaux, 6283=internet)
--   658 = Charges diverses  ← correct home for "autres charges"
--
-- This migration corrects both the accounts table and the transaction_categories
-- default account numbers for the running database.

-- ── 1. Fix 626 family: rename to Études et recherches ───────────────────────
UPDATE accounts
SET    name = 'Études, recherches et documentation'
WHERE  account_number = '626';

UPDATE accounts
SET    name = 'Études et recherches — sous-compte'
WHERE  account_number = '6261';

UPDATE accounts
SET    name = 'Études, recherches et documentation — compte principal'
WHERE  account_number = '626100';

-- ── 2. Fix 628 family: rename to Frais de télécommunications ────────────────
UPDATE accounts
SET    name = 'Frais de télécommunications'
WHERE  account_number = '628';

UPDATE accounts
SET    name = 'Frais de télécommunications — compte principal'
WHERE  account_number = '628100';

-- ── 3. Add sub-accounts 6281 / 6282 / 6283 if not yet present ───────────────
-- Note: account_type is omitted — the column may not exist in older installs
-- (it is nullable, so the rows are valid without it).
INSERT INTO accounts (account_number, name, account_class, created_at)
VALUES
  ('6281', 'Frais de téléphone',                   6, NOW()),
  ('6282', 'Frais postaux et d''affranchissement',  6, NOW()),
  ('6283', 'Frais Internet et réseaux numériques',  6, NOW())
ON CONFLICT (account_number) DO UPDATE
  SET name = EXCLUDED.name;

-- ── 4. Fix transaction_categories default account numbers (if table exists) ──
-- The table may not be present on installations where the seed hasn't run yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public'
      AND  table_name   = 'transaction_categories'
  ) THEN
    -- telephone_internet: was 626100 (wrong) → 628100 (Frais de télécoms)
    UPDATE transaction_categories
    SET    default_account_number = '628100'
    WHERE  key = 'telephone_internet'
      AND  default_account_number = '626100';

    -- autres_achats: was 628100 (now telecoms) → 658100 (Charges diverses)
    UPDATE transaction_categories
    SET    default_account_number = '658100'
    WHERE  key = 'autres_achats'
      AND  default_account_number = '628100';
  END IF;
END $$;
