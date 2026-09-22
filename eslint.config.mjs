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
    files: ["src/lib/merchant/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Merchant preview modules must not perform network I/O." },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:http", message: "Merchant preview modules must not perform network I/O." },
            { name: "node:https", message: "Merchant preview modules must not perform network I/O." },
            { name: "node:net", message: "Merchant preview modules must not perform network I/O." },
            { name: "axios", message: "Merchant preview modules must not perform network I/O." },
            { name: "googleapis", message: "Merchant preview modules must not perform network I/O." },
            { name: "@/lib/db", message: "Merchant preview modules must not access the database." },
            { name: "@/lib/proposals", message: "Merchant previews must not execute proposals." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
