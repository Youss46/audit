import { Link } from "wouter"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="text-6xl font-mono text-primary font-bold mb-4">404</div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">Page non trouvée</h1>
      <p className="text-muted-foreground mb-8 max-w-md">
        Le dossier ou la page que vous recherchez n'existe pas ou vous n'avez pas les permissions nécessaires pour y accéder.
      </p>
      <Button asChild>
        <Link href="/dashboard">Retour au tableau de bord</Link>
      </Button>
    </div>
  )
}
