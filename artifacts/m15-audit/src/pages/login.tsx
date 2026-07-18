import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Link } from "wouter"
import { useAuth } from "@/hooks/use-auth"

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

export default function Login() {
  const { login, isLoggingIn } = useAuth()
  
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  function onSubmit(values: z.infer<typeof loginSchema>) {
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
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email professionnel</FormLabel>
                        <FormControl>
                          <Input placeholder="kouassi.yao@cabinet.ci" {...field} data-testid="input-email" />
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
                          <PasswordInput placeholder="••••••••" {...field} data-testid="input-password" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isLoggingIn} data-testid="button-submit">
                    {isLoggingIn ? "Connexion en cours..." : "Se connecter"}
                  </Button>
                  <div className="text-center">
                    <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                      Mot de passe oublié ?
                    </Link>
                  </div>
                </form>
              </Form>
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
