import App from "./App"
import { createRoot } from "react-dom/client"
import "./index.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("No root element found")
}

createRoot(root).render(<App />)
