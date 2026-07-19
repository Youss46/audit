import { useCallback, useEffect, useRef, useState } from "react";

// ── Tunable constants ────────────────────────────────────────────────────────
/** Total inactivity time before forced logout (ms). */
const IDLE_MS = 15 * 60 * 1000; // 15 minutes

/** How long before logout to show the "still there?" dialog (ms). */
const WARN_MS = 2 * 60 * 1000; // warn at 13 minutes → 2-min countdown

/** Activity events that reset the idle timer. */
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "pointerdown",
];
// ────────────────────────────────────────────────────────────────────────────

export interface IdleTimeoutState {
  /** True when the 2-minute warning dialog should be shown. */
  showWarning: boolean;
  /** Remaining seconds shown in the warning dialog countdown. */
  secondsLeft: number;
  /** Call this when the user chooses "Rester connecté". Resets the idle timer. */
  stayConnected: () => void;
}

/**
 * Detects inactivity and calls `onLogout` after IDLE_MS of no user input.
 * Shows a warning dialog WARN_MS before the logout.
 *
 * Only active when `enabled` is true (i.e. when the user is authenticated).
 */
export function useIdleTimeout(onLogout: () => void, enabled: boolean): IdleTimeoutState {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARN_MS / 1000);

  // Store timestamps in refs to avoid stale closures inside event listeners.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  const clearAll = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const startCountdown = useCallback(() => {
    let secs = WARN_MS / 1000;
    setSecondsLeft(secs);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      secs -= 1;
      setSecondsLeft(secs);
      if (secs <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    }, 1000);
  }, []);

  const resetTimer = useCallback(() => {
    clearAll();
    setShowWarning(false);
    setSecondsLeft(WARN_MS / 1000);

    // Schedule warning
    warnTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown();
    }, IDLE_MS - WARN_MS);

    // Schedule logout
    idleTimerRef.current = setTimeout(() => {
      setShowWarning(false);
      onLogoutRef.current();
    }, IDLE_MS);
  }, [clearAll, startCountdown]);

  const stayConnected = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!enabled) {
      clearAll();
      setShowWarning(false);
      return;
    }

    // Start the initial idle timer.
    resetTimer();

    // Attach activity listeners with throttle: at most one reset per second.
    let lastReset = 0;
    const onActivity = () => {
      // While the warning is showing, activity does NOT reset — only the
      // explicit "Rester connecté" button does, to make the warning deliberate.
      if (showWarning) return;
      const now = Date.now();
      if (now - lastReset < 1000) return;
      lastReset = now;
      resetTimer();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    return () => {
      clearAll();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { showWarning, secondsLeft, stayConnected };
}
