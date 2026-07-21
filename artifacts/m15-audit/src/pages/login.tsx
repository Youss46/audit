import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Link } from "wouter"
import { useAuth } from "@/hooks/use-auth"
import { ShieldAlert, Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { LoginHeroSlider } from "@/components/auth/LoginHeroSlider"
import { HelpButton } from "@/components/support/HelpSupportPanel"

const loginSchema = z.object({
  email: z.string().email({ message: "Email invalide" }),
  password: z.string().min(1, { message: "Mot de passe requis" }),
})

// Formate un nombre de secondes en "Xm Ys" ou "Xs".
function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
  return `${s}s`
}

export default function Login() {
  const { login, isLoggingIn, lockoutUntil } = useAuth()

  // ── Countdown ─────────────────────────────────────────────────────────
  const [secondsLeft, setSecondsLeft] = React.useState(0)

  React.useEffect(() => {
    if (!lockoutUntil) {
      setSecondsLeft(0)
      return
    }
    const tick = () => {
      const diff = Math.max(0, Math.ceil((lockoutUntil.getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lockoutUntil])

  const isLocked = secondsLeft > 0

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  function onSubmit(values: z.infer<typeof loginSchema>) {
    if (isLocked) return
    login({ data: values })
  }

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      <div className="flex items-center justify-center p-4 bg-muted/30 lg:order-2">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-center gap-2 font-bold text-2xl tracking-tight text-primary mb-8 lg:hidden">
            <div className="w-10 h-10 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono text-sm shadow-sm">
              M15
            </div>
            AUDIT
          </div>

          <Card className="border-border/50 shadow-lg" data-testid="card-login">
            <CardHeader className="space-y-2 text-center pb-8 pt-8">
              <CardTitle className="text-2xl font-bold tracking-tight">Connexion</CardTitle>
              <CardDescription className="text-base">
                Accédez à votre espace cabinet
              </CardDescription>
            </CardHeader>

            <CardContent>
              {/* ── Bandeau de verrouillage ── */}
              {isLocked && (
                <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/50 dark:bg-red-950/30">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                      Accès temporairement bloqué
                    </p>
                    <p className="text-xs text-red-600/80 dark:text-red-400/80 leading-relaxed">
                      Trop de tentatives incorrectes. Veuillez patienter avant de réessayer.
                    </p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Clock className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                      <span className="text-sm font-mono font-bold text-red-700 dark:text-red-300 tabular-nums">
                        {formatCountdown(secondsLeft)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email professionnel</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="kouassi.yao@cabinet.ci"
                            disabled={isLocked}
                            {...field}
                            data-testid="input-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mot de passe</FormLabel>
                        <FormControl>
                          <PasswordInput
                            placeholder="••••••••"
                            disabled={isLocked}
                            {...field}
                            data-testid="input-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoggingIn || isLocked}
                    data-testid="button-submit"
                  >
                    {isLocked
                      ? `Réessayer dans ${formatCountdown(secondsLeft)}`
                      : isLoggingIn
                      ? "Connexion en cours..."
                      : "Se connecter"
                    }
                  </Button>
                </form>
              </Form>

              <div className="text-center mt-4">
                <Link
                  href="/forgot-password"
                  style={{ display: "block", padding: "12px 0", fontSize: "0.875rem", color: "inherit", textDecoration: "none" }}
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </CardContent>

            <CardFooter className="flex justify-center border-t border-border/50 p-6 bg-muted/20">
              <div className="text-sm text-muted-foreground text-center">
                Nouveau cabinet ?{" "}
                <Link href="/register" className="text-primary font-medium hover:underline" data-testid="link-register">
                  Créer un compte
                </Link>
              </div>
            </CardFooter>
          </Card>
        </div>

        <div className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg">
          <HelpButton />
        </div>
      </div>

      <div className="lg:order-1">
        <LoginHeroSlider />
      </div>
    </div>
  )
}
