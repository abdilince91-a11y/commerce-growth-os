import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "dist/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/lib/merchant/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["node:http", "node:https", "node:net", "axios", "googleapis", "@/lib/db", "@/lib/proposals"], message: "Merchant previews cannot use network, database, or proposal transitions." },
        ],
      }],
      "no-restricted-globals": ["error", { name: "fetch", message: "Merchant previews cannot make network requests." }],
    },
  },
]);

export default eslintConfig;
