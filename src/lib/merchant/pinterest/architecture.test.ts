import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const directory = new URL("./", import.meta.url);
const shipped = readdirSync(directory).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
const imports = new Set([
  "zod", "@/lib/schema/gtin", "@/lib/schema/product", "@/lib/schema/variant", "@/lib/schema/proposal",
  "./mapper", "./catalog", "./proposal", "./validation", "./issues", "./types",
]);

describe("Pinterest offline dependency boundary", () => {
  it("checks every shipped module, including future additions, for I/O or executable imports", () => {
    for (const file of shipped) {
      const tree = ts.createSourceFile(file, readFileSync(new URL(file, directory), "utf8"), ts.ScriptTarget.Latest, true);
      function inspect(node: ts.Node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier) {
            expect(ts.isStringLiteral(node.moduleSpecifier)).toBe(true);
            expect(imports.has((node.moduleSpecifier as ts.StringLiteral).text), `${file}: unexpected dependency`).toBe(true);
          }
        }
        if (ts.isIdentifier(node)) {
          expect(["fetch", "XMLHttpRequest", "WebSocket", "process", "console", "require", "eval", "Function", "Date"], file).not.toContain(node.text);
        }
        if (ts.isCallExpression(node)) expect(node.expression.kind, file).not.toBe(ts.SyntaxKind.ImportKeyword);
        ts.forEachChild(node, inspect);
      }
      inspect(tree);
    }
  });
});
