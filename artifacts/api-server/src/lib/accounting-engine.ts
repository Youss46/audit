import type { PaymentMethod, PaymentType, TransactionType } from "@workspace/db";

// Module M3/P3 automated matching engine: bridges a PME's plain-language
// cash entry (category + type + payment method) to the exact SYSCOHADA
// double-entry ledger structure, so the accountant only has to review and
// approve rather than re-key every operation from scratch.

// The treasury ("trésorerie") leg of every entry depends only on the
// payment method: cash movements hit account 571 (Caisse), everything else
// (mobile money, cheque, bank transfer) is treated as a bank movement on
// account 52 (Banques).
const PAYMENT_METHOD_ACCOUNTS: Record<PaymentMethod, string> = {
  especes: "571",
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

// Third-party ("tiers") accounts used for credit (à crédit) operations,
// strict SYSCOHADA accrual accounting: a recette is booked against 4111
// (Clients) until settled, a dépense against 4011 (Fournisseurs).
const THIRD_PARTY_ACCOUNTS: Record<TransactionType, { accountNumber: string; label: string }> = {
  recette: { accountNumber: "4111", label: "Clients" },
  depense: { accountNumber: "4011", label: "Fournisseurs" },
};

export interface CategoryRule {
  // Plain-language category label shown to the PME.
  label: string;
  type: TransactionType;
  // SYSCOHADA counterpart account (the non-treasury side of the entry).
  counterpartAccount: string;
  counterpartName: string;
  // System-generated categories (e.g. module P5 caisse discrepancies) are
  // never offered in the PME's manual category picker.
  hidden?: boolean;
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
    counterpartAccount: "618",
    counterpartName: "Voyages et déplacements",
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

  // Module P5 (Caisse Terrain): system-generated only, booked automatically
  // when a daily closure ("Clôture de Caisse en 1 Tap") reveals a
  // discrepancy between the theoretical and the physically counted
  // balance. Never offered in the PME's manual category picker.
  ecart_caisse_gain: {
    label: "Écart de caisse (excédent)",
    type: "recette",
    counterpartAccount: "758",
    counterpartName: "Produits divers",
    hidden: true,
  },
  ecart_caisse_perte: {
    label: "Écart de caisse (manquant)",
    type: "depense",
    counterpartAccount: "658",
    counterpartName: "Charges diverses",
    hidden: true,
  },
} as const;

export type TransactionCategory = keyof typeof CATEGORY_RULES;

export function listCategoriesForType(type: TransactionType) {
  return Object.entries(CATEGORY_RULES)
    .filter(([, rule]) => rule.type === type && !rule.hidden)
    .map(([key, rule]) => ({ key, label: rule.label }));
}

export class AccountingEngineError extends Error {}

export interface ComputedJournalLine {
  accountNumber: string;
  label: string;
  debitAmount: number;
  creditAmount: number;
}

// Computes the balanced double-entry journal lines for one transaction,
// honouring strict SYSCOHADA cash-vs-accrual treatment:
// - Cash (au comptant):
//   - Dépense: Debit = counterpart charge account, Credit = treasury account.
//   - Recette: Debit = treasury account, Credit = counterpart product account.
// - Credit (à crédit) -- "invoicing" step, booked through a third-party
//   account instead of treasury until settled:
//   - Dépense: Debit = counterpart charge account, Credit = 4011 Fournisseurs.
//   - Recette: Debit = 4111 Clients, Credit = counterpart product account.
export function computeJournalLines(input: {
  category: string;
  type: TransactionType;
  paymentType: PaymentType;
  paymentMethod?: PaymentMethod | null;
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

  let treasuryOrThirdPartyAccount: string;
  let treasuryOrThirdPartyLabel: string;
  if (input.paymentType === "cash") {
    if (!input.paymentMethod) {
      throw new AccountingEngineError(
        "Le mode de règlement est requis pour une opération au comptant.",
      );
    }
    treasuryOrThirdPartyAccount = PAYMENT_METHOD_ACCOUNTS[input.paymentMethod];
    treasuryOrThirdPartyLabel = PAYMENT_METHOD_LABELS[input.paymentMethod];
  } else {
    const thirdParty = THIRD_PARTY_ACCOUNTS[input.type];
    treasuryOrThirdPartyAccount = thirdParty.accountNumber;
    treasuryOrThirdPartyLabel = thirdParty.label;
  }

  if (input.type === "depense") {
    return [
      {
        accountNumber: rule.counterpartAccount,
        label: rule.counterpartName,
        debitAmount: input.amount,
        creditAmount: 0,
      },
      {
        accountNumber: treasuryOrThirdPartyAccount,
        label: treasuryOrThirdPartyLabel,
        debitAmount: 0,
        creditAmount: input.amount,
      },
    ];
  }

  return [
    {
      accountNumber: treasuryOrThirdPartyAccount,
      label: treasuryOrThirdPartyLabel,
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

// Computes the second leg ("Step 2: Settlement") of a credit operation, once
// the PME marks an outstanding invoice as paid: moves the balance from the
// third-party account (4111/4011) to the treasury account for the chosen
// payment method.
// - Dépense (we owed a Fournisseur, now paying): Debit 4011, Credit treasury.
// - Recette (a Client owed us, now paying): Debit treasury, Credit 4111.
export function computeSettlementJournalLines(input: {
  type: TransactionType;
  paymentMethod: PaymentMethod;
  amount: number;
}): ComputedJournalLine[] {
  if (input.amount <= 0) {
    throw new AccountingEngineError("Le montant doit être strictement positif.");
  }
  const thirdParty = THIRD_PARTY_ACCOUNTS[input.type];
  const treasuryAccount = PAYMENT_METHOD_ACCOUNTS[input.paymentMethod];
  const treasuryLabel = PAYMENT_METHOD_LABELS[input.paymentMethod];

  if (input.type === "depense") {
    return [
      {
        accountNumber: thirdParty.accountNumber,
        label: thirdParty.label,
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
      accountNumber: thirdParty.accountNumber,
      label: thirdParty.label,
      debitAmount: 0,
      creditAmount: input.amount,
    },
  ];
}
