import type { PaymentMethod, TransactionType } from "@workspace/db";

// Module M3/P3 automated matching engine: bridges a PME's plain-language
// cash entry (category + type + payment method) to the exact SYSCOHADA
// double-entry ledger structure, so the accountant only has to review and
// approve rather than re-key every operation from scratch.

// The treasury ("trésorerie") leg of every entry depends only on the
// payment method: cash movements hit account 57 (Caisse), everything else
// (mobile money, cheque, bank transfer) is treated as a bank movement on
// account 52 (Banques).
const PAYMENT_METHOD_ACCOUNTS: Record<PaymentMethod, string> = {
  especes: "57",
  mobile_money: "52",
  cheque: "52",
  virement: "52",
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  especes: "Espèces",
  mobile_money: "Wave / Orange Money",
  cheque: "Chèque",
  virement: "Virement",
};

export interface CategoryRule {
  // Plain-language category label shown to the PME.
  label: string;
  type: TransactionType;
  // SYSCOHADA counterpart account (the non-treasury side of the entry).
  counterpartAccount: string;
  counterpartName: string;
}

// Category -> SYSCOHADA counterpart account mapping (module P3/M3). Kept as
// a flat, explicit table rather than a heuristic so every mapping is
// auditable and easy for an accountant to extend.
export const CATEGORY_RULES: Record<string, CategoryRule> = {
  // Dépenses
  achat_marchandises: {
    label: "Achat de marchandises",
    type: "depense",
    counterpartAccount: "601",
    counterpartName: "Achats de marchandises",
  },
  achat_carburant: {
    label: "Achat carburant",
    type: "depense",
    counterpartAccount: "6051",
    counterpartName: "Fournitures non stockables - Carburant",
  },
  loyer: {
    label: "Loyer",
    type: "depense",
    counterpartAccount: "622",
    counterpartName: "Locations et charges locatives",
  },
  electricite_eau: {
    label: "Électricité / Eau",
    type: "depense",
    counterpartAccount: "6052",
    counterpartName: "Fournitures non stockables - Eau, électricité",
  },
  fournitures_bureau: {
    label: "Fournitures de bureau",
    type: "depense",
    counterpartAccount: "6054",
    counterpartName: "Fournitures de bureau",
  },
  transport_deplacement: {
    label: "Transport / Déplacement",
    type: "depense",
    counterpartAccount: "614",
    counterpartName: "Transports du personnel",
  },
  salaires: {
    label: "Salaires",
    type: "depense",
    counterpartAccount: "661",
    counterpartName: "Appointements, salaires et commissions",
  },
  entretien_reparation: {
    label: "Entretien / Réparation",
    type: "depense",
    counterpartAccount: "624",
    counterpartName: "Entretien, réparations et maintenance",
  },
  autres_depenses: {
    label: "Autres dépenses",
    type: "depense",
    counterpartAccount: "628",
    counterpartName: "Autres charges externes",
  },

  // Recettes
  vente_marchandises: {
    label: "Vente de marchandises",
    type: "recette",
    counterpartAccount: "701",
    counterpartName: "Ventes de marchandises",
  },
  prestation_services: {
    label: "Prestation de services",
    type: "recette",
    counterpartAccount: "706",
    counterpartName: "Services vendus",
  },
  autres_recettes: {
    label: "Autres recettes",
    type: "recette",
    counterpartAccount: "758",
    counterpartName: "Produits divers",
  },
} as const;

export type TransactionCategory = keyof typeof CATEGORY_RULES;

export function listCategoriesForType(type: TransactionType) {
  return Object.entries(CATEGORY_RULES)
    .filter(([, rule]) => rule.type === type)
    .map(([key, rule]) => ({ key, label: rule.label }));
}

export class AccountingEngineError extends Error {}

export interface ComputedJournalLine {
  accountNumber: string;
  label: string;
  debitAmount: number;
  creditAmount: number;
}

// Computes the balanced double-entry journal lines for one transaction.
// - Dépense: Debit = counterpart charge account, Credit = treasury account.
// - Recette: Debit = treasury account, Credit = counterpart product account.
export function computeJournalLines(input: {
  category: string;
  type: TransactionType;
  paymentMethod: PaymentMethod;
  amount: number;
}): ComputedJournalLine[] {
  const rule = CATEGORY_RULES[input.category];
  if (!rule) {
    throw new AccountingEngineError(`Catégorie inconnue : "${input.category}".`);
  }
  if (rule.type !== input.type) {
    throw new AccountingEngineError(
      `La catégorie "${rule.label}" ne correspond pas au type d'opération sélectionné.`,
    );
  }
  if (input.amount <= 0) {
    throw new AccountingEngineError("Le montant doit être strictement positif.");
  }

  const treasuryAccount = PAYMENT_METHOD_ACCOUNTS[input.paymentMethod];
  const treasuryLabel = PAYMENT_METHOD_LABELS[input.paymentMethod];

  if (input.type === "depense") {
    return [
      {
        accountNumber: rule.counterpartAccount,
        label: rule.counterpartName,
        debitAmount: input.amount,
        creditAmount: 0,
      },
      {
        accountNumber: treasuryAccount,
        label: treasuryLabel,
        debitAmount: 0,
        creditAmount: input.amount,
      },
    ];
  }

  return [
    {
      accountNumber: treasuryAccount,
      label: treasuryLabel,
      debitAmount: input.amount,
      creditAmount: 0,
    },
    {
      accountNumber: rule.counterpartAccount,
      label: rule.counterpartName,
      debitAmount: 0,
      creditAmount: input.amount,
    },
  ];
}
