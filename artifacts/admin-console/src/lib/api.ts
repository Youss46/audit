import type {
  AdminMetrics,
  FirmWithDetails,
  Firm,
  LicenseWithFirm,
  GenerateLicenseInput,
  GeneratedLicenseResult,
  AdminUser,
  License,
} from "./types";

const API_BASE = "/api";

const TOKEN_KEY = "m15_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch<T>(
  path: string,
  opts?: RequestInit,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Erreur serveur ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  login: async (
    email: string,
    password: string,
  ): Promise<{ token: string; user: AdminUser }> => {
    const data = await apiFetch<{
      token: string;
      user: AdminUser;
      status?: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (data.user?.role !== "super_admin") {
      throw new Error(
        "Accès refusé. Ce portail est réservé aux administrateurs système.",
      );
    }

    return { token: data.token, user: data.user };
  },

  // Metrics
  getMetrics: (): Promise<AdminMetrics> =>
    apiFetch<AdminMetrics>("/admin/metrics"),

  // Firms
  listFirms: (): Promise<FirmWithDetails[]> =>
    apiFetch<FirmWithDetails[]>("/admin/firms"),

  getFirm: (id: number): Promise<FirmWithDetails & { licenses: License[] }> =>
    apiFetch(`/admin/firms/${id}`),

  updateFirm: (
    id: number,
    data: Partial<Firm>,
  ): Promise<Firm> =>
    apiFetch<Firm>(`/admin/firms/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  suspendFirm: (id: number): Promise<Firm> =>
    apiFetch<Firm>(`/admin/firms/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "suspended" }),
    }),

  activateFirm: (id: number): Promise<Firm> =>
    apiFetch<Firm>(`/admin/firms/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    }),

  // Licenses
  listLicenses: (): Promise<LicenseWithFirm[]> =>
    apiFetch<LicenseWithFirm[]>("/admin/licenses"),

  generateLicense: (data: GenerateLicenseInput): Promise<GeneratedLicenseResult> =>
    apiFetch<GeneratedLicenseResult>("/admin/licenses", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  revokeLicense: (id: number): Promise<License> =>
    apiFetch<License>(`/admin/licenses/${id}/revoke`, {
      method: "POST",
    }),
};
