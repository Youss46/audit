import { Sector, AccountingSystem } from "@workspace/api-client-react"

// Mirrors the backend's SYSCOHADA classification (artifacts/api-server/src/lib/visa-engine.ts)
// so the UI can show the computed system instantly as the accountant types,
// without waiting for a round-trip. Keep these two in sync.
const THRESHOLDS: Record<Sector, { smt: number; allege: number }> = {
  [Sector.commerce]: { smt: 60_000_000, allege: 100_000_000 },
  [Sector.artisanat]: { smt: 40_000_000, allege: 100_000_000 },
  [Sector.services]: { smt: 30_000_000, allege: 100_000_000 },
}

export function determineAccountingSystem(sector: Sector, annualTurnover: number): AccountingSystem {
  const thresholds = THRESHOLDS[sector]
  if (annualTurnover < thresholds.smt) return AccountingSystem.SMT
  if (annualTurnover <= thresholds.allege) return AccountingSystem.ALLEGE
  return AccountingSystem.NORMAL
}

export function getSystemDescription(system: AccountingSystem): string {
  switch (system) {
    case AccountingSystem.SMT:
      return "Système Minimal de Trésorerie — 12 points de contrôle"
    case AccountingSystem.ALLEGE:
      return "Système Comptable Allégé — 24 points de contrôle"
    case AccountingSystem.NORMAL:
      return "Système Normal — 36 points de contrôle"
  }
}
