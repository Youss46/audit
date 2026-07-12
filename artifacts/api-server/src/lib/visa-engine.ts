import type { AccountingSystem, Sector } from "@workspace/db";

// SYSCOHADA thresholds (simplified for MVP) that determine the applicable
// accounting system from a client's annual turnover (chiffre d'affaires) and
// business sector. Amounts are in CFA francs.
const THRESHOLDS: Record<Sector, { smt: number; allege: number }> = {
  commerce: { smt: 30_000_000, allege: 100_000_000 },
  artisanat: { smt: 20_000_000, allege: 100_000_000 },
  services: { smt: 20_000_000, allege: 100_000_000 },
};

export function determineAccountingSystem(
  sector: Sector,
  annualTurnover: number,
): AccountingSystem {
  const thresholds = THRESHOLDS[sector];
  if (annualTurnover <= thresholds.smt) return "SMT";
  if (annualTurnover <= thresholds.allege) return "ALLEGE";
  return "NORMAL";
}

const SMT_CHECKLIST = [
  "Vérifier l'existence du registre de trésorerie",
  "Contrôler le rapprochement des soldes de caisse",
  "Vérifier le rapprochement bancaire mensuel",
  "Contrôler l'inventaire physique des stocks",
  "Vérifier les factures d'achats et de ventes",
  "Contrôler le respect des seuils du régime SMT",
  "Vérifier la déclaration fiscale annuelle",
  "Contrôler les pièces justificatives de charges",
  "Vérifier le livre des recettes-dépenses",
  "Contrôler la cohérence du chiffre d'affaires déclaré",
  "Vérifier les immobilisations et leur amortissement",
  "Valider la synthèse annuelle simplifiée",
];

const ALLEGE_CHECKLIST = [
  ...SMT_CHECKLIST,
  "Contrôler le bilan et le compte de résultat allégés",
  "Vérifier les comptes de tiers (clients/fournisseurs)",
  "Contrôler les provisions pour risques et charges",
  "Vérifier le traitement de la TVA collectée et déductible",
  "Contrôler les charges de personnel et cotisations sociales",
  "Vérifier les emprunts et dettes financières",
  "Contrôler les écritures d'inventaire de fin d'exercice",
  "Vérifier la balance générale avant clôture",
  "Contrôler les opérations intragroupe le cas échéant",
  "Vérifier le respect des obligations SYSCOHADA allégées",
  "Contrôler les notes annexes obligatoires",
  "Valider la cohérence globale des états financiers",
];

const NORMAL_CHECKLIST = [
  ...ALLEGE_CHECKLIST,
  "Contrôler le tableau des flux de trésorerie",
  "Vérifier le tableau des immobilisations et amortissements",
  "Contrôler le tableau des provisions",
  "Vérifier les engagements hors bilan",
  "Contrôler la consolidation le cas échéant",
  "Vérifier les opérations en devises étrangères",
  "Contrôler le respect des normes d'évaluation SYSCOHADA",
  "Vérifier les notes annexes détaillées obligatoires",
  "Contrôler les événements postérieurs à la clôture",
  "Vérifier la continuité d'exploitation",
  "Contrôler la conformité au plan comptable général",
  "Valider les états financiers complets avant émission du visa",
];

export function generateChecklistLabels(system: AccountingSystem): string[] {
  switch (system) {
    case "SMT":
      return SMT_CHECKLIST;
    case "ALLEGE":
      return ALLEGE_CHECKLIST;
    case "NORMAL":
      return NORMAL_CHECKLIST;
  }
}
