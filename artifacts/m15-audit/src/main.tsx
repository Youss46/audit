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

const root = document.getElementById("root")

if (!root) {
  throw new Error("No root element found")
}

createRoot(root).render(<App />)
