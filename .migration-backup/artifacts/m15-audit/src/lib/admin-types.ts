/**
 * Types partagés pour le module Super Admin.
 * Ces types reflètent les réponses de l'API /admin/*.
 */

export type StatutCabinet = "trial" | "active" | "suspended"
export type PlanAbonnement = "basic" | "pro" | "enterprise"
export type StatutLicence = "active" | "expired" | "revoked"

export interface Cabinet {
  id: number
  name: string
  status: StatutCabinet
  subscriptionTier: PlanAbonnement
  maxPmeAllowed: number
  contactEmail: string | null
  contactName: string | null
  phone: string | null
  createdAt: string
}

export interface Licence {
  id: number
  firmId: number
  licenseKey: string
  status: StatutLicence
  tier: PlanAbonnement
  startDate: string
  endDate: string
  pricePaid: number
  notes: string | null
  createdById: number | null
  createdAt: string
}

export interface CabinetAvecDetails extends Cabinet {
  pmeCount: number
  activeLicense: Licence | null
}

export interface LicenceAvecCabinet extends Licence {
  firm: Cabinet
}

export interface MetriquesAdmin {
  totalRevenueFcfa: number
  activeFirms: number
  trialFirms: number
  suspendedFirms: number
  totalFirms: number
  expiringLicenses: number
  totalPme: number
}

export interface GenerationLicenceInput {
  firmId: number
  tier: PlanAbonnement
  durationMonths: number
  pricePaid: number
  notes?: string
}

export interface ResultatGenerationLicence {
  license: Licence
  firm: Cabinet
}

// ── Labels ────────────────────────────────────────────────────────────────────

export const LABELS_PLAN: Record<PlanAbonnement, string> = {
  basic: "Basique",
  pro: "Pro",
  enterprise: "Entreprise",
}

export const LABELS_STATUT_CABINET: Record<StatutCabinet, string> = {
  trial: "Essai",
  active: "Actif",
  suspended: "Suspendu",
}

export const LABELS_STATUT_LICENCE: Record<StatutLicence, string> = {
  active: "Active",
  expired: "Expirée",
  revoked: "Révoquée",
}

// ── Couleurs Tailwind (mode clair + sombre) ───────────────────────────────────

export const COULEURS_PLAN: Record<PlanAbonnement, string> = {
  basic: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  pro: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  enterprise: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
}

export const COULEURS_STATUT_CABINET: Record<StatutCabinet, string> = {
  trial: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  suspended: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
}

export const COULEURS_STATUT_LICENCE: Record<StatutLicence, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  expired: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
}
