import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useGetCurrentUser, useLogin, useRegister, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { setToken, removeToken, getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { isPortalRole, isSuperAdmin } from "@/lib/status";

// Aiguillage post-connexion selon le rôle utilisateur.
// super_admin → /admin/dashboard (console système)
// client_pme / client_staff → /portal (espace PME)
// rôles cabinet → /dashboard
function routePostConnexion(role: string | null | undefined): string {
  if (isSuperAdmin(role)) return "/admin/dashboard";
  if (isPortalRole(role)) return "/portal";
  return "/dashboard";
}

export function useAuth() {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  // Module M33: a restricted password-reset token is never valid against
  // /auth/me (requireAuth rejects it everywhere except
  // /auth/reset-first-password) -- calling it here would immediately
  // 403 and, via the effect below, delete the very token the
  // force-password-change page needs to submit its form.
  const isForcePasswordChangeRoute = location === "/force-password-change";

  const userQuery = useGetCurrentUser({
    query: {
      enabled: !!getToken() && !isForcePasswordChangeRoute,
      retry: false,
      queryKey: getGetCurrentUserQueryKey(),
    }
  });

  // A stored token that the API rejects (expired/invalid) must not be kept
  // around — otherwise every future page load re-sends it, gets another
  // 401, and the app never reaches the login screen on its own.
  useEffect(() => {
    if (userQuery.isError && !isForcePasswordChangeRoute) {
      removeToken();
    }
  }, [userQuery.isError, isForcePasswordChangeRoute]);

  // Lockout state — populated when the API returns 429 (brute-force protection).
  const [lockoutUntil, setLockoutUntil] = useState<Date | null>(null);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        setLockoutUntil(null);
        // Module M33: the account still has an unresolved temporary
        // password -- the token is restricted and only works against
        // /auth/reset-first-password. Redirect there instead of loading
        // the normal Shell/dashboard.
        if (data.status === "FORCE_PASSWORD_CHANGE") {
          setToken(data.token);
          setLocation("/force-password-change");
          return;
        }
        setToken(data.token);
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data.user);
        setLocation(routePostConnexion(data.user!.role));
      },
      onError: (error) => {
        // 429 — trop de tentatives → activer le verrou côté client
        const retryAfter: number | undefined = (error.data as { retryAfter?: number } | undefined)?.retryAfter;
        if (retryAfter) {
          setLockoutUntil(new Date(Date.now() + retryAfter * 1000));
          // Le message de verrou est dans error.data.error — pas de toast
          // redondant ici ; le composant login affiche le bandeau.
          return;
        }
        toast({
          title: "Erreur de connexion",
          description: error.data?.error || "Identifiants invalides",
          variant: "destructive"
        });
      }
    }
  });

  const registerMutation = useRegister({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data.user);
        setLocation(routePostConnexion(data.user!.role));
      },
      onError: (error) => {
        toast({
          title: "Erreur d'inscription",
          description: error.data?.error || "Vérifiez vos informations",
          variant: "destructive"
        });
      }
    }
  });

  const logout = () => {
    removeToken();
    queryClient.clear();
    setLocation("/login");
  };

  return {
    user: userQuery.data,
    isLoading: userQuery.isLoading,
    isError: userQuery.isError,
    login: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    lockoutUntil,
    register: registerMutation.mutate,
    isRegistering: registerMutation.isPending,
    logout
  };
}
