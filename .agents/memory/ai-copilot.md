---
name: AI Copilot (M15 AI Copilot)
description: Global chat assistant widget accessible on all authenticated pages. DeepSeek API, streaming SSE.
---

# M15 AI Copilot

## Architecture
- **Backend**: `artifacts/api-server/src/routes/copilot.ts` → `POST /api/ai/copilot`
- **Frontend**: `artifacts/m15-audit/src/components/ai/AICopilotDrawer.tsx`
- **Injected in**: `Shell.tsx` (after authenticated render, before closing `</div>`)
- **Model**: `deepseek-chat` via `https://api.deepseek.com/chat/completions`
- **Secret**: `DEEPSEEK_API_KEY` (user-provided)

## Key decisions
- Streaming SSE: backend pipes DeepSeek SSE → Express SSE → frontend `ReadableStream`
- Markdown: custom lightweight renderer (no react-markdown dep)
- Security: `requireAuth` middleware; system prompt only injects authenticated user's firmId/firmName
- FAB hidden on public routes (Shell returns early for `/login` etc.)
- Drawer: CSS `translate-x-full` / `translate-x-0` transition, right panel on all screen sizes
- Suggested prompts differ by role: cabinet vs PME vs super_admin

## Suggested prompts per role
- Cabinet: SYSCOHADA imputation, Mobile Money accounts, TVA, compte 585100
- PME: saisie facture, encaissement Wave, CNPS, impayés clients
- Admin: cabinet config, régimes fiscaux, seuils DGI, licences

## System prompt includes
- SYSCOHADA Révisé 2018 account mapping (6-digit codes)
- Fiscalité ivoirienne (TVA 18%, IS 25%, CNPS, ITS, Patente, FDFP)
- Dynamic context: route, pageTitle, companyName, clientName
- Role-adapted tone (expert for cabinet, accessible for PME)
