import App from "./App"
import { createRoot } from "react-dom/client"
import "./index.css"
import { setBaseUrl } from "@workspace/api-client-react"

// VITE_API_URL pointe vers le backend Railway en production.
// En dev (Replit), la variable est absente : les appels restent relatifs (/api/...)
// et sont acheminés par le proxy Replit vers le même domaine.
const apiUrl = import.meta.env.VITE_API_URL
if (apiUrl) {
  setBaseUrl(apiUrl)
}

// Register PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {
      // SW registration failed — non-blocking, app still works
    });
  });
}

const root = document.getElementById("root")

if (!root) {
  throw new Error("No root element found")
}

createRoot(root).render(<App />)

// Dismiss the splash screen once React has painted the first frame.
// We wait for the progress-bar animation (≈2 s) before hiding so the
// animation always completes even on a fast connection.
const splash = document.getElementById("splash")
if (splash) {
  const MIN_SPLASH_MS = 2000 // match bar-fill animation duration
  const start = performance.now()
  requestAnimationFrame(() => {
    const elapsed = performance.now() - start
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed)
    setTimeout(() => {
      splash.classList.add("splash-hidden")
      splash.addEventListener("transitionend", () => splash.remove(), { once: true })
    }, remaining)
  })
}
