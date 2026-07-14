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
  // Module M21 (Tableau de Bord Dirigeant): needed to reconstruct a
  // "comptabilité de trésorerie" (cash-basis) view of the ledger. "cash"
  // operations move money the instant they're booked; "credit" operations
  // only become a real cash event once settled (see settledAt).
  transactionPaymentType: "cash" | "credit";
  transactionSettledAt: Date | null;
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

// Module M21: "comptabilité d'engagement" (accrual -- every line counts on
// its transaction date) vs "comptabilité de trésorerie" (cash -- a credit
// operation only counts once it's actually been settled, on its settlement
// date; an unsettled credit operation counts nowhere yet).
export type DashboardBasis = "engagement" | "tresorerie";

// Resolves the date a ledger line should be attributed to for a given
// basis. Returns null when the line has no cash impact yet under the
// requested basis (an unsettled credit operation in "tresorerie" mode) --
// callers must skip the line entirely in that case, not fall back to the
// transaction date.
function basisDate(line: LedgerLine, basis: DashboardBasis): Date | null {
  if (basis === "engagement") return line.transactionDate;
  if (line.transactionPaymentType === "cash") return line.transactionDate;
  return line.transactionSettledAt;
}

// Class 6 SYSCOHADA sub-groups used for the M21 "Répartition des charges
// par nature" donut chart. Matched on the account's class-2 prefix (e.g.
// "622..." -> "62"), falling back to "autres" for anything not explicitly
// grouped (65 Autres charges, 67 Frais financiers, 68 Dotations, ...).
const EXPENSE_NATURE_PREFIXES: { prefixes: string[]; key: string; label: string }[] = [
  { prefixes: ["60"], key: "achats", label: "Achats" },
  { prefixes: ["61", "62", "63"], key: "services_exterieurs", label: "Services extérieurs" },
  { prefixes: ["66"], key: "personnel", label: "Personnel" },
  { prefixes: ["64"], key: "impots_taxes", label: "Impôts et taxes" },
];

function expenseNatureFor(accountNumber: string): { key: string; label: string } {
  const prefix2 = accountNumber.slice(0, 2);
  const match = EXPENSE_NATURE_PREFIXES.find((group) => group.prefixes.includes(prefix2));
  return match ? { key: match.key, label: match.label } : { key: "autres_charges", label: "Autres charges" };
}

// Class 6 sub-groups used to separate "charges variables" (scale with
// activity -- class 60 achats consommés) from "charges fixes" (class 61 to
// 65) for the M21 break-even calculation, per the standard SYSCOHADA
// direct-costing convention.
function isVariableCharge(accountNumber: string): boolean {
  return accountNumber.startsWith("60");
}
function isFixedCharge(accountNumber: string): boolean {
  const prefix2 = accountNumber.slice(0, 2);
  return ["61", "62", "63", "64", "65"].includes(prefix2);
}

export interface MonthlyMarginPoint {
  year: number;
  month: number;
  label: string;
  chiffreAffaires: number;
  margeBrute: number;
  tauxMarge: number | null;
}

export interface NatureBreakdownEntry {
  natureKey: string;
  label: string;
  total: number;
}

export interface SeuilRentabilite {
  chiffreAffairesAnnuel: number;
  chargesFixesAnnuelles: number;
  chargesVariablesAnnuelles: number;
  tauxMargeSurCoutsVariables: number | null;
  // Null when the taux de marge sur coûts variables is zero or negative --
  // the break-even point is mathematically undefined (undercutting itself
  // on every additional sale can never cover fixed costs).
  seuilRentabilite: number | null;
}

export interface DashboardKpi {
  moisCourant: number;
  moisPrecedent: number;
  variationPct: number | null;
}

export interface ExecutiveDashboardKpis {
  chiffreAffaires: DashboardKpi;
  margeBrute: DashboardKpi & { tauxMargeMoisCourant: number | null; tauxMargeMoisPrecedent: number | null };
  tresorerie: DashboardKpi & { seuilCritique: number; enAlerte: boolean };
}

export interface PilotageAggregates {
  tresorerieNette: number;
  chiffreAffairesParMois: MonthlyRevenuePoint[];
  topDepenses: ExpenseBreakdownEntry[];
  // Module M21 additions below.
  chargesParMois: MonthlyRevenuePoint[];
  margeBruteParMois: MonthlyMarginPoint[];
  tresorerieParMois: MonthlyRevenuePoint[];
  depensesParNature: NatureBreakdownEntry[];
  seuilRentabilite: SeuilRentabilite;
  kpis: ExecutiveDashboardKpis;
}

// Module P4/M21 (Tableau de Bord Dirigeant): the same ledger, distilled
// into the numbers a PME director actually looks at -- how much cash is on
// hand right now, is revenue trending up and profitable, where the money
// goes, and how far a bad month would be from the break-even point.
export function computePilotageAggregates(
  lines: LedgerLine[],
  yearStart: Date,
  yearEndExclusive: Date,
  asOf: Date,
  basis: DashboardBasis = "engagement",
  selectedMonth?: number | null,
): PilotageAggregates {
  // Trésorerie nette (both the headline KPI and the monthly curve) is
  // always a real cash position -- money only ever hits a class 5 account
  // the instant it physically moves (cash entry, or a settlement), so the
  // accrual/cash-basis toggle never applies to it.
  let treasuryNet = 0;
  for (const line of lines) {
    if (line.accountClass !== 5) continue;
    if (line.transactionDate > asOf) continue;
    treasuryNet += line.debitAmount - line.creditAmount;
  }

  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const monthlyRevenue = new Map<string, MonthlyRevenuePoint>();
  const monthlyCharges = new Map<string, MonthlyRevenuePoint>();
  const monthlyAchats = new Map<string, number>();
  const monthlyTreasury = new Map<string, MonthlyRevenuePoint>();
  const expenseByCategory = new Map<string, number>();
  const expenseByNature = new Map<string, NatureBreakdownEntry>();

  let chiffreAffairesAnnuel = 0;
  let chargesFixesAnnuelles = 0;
  let chargesVariablesAnnuelles = 0;

  for (const line of lines) {
    // Trésorerie evolves cumulatively month over month -- accumulate every
    // class 5 movement dated on or before the end of each month within the
    // selected year, regardless of the basis toggle (see above).
    if (line.accountClass === 5 && line.transactionDate < yearEndExclusive) {
      for (let m = 0; m < 12; m++) {
        const monthEndExclusive = new Date(Date.UTC(yearStart.getUTCFullYear(), m + 1, 1));
        if (line.transactionDate >= monthEndExclusive) continue;
        const key = `${yearStart.getUTCFullYear()}-${m}`;
        const point = monthlyTreasury.get(key) ?? { year: yearStart.getUTCFullYear(), month: m + 1, total: 0 };
        point.total += line.debitAmount - line.creditAmount;
        monthlyTreasury.set(key, point);
      }
    }

    const attributedDate = basisDate(line, basis);
    if (!attributedDate) continue; // unsettled credit op under cash basis: no impact yet
    if (attributedDate < yearStart || attributedDate >= yearEndExclusive) continue;
    const key = monthKey(attributedDate);
    const pointYear = attributedDate.getFullYear();
    const pointMonth = attributedDate.getMonth() + 1;

    if (line.accountClass === 7) {
      const net = line.creditAmount - line.debitAmount;
      const point = monthlyRevenue.get(key) ?? { year: pointYear, month: pointMonth, total: 0 };
      point.total += net;
      monthlyRevenue.set(key, point);
      chiffreAffairesAnnuel += net;
    }

    if (line.accountClass === 6) {
      const net = line.debitAmount - line.creditAmount;
      const point = monthlyCharges.get(key) ?? { year: pointYear, month: pointMonth, total: 0 };
      point.total += net;
      monthlyCharges.set(key, point);

      if (isVariableCharge(line.accountNumber)) {
        monthlyAchats.set(key, (monthlyAchats.get(key) ?? 0) + net);
        chargesVariablesAnnuelles += net;
      } else if (isFixedCharge(line.accountNumber)) {
        chargesFixesAnnuelles += net;
      }

      if (line.transactionType === "depense" && line.category) {
        expenseByCategory.set(line.category, (expenseByCategory.get(line.category) ?? 0) + net);
      }

      const nature = expenseNatureFor(line.accountNumber);
      const entry = expenseByNature.get(nature.key) ?? { natureKey: nature.key, label: nature.label, total: 0 };
      entry.total += net;
      expenseByNature.set(nature.key, entry);
    }
  }

  const chiffreAffairesParMois = Array.from(monthlyRevenue.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  const chargesParMois = Array.from(monthlyCharges.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  const tresorerieParMois = Array.from(monthlyTreasury.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );

  const margeBruteParMois: MonthlyMarginPoint[] = chiffreAffairesParMois.map((point) => {
    const key = `${point.year}-${point.month - 1}`;
    const achats = monthlyAchats.get(key) ?? 0;
    const margeBrute = point.total - achats;
    return {
      year: point.year,
      month: point.month,
      label: "",
      chiffreAffaires: point.total,
      margeBrute,
      tauxMarge: point.total > 0 ? (margeBrute / point.total) * 100 : null,
    };
  });

  const topDepenses = Array.from(expenseByCategory.entries())
    .map(([categoryKey, total]) => ({ categoryKey, total }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);

  const depensesParNature = Array.from(expenseByNature.values())
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);

  const tauxMargeSurCoutsVariables =
    chiffreAffairesAnnuel > 0 ? (chiffreAffairesAnnuel - chargesVariablesAnnuelles) / chiffreAffairesAnnuel : null;
  const seuilRentabilite: SeuilRentabilite = {
    chiffreAffairesAnnuel,
    chargesFixesAnnuelles,
    chargesVariablesAnnuelles,
    tauxMargeSurCoutsVariables,
    seuilRentabilite:
      tauxMargeSurCoutsVariables !== null && tauxMargeSurCoutsVariables > 0
        ? chargesFixesAnnuelles / tauxMargeSurCoutsVariables
        : null,
  };

  // "Mois courant" is normally the most recent month with any activity in
  // the selected year (today's month when the current year is selected and
  // already has data, otherwise the last month the client actually booked
  // something) so the KPI cards always compare two real, populated months
  // rather than an empty upcoming month. When the caller (the "Mois" filter
  // on the Pilotage dashboard) picks a specific month, that month becomes
  // "courant" instead, compared against the calendar month right before it
  // -- regardless of whether either month has any booked activity, so
  // picking an empty period correctly shows zeros rather than silently
  // falling back to the latest populated month.
  let currentPoint: { year: number; month: number } | null;
  let previousPoint: { year: number; month: number } | null;

  if (selectedMonth != null) {
    currentPoint = { year: yearStart.getUTCFullYear(), month: selectedMonth };
    previousPoint =
      selectedMonth > 1 ? { year: yearStart.getUTCFullYear(), month: selectedMonth - 1 } : null;
  } else {
    const monthsWithData = Array.from(
      new Set([...monthlyRevenue.keys(), ...monthlyCharges.keys()]),
    )
      .map((key) => {
        const [y, m] = key.split("-").map(Number);
        return { year: y, month: m + 1 };
      })
      .sort((a, b) => a.year - b.year || a.month - b.month);

    currentPoint = monthsWithData[monthsWithData.length - 1] ?? null;
    const previousMonthIndex = currentPoint
      ? monthsWithData.findIndex((p) => p.year === currentPoint!.year && p.month === currentPoint!.month) - 1
      : -1;
    previousPoint = previousMonthIndex >= 0 ? monthsWithData[previousMonthIndex] : null;
  }

  function valueAt(map: Map<string, MonthlyRevenuePoint>, point: { year: number; month: number } | null): number {
    if (!point) return 0;
    return map.get(`${point.year}-${point.month - 1}`)?.total ?? 0;
  }
  function variationPct(current: number, previous: number): number | null {
    if (previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  const caCourant = valueAt(monthlyRevenue, currentPoint);
  const caPrecedent = valueAt(monthlyRevenue, previousPoint);
  const achatsCourant = currentPoint ? monthlyAchats.get(`${currentPoint.year}-${currentPoint.month - 1}`) ?? 0 : 0;
  const achatsPrecedent = previousPoint ? monthlyAchats.get(`${previousPoint.year}-${previousPoint.month - 1}`) ?? 0 : 0;
  const margeCourante = caCourant - achatsCourant;
  const margePrecedente = caPrecedent - achatsPrecedent;

  // Trésorerie's "mois courant/précédent" reads off the same cumulative
  // monthly curve as the chart, at the same two months chosen above, so the
  // KPI card and the chart always agree.
  const tresorerieCourante = currentPoint ? valueAt(monthlyTreasury, currentPoint) : treasuryNet;
  const tresoreriePrecedente = valueAt(monthlyTreasury, previousPoint);

  // Critical cash-runway threshold: one month of average operating
  // expenses for the selected year. Below this, the firm has less than a
  // month of charges covered by cash on hand -- a standard, explainable
  // early-warning heuristic for a PME director (not a regulatory figure).
  const avgMonthlyCharges =
    chargesParMois.length > 0 ? chargesParMois.reduce((s, p) => s + p.total, 0) / chargesParMois.length : 0;
  const seuilCritique = avgMonthlyCharges;

  const kpis: ExecutiveDashboardKpis = {
    chiffreAffaires: {
      moisCourant: caCourant,
      moisPrecedent: caPrecedent,
      variationPct: variationPct(caCourant, caPrecedent),
    },
    margeBrute: {
      moisCourant: margeCourante,
      moisPrecedent: margePrecedente,
      variationPct: variationPct(margeCourante, margePrecedente),
      tauxMargeMoisCourant: caCourant > 0 ? (margeCourante / caCourant) * 100 : null,
      tauxMargeMoisPrecedent: caPrecedent > 0 ? (margePrecedente / caPrecedent) * 100 : null,
    },
    tresorerie: {
      moisCourant: tresorerieCourante,
      moisPrecedent: tresoreriePrecedente,
      variationPct: variationPct(tresorerieCourante, tresoreriePrecedente),
      seuilCritique,
      enAlerte: treasuryNet < seuilCritique,
    },
  };

  return {
    tresorerieNette: treasuryNet,
    chiffreAffairesParMois,
    topDepenses,
    chargesParMois,
    margeBruteParMois,
    tresorerieParMois,
    depensesParNature,
    seuilRentabilite,
    kpis,
  };
}
