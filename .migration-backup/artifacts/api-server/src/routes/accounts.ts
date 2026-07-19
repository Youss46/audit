import { Router, type IRouter } from "express";
import { ilike, or, asc } from "drizzle-orm";
import { db, accountsTable } from "@workspace/db";
import { ListAccountsQueryParams, ListAccountsResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

// Read-only lookup over the shared SYSCOHADA Plan Comptable, used by
// account-number autocomplete inputs (e.g. the "Saisie de la Balance
// d'Entrée" grid for a Reprise de dossier client). The chart of accounts
// itself is not tenant-scoped -- it's standardized across every firm -- so
// no firmId filtering applies here.
const router: IRouter = Router();

router.use(requireAuth);

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

export default router;
