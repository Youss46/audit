/**
 * Module Reprise de Dossier — Saisie de la Balance d'Entrée (À-nouveaux)
 *
 * Un client marqué "Reprise de dossier" (`isReprise = true`) n'a pas
 * d'écriture de constitution de capital (voir `capital-engine.ts`,
 * `markCapitalAsReprise`) : son capital, comme le reste de ses capitaux
 * propres et de son bilan historique, est repris globalement via une saisie
 * manuelle unique de la balance d'entrée -- une écriture équilibrée qui
 * couvre potentiellement toutes les classes 1 à 5 (pas seulement le
 * capital).
 *
 * Contraintes :
 *   - Le client doit être en "Reprise de dossier" (isReprise = true).
 *   - Le capital ne doit pas déjà être initialisé (`isCapitalInitialized`
 *     sert de garde d'idempotence, comme pour l'apport de constitution
 *     classique -- une fois postée, la balance d'entrée ne peut plus être
 *     ressaisie).
 *   - L'exercice ciblé ne doit comporter aucune autre opération pour ce
 *     client (la balance d'entrée doit être la toute première écriture de
 *     l'exercice repris).
 *   - Les lignes doivent être strictement équilibrées (Total Débit = Total
 *     Crédit), sans quoi l'écriture n'est pas comptabilisée.
 *
 * L'écriture est immédiatement validée (status = "valide", source =
 * "a_nouveaux" -- classée en Journal OD côté frontend, voir status.ts) et
 * datée du 1er janvier de l'exercice choisi.
 */

import { and, eq, gte, lt } from "drizzle-orm";
import { db, clientsTable, transactionsTable, journalLinesTable, accountsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Levée quand le client n'est pas éligible à la saisie de balance d'entrée. */
export class OpeningBalanceNotEligibleError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "OpeningBalanceNotEligibleError";
  }
}

/** Levée quand la liste de lignes fournie est vide. */
export class OpeningBalanceEmptyError extends Error {
  readonly statusCode = 400;
  constructor() {
    super("La balance d'entrée doit contenir au moins une ligne.");
    this.name = "OpeningBalanceEmptyError";
  }
}

/** Levée quand Total Débit ≠ Total Crédit. */
export class OpeningBalanceImbalanceError extends Error {
  readonly statusCode = 400;
  constructor(debit: number, credit: number) {
    super(
      `La balance doit être équilibrée pour être enregistrée (Total Débit = ${debit} FCFA, Total Crédit = ${credit} FCFA).`,
    );
    this.name = "OpeningBalanceImbalanceError";
  }
}

/** Levée quand une ligne référence un numéro de compte inconnu du Plan Comptable. */
export class OpeningBalanceInvalidAccountError extends Error {
  readonly statusCode = 400;
  constructor(accountNumber: string) {
    super(`Le compte "${accountNumber}" est introuvable dans le Plan Comptable SYSCOHADA.`);
    this.name = "OpeningBalanceInvalidAccountError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpeningBalanceLineInput {
  accountNumber: string;
  debitAmount: number;
  creditAmount: number;
}

export interface OpeningBalanceEligibility {
  eligible: boolean;
  reason: string | null;
}

export interface PostOpeningBalanceResult {
  transactionId: number;
  year: number;
  totalAmount: number;
  accountsCount: number;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** True si ce client a déjà au moins une opération (quel que soit son statut) sur l'exercice donné. */
async function hasAnyTransactionInYear(
  firmId: number,
  clientId: number,
  year: number,
): Promise<boolean> {
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);
  const existing = await db.query.transactionsTable.findFirst({
    where: and(
      eq(transactionsTable.firmId, firmId),
      eq(transactionsTable.clientId, clientId),
      gte(transactionsTable.date, yearStart),
      lt(transactionsTable.date, yearEnd),
    ),
  });
  return !!existing;
}

/**
 * Vérifie si un client peut saisir sa balance d'entrée pour l'exercice donné.
 * Utilisée à la fois pour l'affichage conditionnel côté frontend et comme
 * garde d'entrée avant `postOpeningBalance` (défense en profondeur -- ne
 * jamais faire confiance uniquement au filtrage de l'UI).
 */
export async function checkOpeningBalanceEligibility(
  firmId: number,
  clientId: number,
  year: number,
): Promise<OpeningBalanceEligibility> {
  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)),
  });
  if (!client) {
    return { eligible: false, reason: "Client introuvable." };
  }
  if (!client.isReprise) {
    return {
      eligible: false,
      reason: "La saisie de la balance d'entrée n'est disponible que pour un dossier en Reprise de dossier.",
    };
  }
  if (client.isCapitalInitialized) {
    return {
      eligible: false,
      reason: "La balance d'entrée a déjà été saisie pour ce dossier (opération non répétable).",
    };
  }
  if (await hasAnyTransactionInYear(firmId, clientId, year)) {
    return {
      eligible: false,
      reason: `L'exercice ${year} comporte déjà des opérations : la balance d'entrée doit être la toute première écriture de l'exercice repris.`,
    };
  }
  return { eligible: true, reason: null };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Comptabilise la balance d'entrée (À-nouveaux) d'un client en Reprise de
 * dossier : une écriture unique, équilibrée, datée du 1er janvier de
 * `year`, à partir des lignes saisies par l'expert-comptable.
 */
export async function postOpeningBalance(
  firmId: number,
  clientId: number,
  createdById: number,
  clientName: string,
  year: number,
  lines: OpeningBalanceLineInput[],
): Promise<PostOpeningBalanceResult> {
  const eligibility = await checkOpeningBalanceEligibility(firmId, clientId, year);
  if (!eligibility.eligible) {
    throw new OpeningBalanceNotEligibleError(eligibility.reason ?? "Client non éligible.");
  }

  if (lines.length === 0) {
    throw new OpeningBalanceEmptyError();
  }

  // ------------------------------------------------------------------
  // Vérification d'équilibre avant tout accès au Plan Comptable ou INSERT
  // (principe de partie double -- rejet immédiat si déséquilibré).
  // ------------------------------------------------------------------
  const totalDebit = lines.reduce((s, l) => s + l.debitAmount, 0);
  const totalCredit = lines.reduce((s, l) => s + l.creditAmount, 0);
  if (totalDebit !== totalCredit || totalDebit === 0) {
    throw new OpeningBalanceImbalanceError(totalDebit, totalCredit);
  }

  // ------------------------------------------------------------------
  // Validation des numéros de compte contre le Plan Comptable SYSCOHADA.
  // ------------------------------------------------------------------
  const accountNumbers = Array.from(new Set(lines.map((l) => l.accountNumber)));
  const accounts = await db.query.accountsTable.findMany({
    where: (a, { inArray }) => inArray(a.accountNumber, accountNumbers),
  });
  const knownNumbers = new Set(accounts.map((a) => a.accountNumber));
  for (const number of accountNumbers) {
    if (!knownNumbers.has(number)) {
      throw new OpeningBalanceInvalidAccountError(number);
    }
  }
  const nameByNumber = new Map(accounts.map((a) => [a.accountNumber, a.name]));

  // ------------------------------------------------------------------
  // Insertion dans le Grand Livre.
  // Source "a_nouveaux" -> classée automatiquement dans le Journal OD
  // (Opérations Diverses) côté frontend (voir status.ts), au même titre que
  // le report d'à-nouveaux généré automatiquement par la clôture M19.
  // ------------------------------------------------------------------
  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId,
      clientId,
      date: new Date(`${year}-01-01T00:00:00.000Z`),
      label: "Bilan d'ouverture - Reprise de balance historique",
      amount: totalDebit,
      type: "recette",
      category: null,
      paymentType: "cash",
      paymentMethod: null,
      status: "valide",
      source: "a_nouveaux",
      createdById,
      anomalies: [],
      validatedAt: new Date(),
      validatedById: createdById,
    })
    .returning();

  await db.insert(journalLinesTable).values(
    lines.map((l) => ({
      transactionId: tx.id,
      accountNumber: l.accountNumber,
      label: `Reprise de balance historique — ${l.accountNumber} — ${nameByNumber.get(l.accountNumber) ?? l.accountNumber} — ${clientName}`,
      debitAmount: l.debitAmount,
      creditAmount: l.creditAmount,
    })),
  );

  // ------------------------------------------------------------------
  // Marquage du client comme initialisé (garde d'idempotence persistée) --
  // même flag que le circuit d'apport de constitution classique, la balance
  // d'entrée en est l'équivalent pour un dossier repris.
  // ------------------------------------------------------------------
  await db
    .update(clientsTable)
    .set({ isCapitalInitialized: true })
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)));

  return {
    transactionId: tx.id,
    year,
    totalAmount: totalDebit,
    accountsCount: accountNumbers.length,
  };
}
