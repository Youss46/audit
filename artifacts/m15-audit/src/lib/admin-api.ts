/**
 * Client API pour les routes /api/admin/*.
 * Réutilise le jeton d'authentification stocké par le formulaire de connexion
 * principal (clé "m15_audit_token"), sans double stockage.
 */

import { getToken } from "@/lib/auth"
import type {
  Cabinet,
  CabinetAvecDetails,
  Licence,
  LicenceAvecCabinet,
  MetriquesAdmin,
  GenerationLicenceInput,
  ResultatGenerationLicence,
} from "@/lib/admin-types"

const BASE = "/api"

async function apiFetch<T>(chemin: string, opts?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${chemin}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  })

  if (!res.ok) {
    const corps = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(corps.error ?? `Erreur serveur ${res.status}`)
  }

  return res.json() as Promise<T>
}

export const adminApi = {
  // ── Métriques ─────────────────────────────────────────────────────────────
  obtenirMetriques: (): Promise<MetriquesAdmin> =>
    apiFetch<MetriquesAdmin>("/admin/metrics"),

  // ── Cabinets ─────────────────────────────────────────────────────────────
  listerCabinets: (): Promise<CabinetAvecDetails[]> =>
    apiFetch<CabinetAvecDetails[]>("/admin/firms"),

  obtenirCabinet: (id: number): Promise<CabinetAvecDetails & { licenses: Licence[] }> =>
    apiFetch(`/admin/firms/${id}`),

  modifierCabinet: (id: number, donnees: Partial<Cabinet>): Promise<Cabinet> =>
    apiFetch<Cabinet>(`/admin/firms/${id}`, {
      method: "PATCH",
      body: JSON.stringify(donnees),
    }),

  suspendreCABINET: (id: number): Promise<Cabinet> =>
    apiFetch<Cabinet>(`/admin/firms/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "suspended" }),
    }),

  activerCabinet: (id: number): Promise<Cabinet> =>
    apiFetch<Cabinet>(`/admin/firms/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    }),

  // ── Licences ─────────────────────────────────────────────────────────────
  listerLicences: (): Promise<LicenceAvecCabinet[]> =>
    apiFetch<LicenceAvecCabinet[]>("/admin/licenses"),

  genererLicence: (donnees: GenerationLicenceInput): Promise<ResultatGenerationLicence> =>
    apiFetch<ResultatGenerationLicence>("/admin/licenses", {
      method: "POST",
      body: JSON.stringify(donnees),
    }),

  revoquerLicence: (id: number): Promise<Licence> =>
    apiFetch<Licence>(`/admin/licenses/${id}/revoke`, {
      method: "POST",
    }),
}
