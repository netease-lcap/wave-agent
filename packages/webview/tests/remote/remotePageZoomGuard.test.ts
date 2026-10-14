import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Web page's zoom guard (spec remote-control「Web 页作为第五种宿主」场景 14):
 * iOS Safari zooms the whole page when a focused text control computes below 16px,
 * so every control there has to sit at or above that line. The override lives in
 * `src/styles/globals.css` — the very file all five hosts load — keyed on
 * `data-remote-page`, which `remote/shim.js` puts on `<html>` (that page is the
 * only browser-run host; the other four must never match).
 *
 * Two failures are silent and pinned here: the override losing its scope (a rule
 * without the marker would lift the IDE / desktop density too) and the marker name
 * drifting apart between a .js file and a .css file.
 *
 * No computed-style assertion on purpose: jsdom's cascade does not support the
 * `:not()` chain used here, so such a test would measure jsdom rather than our
 * rule. The real check is on device — after focusing an input, `visualViewport.scale`
 * stays 1.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const WEBVIEW = resolve(HERE, "../..");
const read = (rel: string) => fs.readFileSync(resolve(WEBVIEW, rel), "utf-8");

const MARK = "data-remote-page";
const GLOBALS_CSS = read("src/styles/globals.css");
const SHIM = read("remote/shim.js");

/** Every rule of the shared stylesheet, comments stripped so prose cannot pass. */
const rules = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("}")
  .filter((block) => block.includes("{"))
  .map((block) => ({
    selectors: block
      .slice(0, block.indexOf("{"))
      .split(",")
      .map((selector) => selector.replace(/\s+/g, ""))
      .filter(Boolean),
    body: block.slice(block.indexOf("{") + 1),
  }));

/** The rules that touch a control iOS would zoom into. */
const controlRules = rules.filter(({ selectors }) =>
  selectors.some((selector) =>
    /\binput\b|\btextarea\b|\bselect\b|\[contenteditable/.test(selector),
  ),
);

describe("remote page input zoom guard", () => {
  it("keeps every control rule scoped to the remote page", () => {
    expect(controlRules.length).toBeGreaterThan(0);
    for (const { selectors } of controlRules) {
      for (const selector of selectors) {
        expect(selector).toContain(`[${MARK}]`);
      }
    }
  });

  it("covers every kind of control iOS would zoom into", () => {
    const scoped = controlRules.flatMap((rule) => rule.selectors);
    // Text-bearing inputs, with the non-text ones excluded by name.
    expect(scoped.some((s) => s.startsWith(`[${MARK}]input:not(`))).toBe(true);
    expect(scoped.some((s) => s.includes(`:not([type="submit"])`))).toBe(true);
    expect(scoped).toContain(`[${MARK}]textarea`);
    expect(scoped).toContain(`[${MARK}]select`);
    // And the rich-text composer, a contenteditable div — minus the
    // `contenteditable="false"` chips nested inside it.
    expect(scoped.some((s) => s.startsWith(`[${MARK}][contenteditable]`))).toBe(
      true,
    );
  });

  it("lifts the size past the threshold, line height included", () => {
    const zoomRule = controlRules.find((rule) =>
      rule.body.includes("font-size"),
    );
    // 16px is iOS's threshold — 15px still zooms, so this number is the guard.
    expect(zoomRule?.body).toMatch(/font-size:\s*16px/);
    // base `.message-input` is 12px/16px; keeping that tight line height would
    // squeeze the now-larger glyphs inside the row box.
    expect(zoomRule?.body).toMatch(/line-height:\s*22px/);
  });

  it("agrees with the shim on the marker name", () => {
    expect(SHIM).toContain(`setAttribute("${MARK}", "1")`);
    expect(GLOBALS_CSS).toContain(`[${MARK}]`);
  });
});
