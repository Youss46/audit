---
name: Frontend API URL pattern
description: Règle pour les fetch vers le backend dans m15-audit — toujours préfixer avec getApiBase()
---

## Règle

Tous les `fetch('/api/...')` dans `artifacts/m15-audit/src/` doivent être remplacés par `fetch(\`${getApiBase()}/api/...\`)`.

Importer depuis `@/lib/auth` : `import { getToken, getApiBase } from "@/lib/auth"`.

**Why:** Le frontend est hébergé sur Vercel (static), le backend sur Railway. Les URLs relatives ne traversent pas Vercel vers Railway — elles tombent en 404. `getApiBase()` retourne `import.meta.env.VITE_API_URL ?? ""`, ce qui permet de pointer vers le bon backend en production.

**How to apply:** Dès qu'on ajoute un nouveau `fetch('/api/...')` dans une page frontend, toujours préfixer avec `${getApiBase()}`. Vérifier aussi les pages existantes non encore corrigées (compliance.tsx, comptabilite-pme.tsx, paie.tsx, vat-settings.tsx, admin-api.ts, etc.).
