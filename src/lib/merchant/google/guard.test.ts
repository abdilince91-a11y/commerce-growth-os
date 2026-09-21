import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src/lib/merchant");
const restricted = [
  /\b(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:http|node:https|node:net|axios|googleapis|@\/lib\/db|@\/lib\/proposals)["']/,
  /\bfetch\s*\(/,
  /\bapplyProposal\b/,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("Merchant module safety boundary", () => {
  it("contains no network, database, or proposal application code", () => {
    for (const path of sourceFiles(root)) {
      const source = readFileSync(path, "utf8");
      for (const pattern of restricted) {
        expect(source, `${path} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
