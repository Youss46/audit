import { setAuthTokenGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "m15_audit_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Retourne la base URL de l'API.
 * - En production (Vercel) : VITE_API_URL pointe vers le backend Railway,
 *   ex : "https://api.m15-audit.up.railway.app"
 * - En dev (Replit) : la variable est absente → chaîne vide → URL relative,
 *   acheminée par le proxy Replit vers artifacts/api-server.
 */
export function getApiBase(): string {
  return import.meta.env.VITE_API_URL ?? "";
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Initialize custom-fetch with our token getter
setAuthTokenGetter(() => getToken());
