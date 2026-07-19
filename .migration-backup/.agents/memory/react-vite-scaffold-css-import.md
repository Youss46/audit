---
name: react-vite-scaffold-css-import
description: A design subagent can produce a fully-configured Tailwind theme (index.css) yet the app renders completely unstyled — check main.tsx imports it.
---

## Symptom

App renders with correct HTML structure and working interactivity/data, but
zero Tailwind/shadcn styling is applied (plain black-on-white browser
default look), even though `src/index.css` has a complete, correct
`@theme`/`:root` token setup and `vite.config.ts` has the Tailwind plugin
wired up.

## Root cause

`src/main.tsx` never has `import "./index.css"` — nothing tells Vite to
include the stylesheet in the bundle. This is easy for a design subagent to
miss since the scaffold's initial placeholder `main.tsx` may not have had it
either, and nothing errors at build or typecheck time (CSS import failures
are silent, not compile errors).

**How to apply:** after any design-subagent pass on a fresh react-vite
artifact, screenshot the running app before declaring done — a totally
unstyled page despite a real theme file is the tell. Fix is a one-line
`import "./index.css"` at the top of `main.tsx`.
