import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isHttpUrl } from "@/lib/schema/common";
import { validateHttpUrl } from "./urls";

const CANARY = "SECRET-CANARY-6614";

function failureOf<T extends { ok: boolean }>(result: T) {
  expect(result.ok).toBe(false);
  return result as Extract<T, { ok: false }>;
}

describe("validateHttpUrl: accepted URLs are returned exactly as supplied", () => {
  it.each([
    "https://example.com",
    "https://example.com/",
    "https://example.com/a?b=c#frag",
    "http://localhost:3000/x",
    "https://EXAMPLE.com/Path/Çanta",
    "HTTPS://example.com/x",
    "https://example.com/a%20b?q=1&utm_source=newsletter&utm_medium=email",
    "https://example.com/?redirect=https%3A%2F%2Fother.example%2F",
    "http://[::1]:8080/x",
    "http://192.168.0.1/x",
    "https://example.com/@user",
    "https://example.com/?email=a@b.co",
    "https://example.com/çanta-şık?renk=mavi",
    "https://example.com:8443/deep/path/../with/dots",
    "https://example.com/a?b=c&b=d#frag?not-a-query",
  ])("accepts %s", (url) => {
    const result = validateHttpUrl(url);
    expect(result).toEqual({ ok: true, value: url });
    // Same string, not a re-serialized one.
    expect((result as { value: string }).value).toBe(url);
  });

  it("does not canonicalize: query parameters, case, ports and trailing slashes survive", () => {
    for (const url of [
      "https://example.com?x=1",
      "https://Example.COM:443/A?b=C",
      "http://example.com:80/",
      "https://example.com/a?utm_source=x&gclid=abc",
    ]) {
      expect(validateHttpUrl(url)).toEqual({ ok: true, value: url });
    }
    // The platform's own re-serialization would differ, which is exactly what must not be returned.
    expect(new URL("https://Example.COM:443/A?b=C").href).not.toBe("https://Example.COM:443/A?b=C");
    expect(new URL("http://example.com:80/").href).not.toBe("http://example.com:80/");
  });
});

describe("validateHttpUrl: rejections", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["relative path", "/relative/path"],
    ["relative file", "images/a.jpg"],
    ["bare host", "example.com"],
    ["protocol-relative", "//example.com/x"],
    ["scheme only", "https:"],
    ["missing host", "https://"],
    ["empty authority", "https:///x"],
    ["http without slashes", "http:example.com"],
    ["invalid host bracket", "https://exa[mple.com"],
    ["encoded at sign in host", "https://exa%40mple.com"],
    ["leading space", " https://example.com"],
    ["trailing space", "https://example.com "],
    ["space in host", "https://exa mple.com"],
    ["space in path", "https://example.com/a b"],
    ["tab", "https://example.com/\tx"],
    ["newline", "https://example.com/\nx"],
    ["carriage return", "https://example.com/\rx"],
    ["no-break space", "https://example.com/ x"],
    ["control character", "https://example.com/\u0007"],
    ["NUL", "https://example.com/\u0000"],
    ["backslash after scheme", "https:\\\\example.com"],
    ["backslash in path", "https://example.com\\x"],
    ["lone surrogate", "https://example.com/\uD800"],
    ["embedded newline hiding a scheme", "java\nscript:alert(1)"],
    ["embedded tab hiding a scheme", "java\tscript:alert(1)"],
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["object", { href: "https://example.com" }],
    ["URL instance", new URL("https://example.com")],
    ["array", ["https://example.com"]],
  ])("rejects %s as invalid_url", (_name, value) => {
    expect(failureOf(validateHttpUrl(value)).code).toBe("invalid_url");
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["uppercase javascript", "JAVASCRIPT:alert(1)"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["data", "data:text/plain,hi"],
    ["data image", "data:image/png;base64,AAAA"],
    ["ftp", "ftp://example.com/file"],
    ["file", "file:///etc/passwd"],
    ["mailto", "mailto:someone@example.com"],
    ["tel", "tel:+900000000000"],
    ["blob", "blob:https://example.com/00000000-0000-0000-0000-000000000000"],
    ["ws", "ws://example.com/socket"],
    ["custom scheme", "myapp://open?x=1"],
  ])("rejects the %s scheme as unsafe_url_scheme", (_name, url) => {
    expect(failureOf(validateHttpUrl(url)).code).toBe("unsafe_url_scheme");
  });

  it.each([
    ["user and password", "https://user:pw@example.com/x"],
    ["user only", "https://user@example.com/x"],
    ["password only", "https://:pw@example.com/x"],
    ["empty userinfo", "https://@example.com/x"],
    ["credentials on http", "http://user:pw@localhost:3000/"],
    ["encoded credentials", "https://us%40er:p%3Aw@example.com/"],
    ["credentials with query", "https://user:pw@example.com/?a=1"],
  ])("rejects %s as url_has_credentials", (_name, url) => {
    expect(failureOf(validateHttpUrl(url)).code).toBe("url_has_credentials");
  });

  it("does not mistake an @ in the path, query, or fragment for credentials", () => {
    for (const url of [
      "https://example.com/@user",
      "https://example.com/?email=a@b.co",
      "https://example.com/#a@b",
    ]) {
      expect(validateHttpUrl(url).ok).toBe(true);
    }
  });
});

describe("agreement with the canonical URL rule", () => {
  const corpus = [
    "https://example.com", "https://example.com/a?b=c", "http://localhost:3000/x", "HTTP://EXAMPLE.COM",
    " https://example.com", "https://example.com ", "https://example.com/a b", "https://user:pw@example.com/x",
    "javascript:alert(1)", "data:text/plain,hi", "ftp://example.com", "/relative", "example.com", "",
    "https://", "http:example.com", "https:\\\\example.com", "https://example.com/\nx", "//example.com",
    "https://[::1]/x", "https://exa[mple.com", "mailto:a@b.co", "file:///etc/passwd",
  ];

  it("accepts nothing that the canonical rule rejects (this validator is stricter)", () => {
    for (const value of corpus) {
      if (validateHttpUrl(value).ok) {
        expect(isHttpUrl(value), JSON.stringify(value)).toBe(true);
      }
    }
  });
});

describe("safety properties", () => {
  const hostile: unknown[] = [
    Symbol("x"),
    () => 1,
    { toString() { throw new Error("boom"); } },
    new Proxy({}, { get() { throw new Error("boom"); } }),
    "\u0000",
    CANARY,
    undefined,
    `https://${"a".repeat(100000)}.example.com/`,
    `https://example.com/${"%".repeat(50000)}`,
  ];

  it("never throws on hostile input", () => {
    for (const input of hostile) {
      expect(() => validateHttpUrl(input)).not.toThrow();
    }
  });

  it("never includes the URL or any raw value in an error message", () => {
    const inputs = [
      `https://user-${CANARY}:pass-${CANARY}@host-${CANARY}.example.com/path-${CANARY}?token=${CANARY}`,
      `javascript:alert('${CANARY}')`,
      `/relative/${CANARY}?q=${CANARY}`,
      `https://host-${CANARY}.example.com/a b`,
      `ftp://${CANARY}.example.com/`,
      CANARY,
    ];
    for (const input of inputs) {
      const failure = failureOf(validateHttpUrl(input));
      expect(failure.message).not.toContain(CANARY);
      expect(failure.message).not.toContain("token");
      expect(failure.message).not.toContain("example.com");
      expect(failure.message).not.toContain("://");
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });

  it("uses one static message per error code", () => {
    const a = failureOf(validateHttpUrl("/one"));
    const b = failureOf(validateHttpUrl("https://"));
    expect(a.code).toBe("invalid_url");
    expect(b.code).toBe("invalid_url");
    expect(a.message).toBe(b.message);
  });

  it("is deterministic", () => {
    const url = "https://example.com/a?b=c";
    for (let i = 0; i < 3; i++) expect(validateHttpUrl(url)).toEqual({ ok: true, value: url });
  });

  it("makes no network call: it only parses", () => {
    const source = readFileSync(new URL("./urls.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [
      /\bfetch\s*\(/, /\brequire\s*\(/, /import\s*\(/, /from\s+["']node:/, /\bprocess\./,
      /Date\.now/, /new Date/, /Math\.random/, /XMLHttpRequest/, /WebSocket/, /\.href\b/, /\.toString\(/,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });
});
