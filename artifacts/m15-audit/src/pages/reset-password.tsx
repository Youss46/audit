import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Link, useLocation } from "wouter"
import { CheckCircle, ArrowLeft, AlertCircle } from "lucide-react"

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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { LoginHeroSlider } from "@/components/auth/LoginHeroSlider"
import { PASSWORD_POLICY_HINT, PASSWORD_POLICY_REGEX } from "@/lib/password"

// En production (Vercel), VITE_API_URL pointe vers le backend Railway.
const API_BASE = import.meta.env.VITE_API_URL ?? ""

const schema = z
  .object({
    newPassword: z
      .string()
      .min(1, { message: "Mot de passe requis" })
      .regex(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_HINT }),
    confirmPassword: z.string().min(1, { message: "Confirmation requise" }),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  })

export default function ResetPassword() {
  const [, setLocation] = useLocation()
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  // Read token from the URL query string.
  const token = new URLSearchParams(window.location.search).get("token") ?? ""

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  })

  async function onSubmit(values: z.infer<typeof schema>) {
    setSubmitting(true)
    setApiError(null)
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: values.newPassword, confirmPassword: values.confirmPassword }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setApiError(data.error ?? `Erreur serveur (${res.status})`)
        return
      }
      setDone(true)
    } catch {
      setApiError("Impossible de contacter le serveur. Vérifiez votre connexion.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <div className="grid min-h-screen w-full lg:grid-cols-2">
        <div className="flex items-center justify-center p-4 bg-muted/30 lg:order-2">
          <div className="w-full max-w-md">
            <Card className="border-border/50 shadow-lg text-center">
              <CardHeader className="pt-8 pb-4">
                <CardTitle>Lien invalide</CardTitle>
                <CardDescription>Ce lien de réinitialisation est incomplet ou expiré.</CardDescription>
              </CardHeader>
              <CardFooter className="justify-center border-t p-6 bg-muted/20">
                <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                  Demander un nouveau lien
                </Link>
              </CardFooter>
            </Card>
          </div>
        </div>
        <div className="lg:order-1"><LoginHeroSlider /></div>
      </div>
    )
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

          <Card className="border-border/50 shadow-lg">
            <CardHeader className="space-y-2 text-center pb-8 pt-8">
              <CardTitle className="text-2xl font-bold tracking-tight">
                Nouveau mot de passe
              </CardTitle>
              <CardDescription className="text-base">
                {done ? "Mot de passe mis à jour" : "Choisissez un nouveau mot de passe sécurisé"}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {done ? (
                <div className="flex flex-col items-center gap-4 py-4 text-center">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Votre mot de passe a été modifié avec succès.
                  </p>
                  <Button className="mt-2 w-full" onClick={() => setLocation("/login")}>
                    Se connecter
                  </Button>
                </div>
              ) : (
                <>
                {apiError && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 mb-4 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{apiError}</span>
                  </div>
                )}
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                      control={form.control}
                      name="newPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nouveau mot de passe</FormLabel>
                          <FormControl>
                            <PasswordInput placeholder="••••••••" autoComplete="new-password" {...field} />
                          </FormControl>
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
                            <PasswordInput placeholder="••••••••" autoComplete="new-password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting ? "Enregistrement..." : "Enregistrer le mot de passe"}
                    </Button>
                  </form>
                </Form>
                </>
              )}
            </CardContent>

            {!done && (
              <CardFooter className="flex justify-center border-t border-border/50 p-6 bg-muted/20">
                <Link
                  href="/login"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retour à la connexion
                </Link>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>

      <div className="lg:order-1">
        <LoginHeroSlider />
      </div>
    </div>
  )
}
