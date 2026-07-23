import type { PaymentMethod, PaymentType, TransactionType } from "@workspace/db";

// Module M3/P3 automated matching engine: bridges a PME's plain-language
// cash entry (category + type + payment method) to the exact SYSCOHADA
// double-entry ledger structure, so the accountant only has to review and
// approve rather than re-key every operation from scratch.

// The treasury ("trésorerie") leg of every entry depends on the payment
// method: cash → 571 (Caisse), cheque → 513 (Chèques à encaisser),
// virement → 5211 (Banque), mobile money → 552 (Monnaie électronique,
// Classe 55 SYSCOHADA).  Per-provider detail (552100 Orange Money,
// 552200 Wave, …) is resolved separately when the caller knows the
// provider via mobileMoneyAccountId (see purchases.ts and
// imputation-engine.ts); here we keep the generic Class 55 fallback.
const PAYMENT_METHOD_ACCOUNTS: Record<PaymentMethod, string> = {
  especes:      "571100",
  mobile_money: "552100",   // generic fallback — per-provider resolved by mmProvider lookup
  cheque:       "513100",
  virement:     "521100",
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  especes: "Espèces",
  mobile_money: "Monnaie électronique",
  cheque: "Chèques à encaisser",
  virement: "Virement bancaire",
};

// Module P7 Mobile Money: per-provider Classe 55 SYSCOHADA accounts used
// when a pompiste's fuel sale is collected via a specific mobile money
// operator, and when the cabinet records a withdrawal/transfer to bank.
// 6-digit sub-accounts per provider. Order matches account numbering (alpha by code):
//   552100 = Wave  |  552200 = Orange Money  |  552300 = MTN MoMo  |  552400 = Moov Money
export const MOBILE_MONEY_PROVIDER_ACCOUNTS: Record<string, string> = {
  wave:         "552100",
  orange_money: "552200",
  mtn_momo:     "552300",
  moov_money:   "552400",
};

export const MOBILE_MONEY_PROVIDER_LABELS: Record<string, string> = {
  wave: "Wave",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov_money: "Moov Money",
};

// Third-party ("tiers") accounts used for credit (à crédit) operations,
// strict SYSCOHADA accrual accounting: a recette is booked against 4111
// (Clients) until settled, a dépense against 4011 (Fournisseurs).
const THIRD_PARTY_ACCOUNTS: Record<TransactionType, { accountNumber: string; label: string }> = {
  recette: { accountNumber: "411100", label: "Clients" },
  depense: { accountNumber: "401100", label: "Fournisseurs d'exploitation" },
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
    counterpartAccount: "601100",
    counterpartName: "Achats de marchandises",
  },
  achat_carburant: {
    label: "Achat carburant",
    type: "depense",
    counterpartAccount: "618100",
    counterpartName: "Voyages et déplacements",
  },
  loyer: {
    label: "Loyer",
    type: "depense",
    counterpartAccount: "622100",
    counterpartName: "Locations et charges locatives",
  },
  eau: {
    label: "Eau potable / SODECI",
    type: "depense",
    counterpartAccount: "605200",
    counterpartName: "Fournitures non stockables — Eau",
  },
  electricite: {
    label: "Électricité / CIE / Énergie",
    type: "depense",
    counterpartAccount: "605210",
    counterpartName: "Fournitures non stockables — Électricité",
  },
  fournitures_bureau: {
    label: "Fournitures de bureau",
    type: "depense",
    counterpartAccount: "605400",
    counterpartName: "Fournitures de bureau",
  },
  transport_deplacement: {
    label: "Transport / Déplacement",
    type: "depense",
    counterpartAccount: "614100",
    counterpartName: "Transports du personnel",
  },
  salaires: {
    label: "Salaires",
    type: "depense",
    counterpartAccount: "661100",
    counterpartName: "Appointements, salaires et commissions",
  },
  entretien_reparation: {
    label: "Entretien / Réparation",
    type: "depense",
    counterpartAccount: "624100",
    counterpartName: "Entretien, réparations et maintenance",
  },
  autres_depenses: {
    label: "Autres dépenses",
    type: "depense",
    counterpartAccount: "628100",
    counterpartName: "Autres charges externes",
  },

  // Recettes
  vente_marchandises: {
    label: "Vente de marchandises",
    type: "recette",
    counterpartAccount: "701100",
    counterpartName: "Ventes de marchandises",
  },
  prestation_services: {
    label: "Prestation de services",
    type: "recette",
    counterpartAccount: "706100",
    counterpartName: "Prestations de services",
  },
  autres_recettes: {
    label: "Autres recettes",
    type: "recette",
    counterpartAccount: "758100",
    counterpartName: "Produits divers",
  },

  // Module P7 (Un Pompiste = Un Shift): system-generated only, booked when
  // a pompiste validates a pump shift ("Ventes de carburant"). Never
  // offered in the PME's manual category picker.
  vente_carburant: {
    label: "Vente de carburant",
    type: "recette",
    counterpartAccount: "701100",
    counterpartName: "Ventes de marchandises (carburant)",
    hidden: true,
  },

  // Module P7 Mobile Money: system-generated only, booked when the cabinet
  // records a Mobile Money → Banque withdrawal/transfer. The fee leg
  // (631700) is always included in the same compound journal entry -- this
  // category rule drives the main counter-part (521100 Banques), not the fee.
  frais_mobile_money: {
    label: "Frais sur instruments monétaires électroniques",
    type: "depense",
    counterpartAccount: "631700",
    counterpartName: "Frais sur instruments monétaires électroniques",
    hidden: true,
  },

  // Module P5 (Caisse Terrain): system-generated only, booked automatically
  // when a daily closure ("Clôture de Caisse en 1 Tap") reveals a
  // discrepancy between the theoretical and the physically counted
  // balance. Never offered in the PME's manual category picker.
  ecart_caisse_gain: {
    label: "Écart de caisse (excédent)",
    type: "recette",
    counterpartAccount: "758100",
    counterpartName: "Produits divers",
    hidden: true,
  },
  ecart_caisse_perte: {
    label: "Écart de caisse (manquant)",
    type: "depense",
    counterpartAccount: "658100",
    counterpartName: "Charges diverses",
    hidden: true,
  },
} as const;

export type TransactionCategory = keyof typeof CATEGORY_RULES;

// ---------------------------------------------------------------------------
// Module Dépenses & Achats — category catalogue
// ---------------------------------------------------------------------------
// Extended SYSCOHADA Class 6 mapping for structured purchase recording
// (hors Caisse Terrain). Unlike CATEGORY_RULES (which drives the generic
// Mes Opérations entry form), these categories carry the HT/TVA breakdown
// and support three payment modes (credit / bank / mobile money).
export const PURCHASE_CATEGORIES: Record<
  string,
  { label: string; account: string; accountName: string; vatEligible: boolean; isImmobilisation?: boolean }
> = {
  // ── Charges d'exploitation (Classe 6) ─────────────────────────────────────
  achat_marchandises:    { label: "Achats de marchandises",                    account: "601100", accountName: "Achats de marchandises",                                  vatEligible: true  },
  achat_matieres:        { label: "Matières premières / consommables",          account: "601100", accountName: "Matières premières et consommables",                      vatEligible: true  },
  carburant:             { label: "Carburant",                                  account: "605100", accountName: "Fournitures non stockables — Carburant",                  vatEligible: true  },
  eau:                   { label: "Eau potable / SODECI",                       account: "605200", accountName: "Fournitures non stockables — Eau",                      vatEligible: false },
  electricite:           { label: "Électricité / CIE / Énergie",               account: "605210", accountName: "Fournitures non stockables — Électricité",                vatEligible: true  },
  fournitures_bureau:    { label: "Fournitures de bureau",                      account: "605400", accountName: "Fournitures de bureau",                                   vatEligible: true  },
  fournitures_entretien: { label: "Produits d'entretien",                       account: "605500", accountName: "Fournitures d'entretien",                                 vatEligible: true  },
  petit_materiel:        { label: "Petit matériel et outillage",                account: "605300", accountName: "Fournitures non stockables — Petit matériel",             vatEligible: true  },
  transport_achat:       { label: "Transport sur achats",                       account: "616100", accountName: "Transports sur achats et approvisionnements",             vatEligible: true  },
  transport_personnel:   { label: "Transport du personnel",                     account: "614100", accountName: "Transports du personnel",                                 vatEligible: true  },
  loyer:                 { label: "Loyer / Bail",                               account: "622100", accountName: "Locations et charges locatives",                          vatEligible: false },
  entretien:             { label: "Entretien / Réparation",                     account: "624100", accountName: "Entretien, réparations et maintenance",                   vatEligible: true  },
  assurance:             { label: "Assurances",                                 account: "625100", accountName: "Assurances",                                              vatEligible: false },
  telephone_internet:    { label: "Téléphone / Internet",                       account: "628100", accountName: "Frais de télécommunications",                             vatEligible: true  },
  publicite:             { label: "Publicité / Marketing",                      account: "627100", accountName: "Publicité et relations publiques",                        vatEligible: true  },
  honoraires:            { label: "Honoraires (comptable, avocat…)",            account: "632100", accountName: "Honoraires",                                              vatEligible: false },
  salaires:              { label: "Salaires / Rémunérations",                  account: "661100", accountName: "Appointements, salaires et commissions",                  vatEligible: false },
  charges_sociales:      { label: "Charges sociales (CNPS…)",                  account: "664100", accountName: "Charges sociales",                                        vatEligible: false },
  autres_achats:         { label: "Autres achats / charges",                    account: "658100", accountName: "Charges diverses",                                        vatEligible: true  },
  // ── Immobilisations corporelles (Classe 2) — actif du bilan ───────────────
  // TVA → 445200 (récup. sur immos) ; crédit → 481100 (Fournisseurs d'immo)
  immo_materiel_industriel: { label: "Immobilisation — Matériel industriel et outillage", account: "241100", accountName: "Matériel industriel et outillage",                    vatEligible: true, isImmobilisation: true },
  immo_materiel_mobilier:   { label: "Immobilisation — Mobilier et agencements",          account: "244100", accountName: "Matériel et mobilier (bureau, agencements)",           vatEligible: true, isImmobilisation: true },
  immo_materiel_transport:  { label: "Immobilisation — Matériel de transport",            account: "245100", accountName: "Matériel de transport",                                vatEligible: true, isImmobilisation: true },
  immo_materiel_info:       { label: "Immobilisation — Matériel informatique",            account: "244100", accountName: "Matériel informatique et équipements numériques",      vatEligible: true, isImmobilisation: true },
  immo_autres:              { label: "Immobilisation — Autres équipements",               account: "248100", accountName: "Autres matériels et mobiliers",                        vatEligible: true, isImmobilisation: true },
};

export type PurchaseCategoryKey = keyof typeof PURCHASE_CATEGORIES;

// Computes the balanced SYSCOHADA journal lines for a structured purchase
// (Dépenses & Achats module). Handles TVA and AIB (Acompte sur Impôts et
// Bénéfices — retenue à la source Côte d'Ivoire, account 447200).
//
// AIB timing follows strict SYSCOHADA accrual treatment:
//   • Immediate payment (bank / mobile_money): AIB is withheld on the spot →
//     Cr 447200 (AIB) + Cr treasury (TTC − AIB) in the initial entry.
//   • Credit purchase: AIB is withheld at settlement time, not at invoice
//     booking → initial entry credits 4011 for the full TTC; settlement entry
//     splits 4011 debit into Cr 447200 + Cr treasury.
//
// Journal structure:
//   Dr  Class 6 charge account          (amountHt)
//   Dr  4451 TVA récupérable            (vatAmount, if > 0)
//   Cr  447200 AIB retenu à la source   (aibAmount, immediate payment only, if > 0)
//   Cr  4011 | 5211 | 552xxx            (amountTtc for credit; amountTtc−aib for immediate)
export function computePurchaseJournalLines(input: {
  amountHt: number;
  vatAmount: number;
  amountTtc: number;
  aibAmount: number;           // 0 when no AIB applies
  chargeAccount: string;
  chargeName: string;
  creditAccount: string;       // 4011 | 481100 | 5211 | 552xxx
  creditLabel: string;
  paymentMode: "credit" | "bank" | "mobile_money";
  isImmobilisation?: boolean;  // true → TVA → 445200 (immos), not 445100 (achats)
}): ComputedJournalLine[] {
  if (input.amountHt <= 0) throw new AccountingEngineError("Le montant HT doit être strictement positif.");
  if (input.amountTtc <= 0) throw new AccountingEngineError("Le montant TTC doit être strictement positif.");
  if (input.vatAmount < 0)  throw new AccountingEngineError("Le montant de TVA ne peut pas être négatif.");
  if (input.aibAmount < 0)  throw new AccountingEngineError("Le montant AIB ne peut pas être négatif.");
  if (Math.round(input.amountHt + input.vatAmount) !== Math.round(input.amountTtc)) {
    throw new AccountingEngineError(
      `Incohérence : HT (${input.amountHt}) + TVA (${input.vatAmount}) ≠ TTC (${input.amountTtc}).`,
    );
  }
  if (input.aibAmount > input.amountTtc) {
    throw new AccountingEngineError("Le montant AIB ne peut pas dépasser le montant TTC.");
  }

  const isCredit    = input.paymentMode === "credit";
  const hasVat      = input.vatAmount > 0;
  const hasAib      = input.aibAmount > 0 && !isCredit; // AIB booked at settlement for credit

  const lines: ComputedJournalLine[] = [
    // Debit side
    { accountNumber: input.chargeAccount, label: input.chargeName,
      debitAmount: input.amountHt,  creditAmount: 0 },
    ...(hasVat ? [{
      accountNumber: input.isImmobilisation ? "445200" : "445100",
      label: input.isImmobilisation ? "TVA récupérable sur immobilisations" : "TVA récupérable sur achats",
      debitAmount: input.vatAmount, creditAmount: 0 }] : []),
    // Credit side
    ...(hasAib ? [{ accountNumber: "447200",
      label: "État, retenues à la source — AIB",
      debitAmount: 0, creditAmount: input.aibAmount }] : []),
    { accountNumber: input.creditAccount, label: input.creditLabel,
      debitAmount: 0,
      // Credit account receives full TTC for credit purchases;
      // only the net (TTC − AIB) for immediate payments.
      creditAmount: isCredit ? input.amountTtc : input.amountTtc - input.aibAmount },
  ];

  const totalDebit  = lines.reduce((s, l) => s + l.debitAmount,  0);
  const totalCredit = lines.reduce((s, l) => s + l.creditAmount, 0);
  if (Math.round(totalDebit) !== Math.round(totalCredit)) {
    throw new AccountingEngineError(
      `Écriture déséquilibrée : débit ${totalDebit} ≠ crédit ${totalCredit}.`,
    );
  }
  return lines;
}

// Computes the settlement journal lines for a credit purchase.
// Debits 4011 Fournisseurs for the full TTC, then splits the credit between
// 447200 AIB (if applicable) and the treasury account (net amount).
//
//   Dr  4011 Fournisseurs              (amountTtc)
//   Cr  447200 AIB retenu              (aibAmount, if > 0)
//   Cr  5211 | 552xxx treasury         (amountTtc − aibAmount)
export function computePurchaseSettlementLines(input: {
  amountTtc: number;
  aibAmount: number;
  creditAccount: string;
  creditLabel: string;
}): ComputedJournalLine[] {
  if (input.amountTtc <= 0) throw new AccountingEngineError("Le montant à régler doit être strictement positif.");
  if (input.aibAmount < 0)  throw new AccountingEngineError("Le montant AIB ne peut pas être négatif.");
  if (input.aibAmount > input.amountTtc) throw new AccountingEngineError("Le montant AIB dépasse le TTC.");

  const netAmount = input.amountTtc - input.aibAmount;
  return [
    { accountNumber: "401100", label: "Fournisseurs d'exploitation",
      debitAmount: input.amountTtc, creditAmount: 0 },
    ...(input.aibAmount > 0 ? [{ accountNumber: "447200",
      label: "État, retenues à la source — AIB",
      debitAmount: 0, creditAmount: input.aibAmount }] : []),
    { accountNumber: input.creditAccount, label: input.creditLabel,
      debitAmount: 0, creditAmount: netAmount },
  ];
}

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
  // Module P6 (Un Pompiste = Une Caisse): when the caller posts through a
  // dedicated per-pompiste cash drawer, the "espèces" leg must land on that
  // register's own SYSCOHADA sub-account (e.g. "571101") instead of the
  // generic "571" -- overrides PAYMENT_METHOD_ACCOUNTS.especes only.
  treasuryAccountOverride?: { accountNumber: string; label: string };
  // Module Trésorerie Mobile Money: when the caller knows the specific Mobile
  // Money provider (via mobileMoneyAccountId), use the per-provider Classe 55
  // sub-account (552100 Orange / 552200 Wave / etc.) instead of the generic
  // "552" fallback. Only applies when paymentMethod is "mobile_money".
  mmProvider?: string | null;
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
    if (input.paymentMethod === "especes" && input.treasuryAccountOverride) {
      treasuryOrThirdPartyAccount = input.treasuryAccountOverride.accountNumber;
      treasuryOrThirdPartyLabel = input.treasuryAccountOverride.label;
    } else if (input.paymentMethod === "mobile_money" && input.mmProvider) {
      treasuryOrThirdPartyAccount = MOBILE_MONEY_PROVIDER_ACCOUNTS[input.mmProvider] ?? PAYMENT_METHOD_ACCOUNTS["mobile_money"];
      treasuryOrThirdPartyLabel = MOBILE_MONEY_PROVIDER_LABELS[input.mmProvider] ?? PAYMENT_METHOD_LABELS["mobile_money"];
    } else {
      treasuryOrThirdPartyAccount = PAYMENT_METHOD_ACCOUNTS[input.paymentMethod];
      treasuryOrThirdPartyLabel = PAYMENT_METHOD_LABELS[input.paymentMethod];
    }
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

// Module P7 Mobile Money: computes the multi-debit journal entry for a fuel
// sale collected via a mix of Espèces and/or Mobile Money providers.
// Instead of the standard 2-line entry, each active payment channel gets its
// own debit leg so the per-provider Classe 55 / 571xx sub-ledgers stay
// reconcilable. The single credit leg always lands on 701 (Ventes de
// marchandises - carburant).
//
// Invariant: cashAmount + waveAmount + orangeMoneyAmount + mtnMomoAmount
//            must equal totalAmount (enforced by the caller before this runs).
export function computeFuelSaleJournalLines(input: {
  cashAmount: number;
  waveAmount: number;
  orangeMoneyAmount: number;
  mtnMomoAmount: number;
  totalAmount: number;
  // The pompiste's personal sub-account (e.g. "571101") when they have a
  // dedicated P6 cash drawer -- overrides the generic "571" for the cash leg.
  cashRegisterAccountNumber?: string | null;
  cashRegisterName?: string | null;
}): ComputedJournalLine[] {
  const lines: ComputedJournalLine[] = [];

  if (input.cashAmount > 0) {
    lines.push({
      accountNumber: input.cashRegisterAccountNumber ?? "571100",
      label: input.cashRegisterName ?? "Caisse",
      debitAmount: input.cashAmount,
      creditAmount: 0,
    });
  }
  if (input.waveAmount > 0) {
    lines.push({
      accountNumber: MOBILE_MONEY_PROVIDER_ACCOUNTS.wave,
      label: MOBILE_MONEY_PROVIDER_LABELS.wave,
      debitAmount: input.waveAmount,
      creditAmount: 0,
    });
  }
  if (input.orangeMoneyAmount > 0) {
    lines.push({
      accountNumber: MOBILE_MONEY_PROVIDER_ACCOUNTS.orange_money,
      label: MOBILE_MONEY_PROVIDER_LABELS.orange_money,
      debitAmount: input.orangeMoneyAmount,
      creditAmount: 0,
    });
  }
  if (input.mtnMomoAmount > 0) {
    lines.push({
      accountNumber: MOBILE_MONEY_PROVIDER_ACCOUNTS.mtn_momo,
      label: MOBILE_MONEY_PROVIDER_LABELS.mtn_momo,
      debitAmount: input.mtnMomoAmount,
      creditAmount: 0,
    });
  }

  // Credit leg: Ventes de marchandises (carburant).
  lines.push({
    accountNumber: "701100",
    label: "Ventes de marchandises (carburant)",
    debitAmount: 0,
    creditAmount: input.totalAmount,
  });

  return lines;
}

// Module P7 Mobile Money: computes the compound journal entry for a cabinet
// "Virement Mobile Money vers Banque" operation.
//   Dr 52       net amount (totalAmount - feeAmount)  → Banque
//   Dr 631700   feeAmount                             → Frais Mobile Money
//   Cr 552xxx   totalAmount                           → Mobile Money provider
export function computeMobileMoneyVirementJournalLines(input: {
  provider: string;
  totalAmount: number;
  feeAmount: number;
}): ComputedJournalLine[] {
  const netAmount = input.totalAmount - input.feeAmount;
  const mmAccount = MOBILE_MONEY_PROVIDER_ACCOUNTS[input.provider] ?? "552100";
  const mmLabel = MOBILE_MONEY_PROVIDER_LABELS[input.provider] ?? "Mobile Money";

  const lines: ComputedJournalLine[] = [
    {
      accountNumber: "521100",
      label: "Banques locales",
      debitAmount: netAmount,
      creditAmount: 0,
    },
  ];

  if (input.feeAmount > 0) {
    lines.push({
      accountNumber: "631700",
      label: "Frais sur instruments monétaires électroniques",
      debitAmount: input.feeAmount,
      creditAmount: 0,
    });
  }

  lines.push({
    accountNumber: mmAccount,
    label: mmLabel,
    debitAmount: 0,
    creditAmount: input.totalAmount,
  });

  return lines;
}

// Module Trésorerie Mobile Money (generalized, all PME clients): computes
// the compound journal entry for money flowing INTO a client's Mobile Money
// account -- either an invoice settlement (crédit 411) or a manual "vente
// globale" not tied to an invoice (crédit 701/706).
//   Dr 552xxx    net amount (totalAmount - feeAmount)  → Mobile Money provider
//   Dr 631700    feeAmount                             → Frais Mobile Money
//   Cr <creditAccount>  totalAmount
// Reuses the per-provider 552xxx sub-accounts and the 631700 fee account
// already seeded for module P7, instead of the flat 552/6318 accounts, to
// keep a single consistent Mobile Money mapping across the whole app.
export function computeMobileMoneyInflowJournalLines(input: {
  provider: string;
  totalAmount: number;
  feeAmount: number;
  creditAccount: string;
  creditLabel: string;
}): ComputedJournalLine[] {
  if (input.feeAmount < 0 || input.feeAmount >= input.totalAmount) {
    throw new AccountingEngineError(
      "Les frais doivent être positifs et strictement inférieurs au montant total.",
    );
  }
  const netAmount = input.totalAmount - input.feeAmount;
  const mmAccount = MOBILE_MONEY_PROVIDER_ACCOUNTS[input.provider] ?? "552100";
  const mmLabel = MOBILE_MONEY_PROVIDER_LABELS[input.provider] ?? "Mobile Money";

  const lines: ComputedJournalLine[] = [
    {
      accountNumber: mmAccount,
      label: mmLabel,
      debitAmount: netAmount,
      creditAmount: 0,
    },
  ];

  if (input.feeAmount > 0) {
    lines.push({
      accountNumber: "631700",
      label: "Frais sur instruments monétaires électroniques",
      debitAmount: input.feeAmount,
      creditAmount: 0,
    });
  }

  lines.push({
    accountNumber: input.creditAccount,
    label: input.creditLabel,
    debitAmount: 0,
    creditAmount: input.totalAmount,
  });

  return lines;
}

// Module Trésorerie Mobile Money: step 1 of a "Rapatriement de fonds" --
// funds leave the Mobile Money account and land in the 585 transit account,
// pending confirmation that they were actually received in the bank.
//   Dr 585      amount  → Virements de fonds (transit)
//   Cr 552xxx   amount  → Mobile Money provider
export function computeMobileMoneyRepatriationOutflowLines(input: {
  provider: string;
  amount: number;
}): ComputedJournalLine[] {
  const mmAccount = MOBILE_MONEY_PROVIDER_ACCOUNTS[input.provider] ?? "552100";
  const mmLabel = MOBILE_MONEY_PROVIDER_LABELS[input.provider] ?? "Mobile Money";
  return [
    {
      accountNumber: "585100",
      label: "Virements de fonds — Mobile Money vers Banque",
      debitAmount: input.amount,
      creditAmount: 0,
    },
    {
      accountNumber: mmAccount,
      label: mmLabel,
      debitAmount: 0,
      creditAmount: input.amount,
    },
  ];
}

// Module Trésorerie Mobile Money: step 2 of a "Rapatriement de fonds" --
// the cabinet/PME confirms the funds actually landed in the bank account,
// clearing the 585100 transit account into 521100 (Banque).
//   Dr 521100  amount  → Banques locales
//   Cr 585100  amount  → Virements de fonds (transit)
export function computeMobileMoneyRepatriationReceptionLines(input: {
  amount: number;
}): ComputedJournalLine[] {
  return [
    {
      accountNumber: "521100",
      label: "Banques locales",
      debitAmount: input.amount,
      creditAmount: 0,
    },
    {
      accountNumber: "585100",
      label: "Virements de fonds — Mobile Money vers Banque",
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
  // Module Trésorerie Mobile Money: when the caller knows the specific Mobile
  // Money provider (via mobileMoneyAccountId), use the per-provider Classe 55
  // sub-account (552100 Orange / 552200 Wave / etc.) instead of the generic
  // "552" fallback. Only applies when paymentMethod is "mobile_money".
  mmProvider?: string | null;
}): ComputedJournalLine[] {
  if (input.amount <= 0) {
    throw new AccountingEngineError("Le montant doit être strictement positif.");
  }
  const thirdParty = THIRD_PARTY_ACCOUNTS[input.type];
  const treasuryAccount =
    input.paymentMethod === "mobile_money" && input.mmProvider
      ? (MOBILE_MONEY_PROVIDER_ACCOUNTS[input.mmProvider] ?? PAYMENT_METHOD_ACCOUNTS.mobile_money)
      : PAYMENT_METHOD_ACCOUNTS[input.paymentMethod];
  const treasuryLabel =
    input.paymentMethod === "mobile_money" && input.mmProvider
      ? (MOBILE_MONEY_PROVIDER_LABELS[input.mmProvider] ?? PAYMENT_METHOD_LABELS["mobile_money"])
      : PAYMENT_METHOD_LABELS[input.paymentMethod];

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
