import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SessionTimeoutDialogProps {
  open: boolean;
  secondsLeft: number;
  onStay: () => void;
  onLogout: () => void;
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}:${String(sec).padStart(2, "0")} min`;
  return `${sec} seconde${sec !== 1 ? "s" : ""}`;
}

export function SessionTimeoutDialog({
  open,
  secondsLeft,
  onStay,
  onLogout,
}: SessionTimeoutDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="text-xl">⏱️</span>
            Session sur le point d'expirer
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Vous êtes inactif depuis un moment. Par mesure de sécurité,
                vous serez automatiquement déconnecté dans&nbsp;:
              </p>
              <div className="text-center">
                <span className="text-3xl font-bold tabular-nums text-foreground">
                  {formatCountdown(secondsLeft)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Cliquez sur <strong>Rester connecté</strong> pour poursuivre
                votre session, ou <strong>Se déconnecter</strong> pour terminer
                maintenant.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onLogout}>
            Se déconnecter
          </AlertDialogCancel>
          <AlertDialogAction onClick={onStay}>
            Rester connecté
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
