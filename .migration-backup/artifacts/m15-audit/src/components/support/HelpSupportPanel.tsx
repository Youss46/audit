import * as React from "react"
import { HelpCircle, Mail, Phone, MessageCircle, LifeBuoy } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

// Module M30 (Aide & Support): a persistent "?" entry point in the topbar,
// available to every authenticated role (cabinet and Espace PME alike).
// Two sections: a self-serve FAQ accordion, and a support contact card
// with mailto/tel/WhatsApp deep links so users can reach a human without
// leaving the app. Kept as static, hardcoded content for this MVP --
// no new API surface, table, or route needed.
const FAQ_ITEMS = [
  {
    question: "Comment soumettre une dépense ?",
    answer:
      "Allez dans votre espace « Dépenses », remplissez les champs et prenez en photo ou importez obligatoirement votre pièce justificative (facture ou reçu) avant de cliquer sur Soumettre.",
  },
  {
    question: "Comment mes factures de ventes sont-elles générées ?",
    answer:
      "Lorsque vous enregistrez une vente dans le module « Facturation », l'application génère automatiquement un PDF conforme et l'attache directement comme pièce justificative pour le cabinet.",
  },
  {
    question: "Puis-je créer des accès pour mes employés ?",
    answer:
      "Oui, si vous êtes Administrateur de votre entreprise, rendez-vous dans les Paramètres > Gestion du personnel pour ajouter vos collaborateurs (commerciaux, agents de terrain, pompistes, etc.) avec des accès restreints.",
  },
]

const SUPPORT_CONTACT = {
  name: "Youssouf Sawadogo",
  role: "Développeur & Administrateur Système M15-Audit",
  email: "contacteyouss@gmail.com",
  phoneDisplay: "+225 07 14 17 40 82",
  phoneTel: "+2250714174082",
  phoneWhatsApp: "2250714174082",
}

export function HelpButton() {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/50"
          data-testid="button-help-support"
        >
          <HelpCircle className="h-5 w-5" />
          <span className="sr-only">Aide &amp; Support</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0" data-testid="panel-help-support">
        <SheetHeader className="p-6 pb-4 border-b bg-gradient-to-br from-sky-50 to-emerald-50 dark:from-sky-950/20 dark:to-emerald-950/20">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              <LifeBuoy className="h-5 w-5" />
            </span>
            <div>
              <SheetTitle>Centre d'Assistance &amp; Support</SheetTitle>
              <SheetDescription>
                Nous sommes là pour vous aider à chaque étape.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-1">
                Foire Aux Questions
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Les réponses aux questions les plus fréquentes de nos utilisateurs.
              </p>
              <Accordion type="single" collapsible className="w-full" data-testid="accordion-faq">
                {FAQ_ITEMS.map((item, index) => (
                  <AccordionItem key={index} value={`faq-${index}`} data-testid={`faq-item-${index}`}>
                    <AccordionTrigger className="text-sm" data-testid={`faq-question-${index}`}>
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground" data-testid={`faq-answer-${index}`}>
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>

            <Separator />

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-1">
                Contacter le Support Technique
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Une question, un bug, ou besoin d'un accompagnement personnalisé ? Écrivez-nous.
              </p>
              <div
                className="rounded-xl border bg-gradient-to-br from-sky-50/60 to-emerald-50/60 dark:from-sky-950/10 dark:to-emerald-950/10 p-4 space-y-3"
                data-testid="card-support-contact"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground" data-testid="text-support-name">
                    {SUPPORT_CONTACT.name}
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="text-support-role">
                    {SUPPORT_CONTACT.role}
                  </p>
                </div>

                <div className="space-y-2">
                  <a
                    href={`mailto:${SUPPORT_CONTACT.email}`}
                    className="flex items-center gap-2 text-sm text-foreground hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
                    data-testid="link-support-email"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 shrink-0">
                      <Mail className="h-4 w-4" />
                    </span>
                    {SUPPORT_CONTACT.email}
                  </a>
                  <a
                    href={`tel:${SUPPORT_CONTACT.phoneTel}`}
                    className="flex items-center gap-2 text-sm text-foreground hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
                    data-testid="link-support-phone"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 shrink-0">
                      <Phone className="h-4 w-4" />
                    </span>
                    {SUPPORT_CONTACT.phoneDisplay}
                  </a>
                  <a
                    href={`https://wa.me/${SUPPORT_CONTACT.phoneWhatsApp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-foreground hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                    data-testid="link-support-whatsapp"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 shrink-0">
                      <MessageCircle className="h-4 w-4" />
                    </span>
                    Discuter sur WhatsApp
                  </a>
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
