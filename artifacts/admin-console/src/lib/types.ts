export type FirmStatus = "trial" | "active" | "suspended";
export type SubscriptionTier = "basic" | "pro" | "enterprise";
export type LicenseStatus = "active" | "expired" | "revoked";

export interface Firm {
  id: number;
  name: string;
  status: FirmStatus;
  subscriptionTier: SubscriptionTier;
  maxPmeAllowed: number;
  contactEmail: string | null;
  contactName: string | null;
  phone: string | null;
  createdAt: string;
}

export interface License {
  id: number;
  firmId: number;
  licenseKey: string;
  status: LicenseStatus;
  tier: SubscriptionTier;
  startDate: string;
  endDate: string;
  pricePaid: number;
  notes: string | null;
  createdById: number | null;
  createdAt: string;
}

export interface FirmWithDetails extends Firm {
  pmeCount: number;
  activeLicense: License | null;
}

export interface LicenseWithFirm extends License {
  firm: Firm;
}

export interface AdminMetrics {
  totalRevenueFcfa: number;
  activeFirms: number;
  trialFirms: number;
  suspendedFirms: number;
  totalFirms: number;
  expiringLicenses: number;
  totalPme: number;
}

export interface GenerateLicenseInput {
  firmId: number;
  tier: SubscriptionTier;
  durationMonths: number;
  pricePaid: number;
  notes?: string;
}

export interface GeneratedLicenseResult {
  license: License;
  firm: Firm;
}

export interface AdminUser {
  id: number;
  email: string;
  fullName: string;
  role: string;
  firmId: number;
}

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  basic: "Basique",
  pro: "Pro",
  enterprise: "Entreprise",
};

export const STATUS_LABELS: Record<FirmStatus, string> = {
  trial: "Essai",
  active: "Actif",
  suspended: "Suspendu",
};

export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  active: "Active",
  expired: "Expirée",
  revoked: "Révoquée",
};

export const TIER_COLORS: Record<SubscriptionTier, string> = {
  basic: "bg-slate-700 text-slate-200",
  pro: "bg-indigo-900/60 text-indigo-300 border border-indigo-700/50",
  enterprise: "bg-amber-900/60 text-amber-300 border border-amber-700/50",
};

export const FIRM_STATUS_COLORS: Record<FirmStatus, string> = {
  trial: "bg-slate-700/60 text-slate-300",
  active: "bg-emerald-900/60 text-emerald-400 border border-emerald-700/50",
  suspended: "bg-red-900/60 text-red-400 border border-red-700/50",
};

export const LICENSE_STATUS_COLORS: Record<LicenseStatus, string> = {
  active: "bg-emerald-900/60 text-emerald-400 border border-emerald-700/50",
  expired: "bg-slate-700/60 text-slate-400",
  revoked: "bg-red-900/60 text-red-400 border border-red-700/50",
};
