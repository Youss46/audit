import { useEffect, useState } from "react";
import { X, Download, Share } from "lucide-react";

// Extend Window type for the install prompt event
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STORAGE_KEY = "m15-pwa-banner-dismissed";

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && (window.navigator as any).standalone === true)
  );
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSBanner, setShowIOSBanner] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed or user dismissed
    if (isInStandaloneMode()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    if (isIOS()) {
      // iOS: show manual instructions banner
      setShowIOSBanner(true);
      setVisible(true);
      return;
    }

    // Chrome / Edge (desktop + Android): catch the install event
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "1");
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    setVisible(false);
    setDeferredPrompt(null);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#1e3a5f] text-white shadow-lg"
      role="banner"
      aria-label="Installer l'application"
    >
      <div className="mx-auto max-w-2xl flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center font-bold text-sm">
          M15
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Installer M15 AUDIT</p>
          {showIOSBanner ? (
            <p className="text-xs text-white/70 mt-0.5 leading-snug">
              Appuyez sur{" "}
              <span className="inline-flex items-center gap-0.5 font-medium text-white">
                <Share className="h-3 w-3" /> Partager
              </span>
              , puis <span className="font-medium text-white">« Sur l'écran d'accueil »</span>
            </p>
          ) : (
            <p className="text-xs text-white/70 mt-0.5">
              Accédez rapidement sans passer par le navigateur
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!showIOSBanner && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 bg-white text-[#1e3a5f] text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-white/90 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Installer
            </button>
          )}
          <button
            onClick={dismiss}
            className="text-white/60 hover:text-white p-1 transition-colors"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
