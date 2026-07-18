import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Link } from "wouter"
import { ArrowLeft, Mail, AlertCircle } from "lucide-react"

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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { LoginHeroSlider } from "@/components/auth/LoginHeroSlider"

// En production (Vercel), VITE_API_URL pointe vers le backend Railway.
// En dev (Replit), la variable est absente : les appels restent relatifs.
const API_BASE = import.meta.env.VITE_API_URL ?? ""

const schema = z.object({
  email: z.string().email({ message: "Email invalide" }),
})

export default function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [networkError, setNetworkError] = useState<string | null>(null)

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  })

  async function onSubmit(values: z.infer<typeof schema>) {
    setSubmitting(true)
    setNetworkError(null)
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setNetworkError(data.error ?? `Erreur serveur (${res.status})`)
        return
      }
      // Always show success — server never leaks whether the email exists.
      setSent(true)
    } catch (err) {
      setNetworkError("Impossible de contacter le serveur. Vérifiez votre connexion.")
    } finally {
      setSubmitting(false)
    }
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
                Mot de passe oublié
              </CardTitle>
              <CardDescription className="text-base">
                {sent
                  ? "Vérifiez votre boîte mail"
                  : "Entrez votre email pour recevoir un lien de réinitialisation"}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {sent ? (
                <div className="flex flex-col items-center gap-4 py-4 text-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Mail className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Si un compte existe pour cette adresse, vous recevrez un email
                    avec un lien valable <strong>1 heure</strong>.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Pensez à vérifier vos spams.
                  </p>
                </div>
              ) : (
                <>
                {networkError && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 mb-4 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{networkError}</span>
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
                              type="email"
                              autoComplete="email"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting ? "Envoi en cours..." : "Envoyer le lien"}
                    </Button>
                  </form>
                </Form>
                </>
              )}
            </CardContent>

            <CardFooter className="flex justify-center border-t border-border/50 p-6 bg-muted/20">
              <Link
                href="/login"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Retour à la connexion
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>

      <div className="lg:order-1">
        <LoginHeroSlider />
      </div>
    </div>
  )
}
