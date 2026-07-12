import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useGetCurrentUser, useLogin, useRegister, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { setToken, removeToken, getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export function useAuth() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const userQuery = useGetCurrentUser({
    query: {
      enabled: !!getToken(),
      retry: false,
      queryKey: getGetCurrentUserQueryKey(),
    }
  });

  // A stored token that the API rejects (expired/invalid) must not be kept
  // around — otherwise every future page load re-sends it, gets another
  // 401, and the app never reaches the login screen on its own.
  useEffect(() => {
    if (userQuery.isError) {
      removeToken();
    }
  }, [userQuery.isError]);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data.user);
        setLocation("/dashboard");
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
        setLocation("/dashboard");
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
