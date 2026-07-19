---
name: Anthropic AI integration blocked without phone verification
description: Replit AI Integrations setup for the Anthropic provider can fail with "awaiting_phone_verification" instead of provisioning credentials; know the fallback path before promising an AI feature.
---

`setupReplitAIIntegrations({ providerSlug: "anthropic" })` can return
`{ status: "awaiting_phone_verification", success: false }` instead of
provisioning `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `_API_KEY`. This happens
when the Replit account itself hasn't completed phone verification — it is
an account-level gate, not something the agent can resolve or retry past.

**Why:** The agent has no way to complete phone verification on the user's
behalf, and retrying the same setup call does not change the outcome.

**How to apply:** If this status is returned, do not retry
`setupReplitAIIntegrations`. Immediately offer the user a choice via
AskQuestion: (a) verify their phone to unlock the integration, (b) supply
their own Anthropic API key via `requestSecrets` (never ask for the raw key
in chat), (c) descope/pause the AI-dependent feature, or (d) cancel it. If
the user declines to provide a key when asked, treat that as equivalent to
"pause/cancel" for that feature rather than re-prompting — do not build a
partial implementation around an API that has no credentials.
