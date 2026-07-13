// Module M3 (Comptabilité & Travaux - Reporting) / P4 (Pilotage Dirigeant):
// pure aggregation functions that turn the validated general ledger
// (journal lines booked by the module P3/M3 matching engine) into the
// three standard SYSCOHADA financial statements plus the PME director's
// plain-language pilotage dashboard.
//
// Deliberately framework-free and side-effect-free: routes/reporting.ts is
// responsible for fetching rows from Postgres and calling into here, so
// every algorithm below can be unit-tested without a database.

// One validated journal line, enriched with the account's chart-of-accounts
// metadata and the date of its parent transaction (needed to split
// "solde initial" from "mouvements de l'exercice").
export interface LedgerLine {
  accountNumber: string;
  accountName: string;
  accountClass: number;
  debitAmount: number;
  creditAmount: number;
  transactionDate: Date;
  transactionType: "recette" | "depense";
  category: string | null;
  // The journal line's own label if the matching engine set one, otherwise
  // the parent transaction's plain-language label -- always a display-ready
  // string for the Grand Livre / Journaux views.
  label: string;
}

export type BalanceSide = "debiteur" | "crediteur";

export interface BalanceRow {
  accountNumber: string;
  accountName: string;
  accountClass: number;
  initialBalance: number;
  totalDebit: number;
  totalCredit: number;
  finalBalance: number;
  finalBalanceSide: BalanceSide;
}

// "Solde débiteur/créditeur" convention: an account's natural balance is
// (total debit - total credit). A positive net is a "solde débiteur", a
// negative net is a "solde créditeur" (displayed as its absolute value in
// the crediteur column). This holds for every SYSCOHADA class -- it's just
// a sign convention, not a judgement about which side is "normal" for a
// given class.
function signedBalance(debit: number, credit: number): { amount: number; side: BalanceSide } {
  const net = debit - credit;
  return net >= 0 ? { amount: net, side: "debiteur" } : { amount: -net, side: "crediteur" };
}

// La Balance des Comptes: one row per SYSCOHADA account, grouped for the
// requested fiscal year. `initialBalance` is the running balance carried in
// from every validated line dated strictly before `yearStart` -- so the
// balance stays correct even without a dedicated "opening balance" ledger
// entry per fiscal year.
export function computeBalanceDesComptes(
  lines: LedgerLine[],
  yearStart: Date,
  yearEndExclusive: Date,
): BalanceRow[] {
  const byAccount = new Map<
    string,
    { accountName: string; accountClass: number; initialNet: number; debit: number; credit: number }
  >();

  for (const line of lines) {
    if (line.transactionDate >= yearEndExclusive) continue;
    let entry = byAccount.get(line.accountNumber);
    if (!entry) {
      entry = {
        accountName: line.accountName,
        accountClass: line.accountClass,
        initialNet: 0,
        debit: 0,
        credit: 0,
      };
      byAccount.set(line.accountNumber, entry);
    }
    if (line.transactionDate < yearStart) {
      entry.initialNet += line.debitAmount - line.creditAmount;
    } else {
      entry.debit += line.debitAmount;
      entry.credit += line.creditAmount;
    }
  }

  return Array.from(byAccount.entries())
    .map(([accountNumber, entry]) => {
      const finalNet = entry.initialNet + entry.debit - entry.credit;
      const final = finalNet >= 0 ? { amount: finalNet, side: "debiteur" as BalanceSide } : { amount: -finalNet, side: "crediteur" as BalanceSide };
      return {
        accountNumber,
        accountName: entry.accountName,
        accountClass: entry.accountClass,
        initialBalance: entry.initialNet,
        totalDebit: entry.debit,
        totalCredit: entry.credit,
        finalBalance: final.amount,
        finalBalanceSide: final.side,
      };
    })
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

export interface BilanLine {
  key: string;
  label: string;
  amount: number;
}

export interface BilanResult {
  actif: BilanLine[];
  passif: BilanLine[];
  totalActif: number;
  totalPassif: number;
}

// Le Bilan Simplifié: aggregates classes 1 to 5 at the class level (not
// account-by-account) into Actif / Passif, plus the fiscal year's résultat
// net folded into Capitaux propres -- exactly how SYSCOHADA ties the bilan
// to the compte de résultat. Because every booked entry is balanced
// (sum(debit) === sum(credit) across the whole ledger), classes 1-7's net
// balances always sum to zero, so Actif and Passif always reconcile here.
export function computeBilanSimplifie(
  lines: LedgerLine[],
  yearStart: Date,
  yearEndExclusive: Date,
): BilanResult {
  const netByClass = new Map<number, number>();
  for (const line of lines) {
    if (line.transactionDate < yearStart || line.transactionDate >= yearEndExclusive) continue;
    const previous = netByClass.get(line.accountClass) ?? 0;
    netByClass.set(line.accountClass, previous + line.debitAmount - line.creditAmount);
  }
  const net = (accountClass: number) => netByClass.get(accountClass) ?? 0;

  const actif: BilanLine[] = [];
  const passif: BilanLine[] = [];

  const immobilisations = net(2);
  if (immobilisations !== 0) actif.push({ key: "immobilisations", label: "Immobilisations", amount: immobilisations });

  const stocks = net(3);
  if (stocks !== 0) actif.push({ key: "stocks", label: "Stocks", amount: stocks });

  const tiers = net(4);
  if (tiers > 0) actif.push({ key: "creances", label: "Créances (clients et comptes rattachés)", amount: tiers });
  else if (tiers < 0) passif.push({ key: "dettes", label: "Dettes (fournisseurs et comptes rattachés)", amount: -tiers });

  const tresorerie = net(5);
  if (tresorerie >= 0) actif.push({ key: "tresorerie_actif", label: "Trésorerie (banques, caisse)", amount: tresorerie });
  else passif.push({ key: "tresorerie_passif", label: "Trésorerie (découverts bancaires)", amount: -tresorerie });

  // Class 1 (capitaux) is naturally credit-heavy; -net(1) is the amount of
  // capitaux propres shown on the Passif side.
  const capitauxPropres = -net(1);
  const charges = net(6);
  const produits = -net(7);
  const resultatNet = produits - charges;

  passif.push({ key: "capitaux_propres", label: "Capitaux propres", amount: capitauxPropres });
  passif.push({ key: "resultat_net", label: "Résultat net de l'exercice", amount: resultatNet });

  const totalActif = actif.reduce((sum, l) => sum + l.amount, 0);
  const totalPassif = passif.reduce((sum, l) => sum + l.amount, 0);

  return { actif, passif, totalActif, totalPassif };
}

export interface CompteResultatLine {
  accountNumber: string;
  label: string;
  amount: number;
}

export interface CompteResultatResult {
  charges: CompteResultatLine[];
  produits: CompteResultatLine[];
  totalCharges: number;
  totalProduits: number;
  resultatNet: number;
}

// Le Compte de Résultat Simplifié: classe 6 (charges) vs classe 7
// (produits), account by account, netting straight to the résultat net
// (bénéfice or perte) for the fiscal year.
export function computeCompteDeResultat(
  lines: LedgerLine[],
  yearStart: Date,
  yearEndExclusive: Date,
): CompteResultatResult {
  const byAccount = new Map<string, { accountClass: number; accountName: string; net: number }>();

  for (const line of lines) {
    if (line.transactionDate < yearStart || line.transactionDate >= yearEndExclusive) continue;
    if (line.accountClass !== 6 && line.accountClass !== 7) continue;
    let entry = byAccount.get(line.accountNumber);
    if (!entry) {
      entry = { accountClass: line.accountClass, accountName: line.accountName, net: 0 };
      byAccount.set(line.accountNumber, entry);
    }
    entry.net += line.debitAmount - line.creditAmount;
  }

  const charges: CompteResultatLine[] = [];
  const produits: CompteResultatLine[] = [];
  for (const [accountNumber, entry] of byAccount.entries()) {
    if (entry.net === 0) continue;
    if (entry.accountClass === 6) {
      charges.push({ accountNumber, label: entry.accountName, amount: entry.net });
    } else {
      produits.push({ accountNumber, label: entry.accountName, amount: -entry.net });
    }
  }
  charges.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  produits.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

  const totalCharges = charges.reduce((sum, l) => sum + l.amount, 0);
  const totalProduits = produits.reduce((sum, l) => sum + l.amount, 0);

  return { charges, produits, totalCharges, totalProduits, resultatNet: totalProduits - totalCharges };
}

export interface GrandLivreMovement {
  date: Date;
  label: string;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
  runningBalanceSide: BalanceSide;
}

export interface GrandLivreAccount {
  accountNumber: string;
  accountName: string;
  accountClass: number;
  initialBalance: number;
  initialBalanceSide: BalanceSide;
  movements: GrandLivreMovement[];
  totalDebit: number;
  totalCredit: number;
  finalBalance: number;
  finalBalanceSide: BalanceSide;
}

// Le Grand Livre: every account touched by a validated entry, grouped with
// its full chronological history within the fiscal year and a running
// balance carried forward from the "solde initial" (every validated line
// dated strictly before yearStart) -- so the accountant can trace exactly
// how each account reached its closing balance, not just what it is.
export function computeGrandLivre(
  lines: LedgerLine[],
  yearStart: Date,
  yearEndExclusive: Date,
): GrandLivreAccount[] {
  const byAccount = new Map<
    string,
    {
      accountName: string;
      accountClass: number;
      initialNet: number;
      movements: { date: Date; label: string; debitAmount: number; creditAmount: number }[];
    }
  >();

  for (const line of lines) {
    if (line.transactionDate >= yearEndExclusive) continue;
    let entry = byAccount.get(line.accountNumber);
    if (!entry) {
      entry = { accountName: line.accountName, accountClass: line.accountClass, initialNet: 0, movements: [] };
      byAccount.set(line.accountNumber, entry);
    }
    if (line.transactionDate < yearStart) {
      entry.initialNet += line.debitAmount - line.creditAmount;
    } else {
      entry.movements.push({
        date: line.transactionDate,
        label: line.label,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
      });
    }
  }

  return Array.from(byAccount.entries())
    .map(([accountNumber, entry]) => {
      const initial = signedBalance(Math.max(entry.initialNet, 0), Math.max(-entry.initialNet, 0));
      const sortedMovements = [...entry.movements].sort((a, b) => a.date.getTime() - b.date.getTime());

      let runningNet = entry.initialNet;
      let totalDebit = 0;
      let totalCredit = 0;
      const movements: GrandLivreMovement[] = sortedMovements.map((m) => {
        runningNet += m.debitAmount - m.creditAmount;
        totalDebit += m.debitAmount;
        totalCredit += m.creditAmount;
        const running = signedBalance(Math.max(runningNet, 0), Math.max(-runningNet, 0));
        return {
          date: m.date,
          label: m.label,
          debitAmount: m.debitAmount,
          creditAmount: m.creditAmount,
          runningBalance: running.amount,
          runningBalanceSide: running.side,
        };
      });

      const final = signedBalance(Math.max(runningNet, 0), Math.max(-runningNet, 0));

      return {
        accountNumber,
        accountName: entry.accountName,
        accountClass: entry.accountClass,
        initialBalance: initial.amount,
        initialBalanceSide: initial.side,
        movements,
        totalDebit,
        totalCredit,
        finalBalance: final.amount,
        finalBalanceSide: final.side,
      };
    })
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

export interface MonthlyRevenuePoint {
  year: number;
  month: number;
  total: number;
}

export interface ExpenseBreakdownEntry {
  categoryKey: string;
  total: number;
}

export interface PilotageAggregates {
  tresorerieNette: number;
  chiffreAffairesParMois: MonthlyRevenuePoint[];
  topDepenses: ExpenseBreakdownEntry[];
}

// Module P4 (Pilotage Dirigeant): the same ledger, distilled into the three
// numbers a PME director actually looks at -- how much cash is on hand
// right now, is revenue trending up, and where is the money going.
export function computePilotageAggregates(
  lines: LedgerLine[],
  yearStart: Date,
  yearEndExclusive: Date,
  asOf: Date,
): PilotageAggregates {
  // Trésorerie nette is a point-in-time position (everything booked up to
  // "now"), independent of which fiscal year is selected for the other
  // reports -- a director always wants today's real cash position.
  let treasuryNet = 0;
  for (const line of lines) {
    if (line.accountClass !== 5) continue;
    if (line.transactionDate > asOf) continue;
    treasuryNet += line.debitAmount - line.creditAmount;
  }

  const monthlyRevenue = new Map<string, MonthlyRevenuePoint>();
  const expenseByCategory = new Map<string, number>();

  for (const line of lines) {
    if (line.transactionDate < yearStart || line.transactionDate >= yearEndExclusive) continue;

    if (line.accountClass === 7) {
      const key = `${line.transactionDate.getFullYear()}-${line.transactionDate.getMonth()}`;
      const point = monthlyRevenue.get(key) ?? {
        year: line.transactionDate.getFullYear(),
        month: line.transactionDate.getMonth() + 1,
        total: 0,
      };
      point.total += line.creditAmount - line.debitAmount;
      monthlyRevenue.set(key, point);
    }

    if (line.accountClass === 6 && line.transactionType === "depense" && line.category) {
      const previous = expenseByCategory.get(line.category) ?? 0;
      expenseByCategory.set(line.category, previous + (line.debitAmount - line.creditAmount));
    }
  }

  const chiffreAffairesParMois = Array.from(monthlyRevenue.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );

  const topDepenses = Array.from(expenseByCategory.entries())
    .map(([categoryKey, total]) => ({ categoryKey, total }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);

  return { tresorerieNette: treasuryNet, chiffreAffairesParMois, topDepenses };
}
