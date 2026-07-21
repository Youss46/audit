#!/usr/bin/env node
/**
 * validate-schema-sync.mjs
 *
 * Vérifie que les enums définis dans lib/db/src/schema/ (TypeScript)
 * sont parfaitement synchronisés avec ceux déclarés dans lib/api-spec/openapi.yaml.
 *
 * Exécutez avant chaque déploiement :
 *   node scripts/validate-schema-sync.mjs
 *
 * Retourne exit 1 si un désalignement est détecté.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── Mapping : constante TypeScript → nom du schéma OpenAPI ──────────────────
const CHECKS = [
  { file: "lib/db/src/schema/accounting.ts", const: "TRANSACTION_TYPES",    schema: "TransactionType"    },
  { file: "lib/db/src/schema/accounting.ts", const: "TRANSACTION_STATUSES", schema: "TransactionStatus"  },
  { file: "lib/db/src/schema/accounting.ts", const: "TRANSACTION_SOURCES",  schema: "TransactionSource"  },
  { file: "lib/db/src/schema/accounting.ts", const: "PAYMENT_METHODS",      schema: "PaymentMethod"      },
  { file: "lib/db/src/schema/accounting.ts", const: "PAYMENT_TYPES",        schema: "PaymentType"        },
  { file: "lib/db/src/schema/invoicing.ts",  const: "INVOICE_STATUSES",     schema: "InvoiceStatus"      },
];

// ── Parsers ──────────────────────────────────────────────────────────────────

/** Extrait les valeurs d'un `export const NAME = [...] as const` en TypeScript. */
function extractTsEnum(src, constName) {
  // Capture tout ce qui est entre `= [` et `] as const`
  const re = new RegExp(
    `export\\s+const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
    "m"
  );
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Extrait les valeurs d'un schéma OpenAPI `SchemaName:\n  type: string\n  enum:`. */
function extractOpenApiEnum(src, schemaName) {
  // Cherche le bloc de schéma
  const blockRe = new RegExp(
    `^    ${schemaName}:\\s*\\n([\\s\\S]*?)(?=\\n    \\S|\\Z)`,
    "m"
  );
  const block = src.match(blockRe);
  if (!block) return null;
  const body = block[1];

  // Flow style :  enum: [a, b, c]
  const flowM = body.match(/enum:\s*\[([^\]]+)\]/);
  if (flowM) {
    return flowM[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  // Block style :  enum:\n    - a\n    - b
  const blockStart = body.indexOf("enum:");
  if (blockStart === -1) return null;
  const afterEnum = body.slice(blockStart + 5);
  return [...afterEnum.matchAll(/^\s+-\s+(\S+)/gm)].map((x) => x[1]);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const openApiSrc = readFileSync(resolve(root, "lib/api-spec/openapi.yaml"), "utf8");
const tsCache = {};

let errors = 0;

for (const check of CHECKS) {
  const tsPath = resolve(root, check.file);
  if (!tsCache[check.file]) {
    tsCache[check.file] = readFileSync(tsPath, "utf8");
  }

  const tsValues  = extractTsEnum(tsCache[check.file], check.const);
  const apiValues = extractOpenApiEnum(openApiSrc, check.schema);

  if (!tsValues) {
    console.error(`❌  Impossible de trouver ${check.const} dans ${check.file}`);
    errors++;
    continue;
  }
  if (!apiValues) {
    console.error(`❌  Impossible de trouver le schéma "${check.schema}" dans openapi.yaml`);
    errors++;
    continue;
  }

  const tsSet  = new Set(tsValues);
  const apiSet = new Set(apiValues);

  const missingInApi = tsValues.filter((v) => !apiSet.has(v));
  const missingInTs  = apiValues.filter((v) => !tsSet.has(v));

  if (missingInApi.length || missingInTs.length) {
    console.error(`\n❌  Désalignement : ${check.const} ↔ ${check.schema}`);
    if (missingInApi.length)
      console.error(`   Dans le schéma DB mais absent de l'OpenAPI spec : ${missingInApi.join(", ")}`);
    if (missingInTs)
      console.error(`   Dans l'OpenAPI spec mais absent du schéma DB    : ${missingInTs.join(", ")}`);
    errors++;
  } else {
    console.log(`✅  ${check.const} ↔ ${check.schema}  (${tsValues.length} valeurs)`);
  }
}

if (errors > 0) {
  console.error(`\n⛔  ${errors} désalignement(s) détecté(s). Corrigez avant de déployer.\n`);
  console.error(
    "    1. Ajoutez la valeur manquante dans lib/api-spec/openapi.yaml\n" +
    "    2. Exécutez : pnpm --filter @workspace/api-spec run codegen\n" +
    "    3. Commitez et poussez sur GitHub.\n"
  );
  process.exit(1);
} else {
  console.log("\n✅  Tous les enums sont synchronisés.\n");
}
