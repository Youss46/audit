import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useLocation } from "wouter"
import { useCreateClient, Sector } from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"
import { Building2, ChevronLeft, Calculator } from "lucide-react"
import { Link } from "wouter"
import { determineAccountingSystem, getSystemDescription } from "@/lib/visa-engine"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const clientSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  legalForm: z.string().min(1, "La forme juridique est requise"),
  sector: z.enum([Sector.commerce, Sector.artisanat, Sector.services], {
    required_error: "Le secteur est requis"
  }),
  rccm: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  contactName: z.string().optional(),
  annualTurnover: z.coerce.number().min(0, "Le chiffre d'affaires doit être positif").optional(),
})

export default function ClientNew() {
  const [, setLocation] = useLocation()
  const { toast } = useToast()

  const form = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: "",
      legalForm: "SARL",
      sector: Sector.services,
      rccm: "",
      taxId: "",
      address: "",
      phone: "",
      email: "",
      contactName: "",
      annualTurnover: 0,
    }
  })

  const createMutation = useCreateClient({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Client créé avec succès" })
        setLocation(`/clients/${data.id}`)
      },
      onError: (error) => {
        toast({
          title: "Erreur de création",
          description: error.data?.error || "Vérifiez les informations saisies",
          variant: "destructive"
        })
      }
    }
  })

  function onSubmit(values: z.infer<typeof clientSchema>) {
    createMutation.mutate({ data: values })
  }

  const watchedSector = form.watch("sector")
  const watchedTurnover = form.watch("annualTurnover")
  const computedSystem =
    watchedSector && watchedTurnover != null && watchedTurnover > 0
      ? determineAccountingSystem(watchedSector, watchedTurnover)
      : null

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/clients">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            Nouveau Client
          </h1>
          <p className="text-muted-foreground mt-1">
            Création d'un nouveau dossier client permanent.
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="shadow-sm border-border/50">
              <CardHeader className="pb-4">
                <CardTitle>Identité de l'entité</CardTitle>
                <CardDescription>Informations légales et administratives</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Raison sociale *</FormLabel>
                      <FormControl>
                        <Input placeholder="Ivoire Négoce SARL" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="legalForm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Forme juridique *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sélectionner..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="SARL">SARL</SelectItem>
                            <SelectItem value="SA">SA</SelectItem>
                            <SelectItem value="SAS">SAS</SelectItem>
                            <SelectItem value="SUARL">SUARL</SelectItem>
                            <SelectItem value="GIE">GIE</SelectItem>
                            <SelectItem value="EI">Entreprise Individuelle</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sector"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secteur d'activité *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sélectionner..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="commerce">Commerce</SelectItem>
                            <SelectItem value="artisanat">Artisanat</SelectItem>
                            <SelectItem value="services">Services</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="rccm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>N° RCCM</FormLabel>
                        <FormControl>
                          <Input placeholder="CI-ABJ-2023-B-12345" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="taxId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>N° Compte Contribuable</FormLabel>
                        <FormControl>
                          <Input placeholder="1234567 A" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="pb-4">
                <CardTitle>Coordonnées & Finance</CardTitle>
                <CardDescription>Contacts et profil financier</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom du contact principal</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Directeur Général" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Téléphone</FormLabel>
                        <FormControl>
                          <Input placeholder="+225..." {...field} />
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
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="contact@..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Adresse complète</FormLabel>
                      <FormControl>
                        <Input placeholder="Commune, Quartier, Rue..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="annualTurnover"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chiffre d'Affaires Annuel (FCFA)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormDescription>
                        Servira à déterminer automatiquement le système comptable.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {computedSystem && (
                  <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <Calculator className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Système SYSCOHADA applicable :</span>
                        <Badge className="font-mono">{computedSystem}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{getSystemDescription(computedSystem)}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" asChild>
              <Link href="/clients">Annuler</Link>
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Création..." : "Enregistrer le client"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
