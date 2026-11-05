import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
export default defineConfig([
  ...next,
  ...ts,
  { rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([
    ".next/**",
    "app/.well-known/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
]);
