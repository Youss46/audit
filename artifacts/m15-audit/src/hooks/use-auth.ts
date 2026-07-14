import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useGetCurrentUser, useLogin, useRegister, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { setToken, removeToken, getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { isPortalRole } from "@/lib/status";

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

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
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
        setLocation(isPortalRole(data.user!.role) ? "/portal" : "/dashboard");
      },
      onError: (error) => {
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
        setLocation(isPortalRole(data.user!.role) ? "/portal" : "/dashboard");
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
    register: registerMutation.mutate,
    isRegistering: registerMutation.isPending,
    logout
  };
}
