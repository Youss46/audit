import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useLocation } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { useResetFirstPassword, getGetCurrentUserQueryKey } from "@workspace/api-client-react"
import { setToken, getToken } from "@/lib/auth"
import { isStrongPassword, PASSWORD_POLICY_HINT } from "@/lib/password"
import { isPortalRole } from "@/lib/status"
import { useToast } from "@/hooks/use-toast"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { PasswordInput } from "@/components/ui/password-input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldAlert } from "lucide-react"

// Module M33 (Réinitialisation Forcée du Mot de Passe Temporaire): the
// interceptor screen a first-login user (cabinet staff or PME staff) lands
// on instead of the normal Shell. The restricted token returned by
// /auth/login only works against POST /auth/reset-first-password -- every
// other route rejects it (see requireAuth on the server) -- so there is no
// way to "skip" this screen and reach the dashboard directly.
const schema = z
  .object({
    newPassword: z
      .string()
      .min(8, { message: "8 caractères minimum" })
      .refine(isStrongPassword, { message: PASSWORD_POLICY_HINT }),
    confirmPassword: z.string().min(8, { message: "8 caractères minimum" }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  })

export default function ForcePasswordChange() {
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // A user who lands here without a (restricted) token has nothing to
  // reset -- send them back to login rather than showing a dead form.
  useEffect(() => {
    if (!getToken()) {
      setLocation("/login")
    }
  }, [setLocation])

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  })

  const resetMutation = useResetFirstPassword({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token)
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data.user)
        toast({ title: "Mot de passe mis à jour", description: "Bienvenue !" })
        setLocation(isPortalRole(data.user!.role) ? "/portal" : "/dashboard")
      },
      onError: (error) => {
        toast({
          title: "Erreur",
          description: error.data?.error || "Impossible de mettre à jour le mot de passe",
          variant: "destructive",
        })
      },
    },
  })

  function onSubmit(values: z.infer<typeof schema>) {
    resetMutation.mutate({ data: values })
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 font-bold text-2xl tracking-tight text-primary mb-8">
          <div className="w-10 h-10 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono text-sm shadow-sm">
            M15
          </div>
          AUDIT
        </div>

        <Card className="border-border/50 shadow-lg" data-testid="card-force-password-change">
          <CardHeader className="space-y-2 text-center pb-6 pt-8">
            <div className="mx-auto h-12 w-12 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-2">
              <ShieldAlert className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              Changement de mot de passe requis
            </CardTitle>
            <CardDescription className="text-base">
              Pour votre sécurité, vous devez remplacer votre mot de passe temporaire
              avant de continuer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nouveau mot de passe</FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="••••••••" {...field} data-testid="input-new-password" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmer le mot de passe</FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="••••••••" {...field} data-testid="input-confirm-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={resetMutation.isPending}
                  data-testid="button-submit"
                >
                  {resetMutation.isPending ? "Mise à jour..." : "Valider le nouveau mot de passe"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
