import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**", ".open-next/**", ".local/**", ".wrangler/**",
    "benchmarks/**", "design-preview/**", "next-env.d.ts", "cloudflare-env.d.ts",
  ]),
]);
