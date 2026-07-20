---
name: SYSCOHADA chart & imputation engine
description: Comment le plan comptable, les catégories et l'imputation automatique sont structurés en base et dans l'API.
---

## Tables
- `accounts` — plan comptable SYSCOHADA (221 comptes, Classes 1–8). Colonnes : accountNumber (unique), name, accountClass, **accountType** (pgEnum nullable : CAPITAL, IMMOBILISATION, STOCK, TIERS, TRESORERIE, CHARGE, PRODUIT, HAO, ATTENTE).
- `transaction_categories` — référentiel des catégories (32 entrées, 28 visibles). Colonnes : key (PK), displayName, defaultAccountNumber, defaultTvaRate, vatEligible, transactionType, isHidden.

## Seed
- `lib/db/src/seed-syscohada.ts` — seed maître (seedPlanComptable + seedTransactionCategories). Script : `pnpm --filter @workspace/db seed:syscohada`.
- Intégré dans `seed-all.ts` (appelé avant seedAccounts pour upsert complet).

## Service d'imputation
- `artifacts/api-server/src/lib/imputation-engine.ts` — `imputeAccount({ categoryKey?, paymentMethod?, mmProvider?, transactionType? })`
- Résolution : 1) DB (transaction_categories) → 2) PURCHASE_CATEGORIES statique → 3) CATEGORY_RULES statique → 4) compte 471 (flagForReview: true).
- Retourne : { debitAccount, debitLabel, creditAccount, creditLabel, defaultTvaRate, vatEligible, flagForReview, source }.

## Routes API
- GET /accounts — autocomplétion plan comptable (existant, inchangé).
- GET /accounts/categories — catégories depuis DB (nouvelle, dans accounts.ts).
- POST /accounts/impute — imputation automatique (nouvelle, dans accounts.ts).
- GET /purchases/categories — lit transaction_categories en DB, repli statique si vide.

## UI Cabinet
- `artifacts/m15-audit/src/components/comptabilite/AccountCombobox.tsx` — combobox Popover+Command avec recherche live via useListAccounts. Remplace le plain Input dans la grille d'édition des écritures (comptabilite-cabinet.tsx).

**Why:** Le plan comptable statique dans accounting-engine.ts ne permettait pas d'extension sans déploiement ; la table DB permet au Cabinet d'ajouter des catégories sans redéployer.
