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

const registerSchema = z.object({
  firmName: z.string().min(2, { message: "Le nom du cabinet doit contenir au moins 2 caractères" }),
  fullName: z.string().min(2, { message: "Votre nom complet doit contenir au moins 2 caractères" }),
  email: z.string().email({ message: "Email invalide" }),
  password: z.string().min(8, { message: "Le mot de passe doit contenir au moins 8 caractères" }),
})

export default function Register() {
  const { register, isRegistering } = useAuth()
  
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firmName: "",
      fullName: "",
      email: "",
      password: "",
    },
  })

  function onSubmit(values: z.infer<typeof registerSchema>) {
    register({ data: values })
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
        
        <Card className="border-border/50 shadow-lg" data-testid="card-register">
          <CardHeader className="space-y-2 text-center pb-8 pt-8">
            <CardTitle className="text-2xl font-bold tracking-tight">Inscription</CardTitle>
            <CardDescription className="text-base">
              Créez votre cabinet sur la plateforme
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="firmName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom du cabinet</FormLabel>
                      <FormControl>
                        <Input placeholder="Cabinet Kouassi & Associés" {...field} data-testid="input-firm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom de l'administrateur</FormLabel>
                      <FormControl>
                        <Input placeholder="Kouassi Yao" {...field} data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                <div className="pt-2">
                  <Button type="submit" className="w-full" disabled={isRegistering} data-testid="button-submit">
                    {isRegistering ? "Création en cours..." : "Créer le cabinet"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
          <CardFooter className="flex justify-center border-t border-border/50 p-6 bg-muted/20">
            <div className="text-sm text-muted-foreground text-center">
              Déjà inscrit ?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline" data-testid="link-login">
                Se connecter
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
