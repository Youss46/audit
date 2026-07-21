/**
 * Module Capitaux Propres — Apport de Constitution (Classe 1, SYSCOHADA)
 *
 * Génère automatiquement l'écriture de constitution du capital social lors de
 * la création ou du premier renseignement du capital d'un dossier client :
 *
 *   Cas standard (capital versé en banque) :
 *     Débit  5211 — Banques locales     → montant du capital social
 *     Crédit 1013 — Capital souscrit, appelé, versé, non amorti → même montant
 *
 *   Cas capital souscrit mais non encore versé (`capitalDeposited = false`) :
 *     Débit  4613 — Associés, capital souscrit — appelé, non versé
 *     Crédit 1013 — Capital souscrit, appelé, versé, non amorti
 *
 * L'écriture est immédiatement validée (status = "valide", source =
 * "capital_constitution") et comptabilisée dans le Journal OD (Opérations
 * Diverses) à la date de création du dossier client. Elle ne peut être
 * générée qu'une seule fois par dossier grâce au flag `isCapitalInitialized`
 * sur le client.
 */

import { and, eq } from "drizzle-orm";
import { db, clientsTable, transactionsTable, journalLinesTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Levée quand le capital a déjà été comptabilisé pour ce client. */
export class CapitalAlreadyInitializedError extends Error {
  readonly statusCode = 409;
  constructor(clientId: number) {
    super(
      `L'écriture de constitution du capital social pour le client #${clientId} a déjà été comptabilisée.`,
    );
    this.name = "CapitalAlreadyInitializedError";
  }
}

/** Levée si l'écriture construite est déséquilibrée (ne devrait jamais arriver). */
export class CapitalEntryImbalanceError extends Error {
  readonly statusCode = 500;
  constructor(debit: number, credit: number) {
    super(
      `Déséquilibre détecté dans l'écriture de constitution : Débit = ${debit} FCFA, Crédit = ${credit} FCFA. L'écriture n'a pas été enregistrée.`,
    );
    this.name = "CapitalEntryImbalanceError";
  }
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PostCapitalContributionResult {
  transactionId: number;
  debitAccount: string;
  creditAccount: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Comptabilise l'apport initial de capital social pour un client.
 *
 * @param firmId          - ID du cabinet
 * @param clientId        - ID du dossier client
 * @param createdById     - ID de l'utilisateur déclenchant l'opération
 * @param clientName      - Raison sociale (utilisée dans les libellés)
 * @param capitalSocial   - Montant du capital social en FCFA (entier)
 * @param entryDate       - Date de l'écriture (= date de création du dossier client)
 * @param capitalDeposited - true si le capital est versé en banque (débit 5211),
 *                           false s'il est seulement souscrit, non versé (débit 4613)
 */
export async function postCapitalContribution(
  firmId: number,
  clientId: number,
  createdById: number,
  clientName: string,
  capitalSocial: number,
  entryDate: Date,
  capitalDeposited: boolean = true,
): Promise<PostCapitalContributionResult> {
  // ------------------------------------------------------------------
  // Garde d'idempotence : vérifier le flag en DB pour éviter les races
  // ------------------------------------------------------------------
  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)),
  });
  if (!client) {
    throw new Error(`Client #${clientId} introuvable.`);
  }
  if (client.isCapitalInitialized) {
    throw new CapitalAlreadyInitializedError(clientId);
  }

  const amount = Math.round(capitalSocial);
  if (amount <= 0) {
    throw new Error("Le montant du capital social doit être strictement positif.");
  }

  // ------------------------------------------------------------------
  // Construction des lignes (écriture équilibrée)
  // ------------------------------------------------------------------
  //   Cas capital versé (capitalDeposited = true, cas standard ivoirien) :
  //     Débit  521100 — Banques locales (capital déposé à la banque)
  //     Crédit 101300 — Capital souscrit, appelé, versé, non amorti
  //   Cas capital souscrit non versé (capitalDeposited = false) :
  //     Débit  461300 — Associés, capital souscrit — appelé, non versé
  //     Crédit 101300 — Capital souscrit, appelé, versé, non amorti
  const debitAccount = capitalDeposited ? "521100" : "461300";
  const debitLabel = capitalDeposited
    ? `Apport initial de constitution — Banques locales — ${clientName}`
    : `Apport initial de constitution — Capital souscrit non versé — ${clientName}`;

  const lines = [
    {
      accountNumber: debitAccount,
      label: debitLabel,
      debitAmount: amount,
      creditAmount: 0,
    },
    {
      accountNumber: "101300",
      label: `Apport initial de constitution — Capital souscrit, appelé, versé — ${clientName}`,
      debitAmount: 0,
      creditAmount: amount,
    },
  ];

  // Vérification d'équilibre avant tout INSERT (principe de partie double)
  const totalDebit = lines.reduce((s, l) => s + l.debitAmount, 0);
  const totalCredit = lines.reduce((s, l) => s + l.creditAmount, 0);
  if (totalDebit !== totalCredit) {
    throw new CapitalEntryImbalanceError(totalDebit, totalCredit);
  }

  // ------------------------------------------------------------------
  // Insertion dans le Grand Livre (transaction atomique)
  // Source "capital_constitution" -> classée automatiquement dans le
  // Journal OD (Opérations Diverses) côté frontend (voir status.ts).
  // paymentMethod reste null quand le capital n'est pas versé : aucun
  // mouvement de trésorerie réel n'a lieu tant que 4613 n'est pas soldé.
  // ------------------------------------------------------------------
  const [tx] = await db
    .insert(transactionsTable)
    .values({
      firmId,
      clientId,
      date: entryDate,
      label: `Apport initial de constitution — ${clientName}`,
      amount,
      type: "recette",
      category: null,
      paymentType: "cash",
      paymentMethod: capitalDeposited ? "virement" : null,
      status: "valide",
      source: "capital_constitution",
      createdById,
      anomalies: [],
      validatedAt: new Date(),
      validatedById: createdById,
    })
    .returning();

  await db.insert(journalLinesTable).values(
    lines.map((l) => ({ ...l, transactionId: tx.id })),
  );

  // ------------------------------------------------------------------
  // Marquage du client comme initialisé (garde d'idempotence persistée)
  // ------------------------------------------------------------------
  await db
    .update(clientsTable)
    .set({ isCapitalInitialized: true })
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)));

  return {
    transactionId: tx.id,
    debitAccount,
    creditAccount: "101300",
    amount,
  };
}

/**
 * "Reprise de dossier" (client existant repris par le cabinet) : marque le
 * capital du client comme initialisé SANS générer d'écriture de constitution
 * datée d'aujourd'hui. Le solde historique du capital (et le reste des
 * capitaux propres) sera repris globalement via la Balance d'Entrée /
 * Journal des À-nouveaux, pas via un apport de constitution fictif.
 *
 * Idempotent au même titre que postCapitalContribution() : ne fait rien (et
 * lève CapitalAlreadyInitializedError) si le client est déjà initialisé.
 *
 * @param firmId   - ID du cabinet
 * @param clientId - ID du dossier client
 */
export async function markCapitalAsReprise(firmId: number, clientId: number): Promise<void> {
  const client = await db.query.clientsTable.findFirst({
    where: and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)),
  });
  if (!client) {
    throw new Error(`Client #${clientId} introuvable.`);
  }
  if (client.isCapitalInitialized) {
    throw new CapitalAlreadyInitializedError(clientId);
  }

  await db
    .update(clientsTable)
    .set({ isCapitalInitialized: true })
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.firmId, firmId)));
}
