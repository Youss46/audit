---
name: pdfmake esbuild externalize
description: How to correctly bundle pdfmake in the esbuild ESM api-server
---

# pdfmake in esbuild ESM bundle

## Rule
pdfmake must be externalized from the esbuild bundle and loaded at call-time via `createRequire` — never via a top-level `import` default.

**Why:** pdfmake → pdfkit → fontkit uses `@swc/helpers` through dynamic CJS `require()` calls. esbuild cannot bundle this chain cleanly inside an ESM output file. Externalizing lets Node.js resolve the package from `node_modules` at runtime.

## External list additions required in build.mjs
"pdfmake", "pdfkit", "fontkit", "@swc/helpers", "brotli", "png-js"

## How to import at runtime
```typescript
import { createRequire } from "node:module";
const _nodeRequire = createRequire(import.meta.url);

let _printer: any = null;
function getPrinter() {
  if (!_printer) {
    const Ctor = _nodeRequire("pdfmake");
    _printer = new Ctor(BUILT_IN_FONTS);
  }
  return _printer;
}
```

**How to apply:** Any future server-side PDF library that uses fontkit (e.g. pdfkit, @react-pdf/renderer) needs the same treatment.
