import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SHIPPED_MODULES = [
  "adapter.ts",
  "errors.ts",
  "gtin.ts",
  "identifiers.ts",
  "index.ts",
  "mapper.ts",
  "money.ts",
  "proposal.ts",
  "text.ts",
  "types.ts",
  "urls.ts",
] as const;

function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("Merchant architecture boundary", () => {
  it("contains no transport, database, credential, or proposal-application capability", () => {
    for (const file of SHIPPED_MODULES) {
      const source = sourceOf(file);
      for (const banned of [
        /\bfetch\s*\(/,
        /XMLHttpRequest/,
        /WebSocket/,
        /from\s+["']node:(?:http|https|net)/,
        /googleapis/i,
        /axios/i,
        /oauth/i,
        /@\/lib\/db/,
        /@\/lib\/proposals/,
        /applyProposal/,
        /createProposal/,
        /\bprisma\b/i,
        /\bprocess\.env\b/,
      ]) {
        expect(source, `${file} must not match ${banned}`).not.toMatch(banned);
      }
    }
  });

  it("allows proposal.ts to import only the proposal schema and sibling types", () => {
    const imports = sourceOf("proposal.ts")
      .split("\n")
      .filter((line) => /\bfrom\s+["']/.test(line));
    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatch(/from\s+["']@\/lib\/schema\/proposal["']/);
    expect(imports[1]).toMatch(/from\s+["']\.\/types["']/);
  });
});
