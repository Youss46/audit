import { setAuthTokenGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "m15_audit_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Initialize custom-fetch with our token getter
setAuthTokenGetter(() => getToken());
