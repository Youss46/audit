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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 font-bold text-2xl tracking-tight text-primary mb-8">
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
                        <Input placeholder="expert@cabinet.com" {...field} data-testid="input-email" />
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
                        <Input type="password" placeholder="••••••••" {...field} data-testid="input-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isLoggingIn} data-testid="button-submit">
                  {isLoggingIn ? "Connexion en cours..." : "Se connecter"}
                </Button>
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
    </div>
  )
}
