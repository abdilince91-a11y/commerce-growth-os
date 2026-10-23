import { mapOffers } from "./mapper";
import { issue } from "./issues";
import { ITEM_FIELDS } from "./validation";
import type { PinterestCatalogPreview } from "./types";

function quote(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

export function createCatalogPreview(inputs: unknown): PinterestCatalogPreview {
  const batch = mapOffers(inputs);
  if (batch.invalid.length > 0) return { status: "invalid", ...batch };
  if (batch.mapped.length === 0) {
    return { status: "invalid", ...batch, invalid: [{ index: -1, issues: [issue("empty_catalog", "batch")] }] };
  }
  const encoder = new TextEncoder();
  const lines = [ITEM_FIELDS.map(quote).join(",") + "\r\n"];
  let bytes = encoder.encode(lines[0]).byteLength;
  for (const { item } of batch.mapped) {
    const line = ITEM_FIELDS.map((field) => {
      const value = item[field];
      return quote(Array.isArray(value) ? value.join(",") : value ?? "");
    }).join(",") + "\r\n";
    bytes += encoder.encode(line).byteLength;
    if (bytes > 16 * 1024 * 1024) {
      return { status: "invalid", ...batch, invalid: [{ index: -1, issues: [issue("output_limit", "batch")] }] };
    }
    lines.push(line);
  }
  return { status: "ready", csv: lines.join(""), ...batch };
}
