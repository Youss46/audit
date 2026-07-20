import { Router, type IRouter } from "express";
import { ilike, or, asc, eq } from "drizzle-orm";
import { db, accountsTable, transactionCategoriesTable } from "@workspace/db";
import { ListAccountsQueryParams, ListAccountsResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { imputeAccount } from "../lib/imputation-engine";
import { z } from "zod/v4";

// Read-only lookup over the shared SYSCOHADA Plan Comptable, used by
// account-number autocomplete inputs and the auto-imputation service.
// The chart of accounts is not tenant-scoped — standardized by SYSCOHADA.
const router: IRouter = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /accounts — recherche dans le Plan Comptable (autocomplétion)
// ---------------------------------------------------------------------------
router.get("/accounts", async (req, res) => {
  const { search } = ListAccountsQueryParams.parse(req.query);

  const accounts = await db.query.accountsTable.findMany({
    where: search
      ? or(
          ilike(accountsTable.accountNumber, `${search}%`),
          ilike(accountsTable.name, `%${search}%`),
        )
      : undefined,
    orderBy: [asc(accountsTable.accountNumber)],
    limit: 50,
  });

  res.json(
    ListAccountsResponse.parse(
      accounts.map((a) => ({
        accountNumber: a.accountNumber,
        name: a.name,
        accountClass: a.accountClass,
      })),
    ),
  );
});

// ---------------------------------------------------------------------------
// GET /accounts/categories — référentiel des catégories de transactions
// Lecture depuis transaction_categories (DB), avec repli sur liste vide.
// ---------------------------------------------------------------------------
router.get("/accounts/categories", async (_req, res) => {
  const rows = await db
    .select()
    .from(transactionCategoriesTable)
    .where(eq(transactionCategoriesTable.isHidden, false))
    .orderBy(asc(transactionCategoriesTable.key));

  res.json(
    rows.map((r) => ({
      key:                   r.key,
      displayName:           r.displayName,
      defaultAccountNumber:  r.defaultAccountNumber,
      defaultTvaRate:        r.defaultTvaRate,
      vatEligible:           r.vatEligible,
      transactionType:       r.transactionType,
    })),
  );
});

// ---------------------------------------------------------------------------
// POST /accounts/impute — imputation automatique SYSCOHADA
//
// Corps :
//   { categoryKey?, paymentMethod?, mmProvider?, transactionType? }
//
// Réponse :
//   { debitAccount, debitLabel, creditAccount, creditLabel,
//     defaultTvaRate, vatEligible, flagForReview, source }
// ---------------------------------------------------------------------------
const ImputeBody = z.object({
  categoryKey:     z.string().optional().nullable(),
  paymentMethod:   z.enum(["especes", "mobile_money", "cheque", "virement"]).optional().nullable(),
  mmProvider:      z.string().optional().nullable(),
  transactionType: z.enum(["depense", "recette"]).optional().nullable(),
});

router.post("/accounts/impute", async (req, res) => {
  const input = ImputeBody.parse(req.body);

  const result = await imputeAccount({
    categoryKey:     input.categoryKey,
    paymentMethod:   input.paymentMethod,
    mmProvider:      input.mmProvider,
    transactionType: input.transactionType,
  });

  res.json(result);
});

export default router;
