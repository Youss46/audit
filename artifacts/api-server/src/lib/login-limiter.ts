/**
 * Login rate limiter — protection anti brute-force
 *
 * Implémentation en mémoire (par processus) : suffisant pour un déploiement
 * VM mono-instance. Sur une architecture multi-instances (autoscale), le
 * blocage est par instance ; pour une protection totale, migrer vers un store
 * Redis partagé.
 *
 * Règles :
 *   - 3 échecs consécutifs → verrouillage 15 minutes
 *   - La fenêtre se réinitialise après connexion réussie ou expiration du verrou
 *   - Clé : email normalisé (lowercase + trim)
 */

const MAX_FAILURES   = 3;
const LOCKOUT_MS     = 15 * 60 * 1000; // 15 minutes
const CLEANUP_EVERY  = 10 * 60 * 1000; // nettoyage toutes les 10 min

interface AttemptRecord {
  count:        number;
  blockedUntil: Date | null;
}

const store = new Map<string, AttemptRecord>();

// ── Nettoyage périodique des entrées expirées ──────────────────────────────
function purgeExpired() {
  const now = Date.now();
  for (const [key, rec] of store) {
    if (rec.blockedUntil && rec.blockedUntil.getTime() <= now) {
      store.delete(key);
    } else if (!rec.blockedUntil && rec.count === 0) {
      store.delete(key);
    }
  }
}
setInterval(purgeExpired, CLEANUP_EVERY).unref();

function normalise(email: string): string {
  return email.toLowerCase().trim();
}

// ── API publique ───────────────────────────────────────────────────────────

/**
 * Vérifie si un email est actuellement verrouillé.
 * Retourne `{ blocked: false }` ou `{ blocked: true, secondsLeft }`.
 */
export function isBlocked(email: string): { blocked: boolean; secondsLeft: number } {
  const key = normalise(email);
  const rec = store.get(key);
  if (!rec?.blockedUntil) return { blocked: false, secondsLeft: 0 };

  if (rec.blockedUntil.getTime() > Date.now()) {
    const secondsLeft = Math.ceil((rec.blockedUntil.getTime() - Date.now()) / 1000);
    return { blocked: true, secondsLeft };
  }

  // Verrou expiré : reset automatique
  store.delete(key);
  return { blocked: false, secondsLeft: 0 };
}

/**
 * Enregistre un échec de connexion.
 * Si le seuil est atteint, pose un verrou de 15 minutes.
 */
export function recordFailure(email: string): void {
  const key = normalise(email);
  let rec   = store.get(key);

  if (!rec) {
    rec = { count: 0, blockedUntil: null };
  } else if (rec.blockedUntil && rec.blockedUntil.getTime() <= Date.now()) {
    // Verrou précédent expiré — repart de zéro
    rec = { count: 0, blockedUntil: null };
  }

  rec.count += 1;

  if (rec.count >= MAX_FAILURES) {
    rec.blockedUntil = new Date(Date.now() + LOCKOUT_MS);
  }

  store.set(key, rec);
}

/**
 * Réinitialise le compteur d'échecs (appelé après connexion réussie).
 */
export function resetAttempts(email: string): void {
  store.delete(normalise(email));
}

/**
 * Retourne le nombre d'échecs restants avant verrouillage (pour info frontend).
 */
export function attemptsLeft(email: string): number {
  const key = normalise(email);
  const rec = store.get(key);
  if (!rec || (rec.blockedUntil && rec.blockedUntil.getTime() <= Date.now())) {
    return MAX_FAILURES;
  }
  return Math.max(0, MAX_FAILURES - rec.count);
}

export { MAX_FAILURES, LOCKOUT_MS };
