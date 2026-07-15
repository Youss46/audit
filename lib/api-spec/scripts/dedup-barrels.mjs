#!/usr/bin/env node
/**
 * dedup-barrels.mjs
 *
 * Orval regenerates the workspace-level index.ts barrel files on every run.
 * Two problems must be fixed after each run before typecheck:libs can pass:
 *
 * 1. DUPLICATE MODULE PATHS (api-client-react)
 *    Orval appends its own export lines (single-quoted) to whatever was
 *    already in the file (double-quoted), producing two lines for the same
 *    module.  Fix: deduplicate by module path, keeping the first occurrence.
 *
 * 2. NAMING CONFLICT (api-zod)
 *    ./generated/api exports Zod schema constants (value + inferred type)
 *    and ./generated/types exports plain TypeScript interfaces with the same
 *    names.  Re-exporting both from the same barrel causes TS2308.
 *    Fix: drop the ./generated/types re-export entirely — the Zod schemas
 *    already carry the TypeScript types consumers need.
 *
 * Called from: lib/api-spec/package.json → scripts.codegen
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", "..");

/**
 * Extract the module path from an `export … from '…'` line.
 * Returns null for lines that are not export-from statements.
 */
function modulePathOf(line) {
  const m = line.match(/^\s*export\b.*?\bfrom\s+['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Fix api-zod/src/index.ts
//
// Correct barrel contains only:
//   export * from "./generated/api";
//
// The ./generated/types export is intentionally excluded: it re-exports plain
// TypeScript interfaces that share names with the Zod schema exports in
// ./generated/api, causing TS2308 "already exported a member named X".
// ---------------------------------------------------------------------------
const apiZodIndex = resolve(root, "lib", "api-zod", "src", "index.ts");
const correctApiZodContent = `export * from "./generated/api";\n`;

{
  const current = readFileSync(apiZodIndex, "utf8");
  if (current !== correctApiZodContent) {
    writeFileSync(apiZodIndex, correctApiZodContent, "utf8");
    console.log("✔ dedup-barrels: fixed lib/api-zod/src/index.ts");
  }
}

// ---------------------------------------------------------------------------
// Fix api-client-react/src/index.ts
//
// Deduplicate by module path (first occurrence wins).  Non-module-path lines
// (blank lines, comments, named re-exports without `from`) are kept as-is.
// ---------------------------------------------------------------------------
const apiClientIndex = resolve(root, "lib", "api-client-react", "src", "index.ts");

{
  const original = readFileSync(apiClientIndex, "utf8");
  const seenModules = new Set();
  const output = [];

  for (const line of original.split("\n")) {
    const mod = modulePathOf(line);
    if (mod !== null) {
      if (!seenModules.has(mod)) {
        seenModules.add(mod);
        output.push(line);
      }
      // else: duplicate module path — drop silently
    } else {
      output.push(line); // blank / comment / named re-export — always keep
    }
  }

  const deduped = output.join("\n");
  if (deduped !== original) {
    writeFileSync(apiClientIndex, deduped, "utf8");
    console.log("✔ dedup-barrels: fixed lib/api-client-react/src/index.ts");
  }
}

console.log("dedup-barrels: done.");
