/**
 * The webview registers a hand-picked subset of highlight.js (`utils/highlight.ts`)
 * instead of `lib/common`. These tests are what keeps that subset honest:
 *
 * - every language `EXT_LANGUAGE` maps an extension onto must be registered,
 *   otherwise a file type silently loses its highlighting — a failure that looks
 *   like a styling bug rather than a missing import;
 * - aliases the fenced-code path relies on (`ts`, `html`, `sh`, …) must resolve,
 *   since they come from the language modules and not from the table.
 */

import { describe, it, expect } from "vitest";
import hljs, { REGISTERED_LANGUAGES } from "../../src/utils/highlight";
import { EXT_LANGUAGE } from "../../src/components/FilePane";

describe("highlight.js language subset", () => {
  it("registers every language the extension table maps onto", () => {
    const missing = [...new Set(Object.values(EXT_LANGUAGE))].filter(
      (name) => !hljs.getLanguage(name),
    );
    expect(missing).toEqual([]);
  });

  it("keeps the registration list and the extension table in step", () => {
    const used = new Set<string>(Object.values(EXT_LANGUAGE));
    // `markdown` is registered for fenced ```md blocks, which never come from
    // the extension table (a .md file is rendered, not highlighted).
    const unused = REGISTERED_LANGUAGES.filter(
      (name) => name !== "markdown" && !used.has(name),
    );
    expect(unused).toEqual([]);
  });

  it("resolves the aliases the fenced-code path depends on", () => {
    for (const alias of [
      "ts",
      "tsx",
      "js",
      "jsx",
      "html",
      "svg",
      "sh",
      "yml",
    ]) {
      expect(hljs.getLanguage(alias)).toBeTruthy();
    }
  });

  it("falls back to plain text for languages it no longer ships", () => {
    // The guard in FilePane: an unregistered fence renders unhighlighted rather
    // than throwing.
    expect(hljs.getLanguage("lua")).toBeFalsy();
  });

  it("still highlights real code", () => {
    const html = hljs.highlight("const a = 1;", {
      language: "typescript",
      ignoreIllegals: true,
    }).value;
    expect(html).toContain("hljs-keyword");
  });
});
