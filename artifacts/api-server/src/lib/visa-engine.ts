import type { AccountingSystem, Sector } from "@workspace/db";
import type { MissionStatusValue } from "@workspace/db";

// SYSCOHADA thresholds that determine the applicable accounting system from a
// client's annual turnover (chiffre d'affaires) and business sector. Amounts
// are in CFA francs (XOF), based on the standard regional enterprise triggers:
// - Système Minimal de Trésorerie (SMT): below the sector's SMT ceiling.
// - Système Comptable Allégé (ALLEGE): between the SMT ceiling and 100M.
// - Système Normal (NORMAL): above 100M for every sector.
const THRESHOLDS: Record<Sector, { smt: number; allege: number }> = {
  commerce: { smt: 60_000_000, allege: 100_000_000 },
  artisanat: { smt: 40_000_000, allege: 100_000_000 },
  services: { smt: 30_000_000, allege: 100_000_000 },
  // STATION_SERVICE is a specialised commerce sub-sector: same SYSCOHADA
  // thresholds as "commerce" but unlocks the POMPISTE staff role and
  // Pompiste-tailored quick actions on the Espace PME portal.
  STATION_SERVICE: { smt: 60_000_000, allege: 100_000_000 },
};

export function determineAccountingSystem(
  sector: Sector,
  annualTurnover: number,
): AccountingSystem {
  const thresholds = THRESHOLDS[sector];
  if (annualTurnover < thresholds.smt) return "SMT";
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

// Standard matching checks applied to every mission regardless of the
// accounting system, on top of the system-specific regulatory notes above.
const STANDARD_CHECKS = [
  "Vérification de la balance des comptes (concordance bilan / compte de résultat)",
  "Contrôle des fiches R1, R2, R3, R4",
];

export function generateChecklistLabels(system: AccountingSystem): string[] {
  switch (system) {
    case "SMT":
      return [...SMT_CHECKLIST, ...STANDARD_CHECKS];
    case "ALLEGE":
      return [...ALLEGE_CHECKLIST, ...STANDARD_CHECKS];
    case "NORMAL":
      return [...NORMAL_CHECKLIST, ...STANDARD_CHECKS];
  }
}

// --- Visa mission status workflow (module M4/P2) -------------------------
//
// The visa status follows a strict state machine. "anomalie" is a
// system-driven state: it is entered automatically as soon as a checklist
// item is flagged as an anomaly, and left automatically once every anomaly
// is resolved — it is never chosen manually from the workflow selector.
export class VisaWorkflowError extends Error {}

const MISSION_TRANSITIONS: Record<MissionStatusValue, MissionStatusValue[]> = {
  en_attente: ["en_cours"],
  en_cours: ["anomalie", "valide"],
  anomalie: ["en_cours"],
  valide: ["visa_emis"],
  visa_emis: [],
};

export function assertValidMissionTransition(
  current: MissionStatusValue,
  next: MissionStatusValue,
  ctx: { allConform: boolean; hasAnomalies: boolean },
): void {
  if (current === next) return;

  const allowed = MISSION_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new VisaWorkflowError(
      `Transition de statut invalide : "${current}" ne peut pas passer à "${next}".`,
    );
  }

  if (next === "valide" && (!ctx.allConform || ctx.hasAnomalies)) {
    throw new VisaWorkflowError(
      "Le dossier ne peut être validé : tous les points de contrôle doivent être conformes, sans anomalie en cours.",
    );
  }

  if (next === "anomalie" && !ctx.hasAnomalies) {
    throw new VisaWorkflowError(
      "Impossible de signaler une anomalie sur la mission : aucun point de contrôle n'est actuellement en anomalie.",
    );
  }
}

// Generates a mocked digital visa stamp code, e.g. "M15-VISA-2026-A93F7C".
// This simulates the cabinet's official visa stamp being affixed to the
// dossier once the SYSCOHADA control is complete.
export function generateVisaStampCode(fiscalYear: number, missionId: number): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `M15-VISA-${fiscalYear}-${missionId}${random}`;
}
