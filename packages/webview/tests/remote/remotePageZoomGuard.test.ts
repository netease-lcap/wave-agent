import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Web page must not zoom itself when a text control is focused (spec
 * remote-control「Web 页作为第五种宿主」场景 15): iOS Safari zooms the whole page
 * to an effective 16px when a focused control computes below that, and 15px still
 * triggers.
 *
 * Two routes get there and they are NOT equivalent — `maximum-scale=1` also takes
 * pinch zoom away from the user. He ran the lock on device (2026-10-14) and found
 * the page's text too small to read with no way to enlarge it, so the page lifts
 * every text control to 16px instead and the viewport meta must not come back
 * carrying a maximum scale.
 *
 * Pinned here: the floor is keyed on the element (so a new control is covered
 * without anyone remembering), it stays scoped to the remote page, the viewport
 * keeps the full-bleed props the 100dvh/safe-area fix relies on, and the mobile
 * type tier rides on a touch-device media query — a PC browser opening the same
 * page keeps the designed density. The real check is still on device: focus an
 * input and `visualViewport.scale` stays 1.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const WEBVIEW = resolve(HERE, "../..");
const read = (rel: string) => fs.readFileSync(resolve(WEBVIEW, rel), "utf-8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const viewport = read("remote/build.mjs").match(
  /<meta\s+name="viewport"\s+content="([^"]*)"/,
)?.[1];
const remoteCss = strip(read("src/styles/remote-page.css"));

/** Split a stylesheet into its top-level `selector { body }` blocks (one level of
 *  `@media` is flattened, children marked with the `@media> ` prefix). */
function blocks(css: string) {
  const out: { sel: string; body: string; index: number }[] = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
    } else if (ch === "}") {
      const sel = stack.pop()!;
      out.push({
        sel: stack.length === 0 ? sel : `@media> ${sel}`,
        body: buf,
        index: out.length,
      });
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

const rules = blocks(remoteCss);
const scoped = rules.filter((r) => !r.sel.startsWith("@media "));

/** Split a selector list on its top-level commas — `:is(a, b)` holds commas of
 *  its own, and splitting on those would report false leaks. */
function selectorParts(sel: string) {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
}

describe("remote page autozoom guard", () => {
  it("leaves the page zoomable (no maximum scale in the viewport meta)", () => {
    expect(viewport).toBeDefined();
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });

  it("keeps the full-bleed viewport the safe-area fix relies on", () => {
    expect(viewport).toContain("width=device-width");
    expect(viewport).toContain("initial-scale=1");
    expect(viewport).toContain("viewport-fit=cover");
  });

  it("lifts every text control to 16px, keyed on the element", () => {
    const floor = rules.find((r) =>
      /input,\s*textarea,\s*select,\s*\[contenteditable\]/.test(r.sel),
    );
    expect(
      floor,
      "no element-keyed control rule in remote-page.css",
    ).toBeDefined();
    expect(floor!.sel).toContain("[data-remote-page]");
    const size = Number(/font-size:\s*([\d.]+)px/.exec(floor!.body)?.[1]);
    // 16px is the floor iOS stops zooming at; 15px still triggers.
    expect(size).toBeGreaterThanOrEqual(16);
  });

  it("applies the floor after the tier it has to win against", () => {
    const floor = rules.findIndex((r) =>
      /input,\s*textarea,\s*select,\s*\[contenteditable\]/.test(r.sel),
    );
    const media = rules.findIndex((r) => r.sel.startsWith("@media"));
    expect(media).toBeGreaterThanOrEqual(0);
    // Same specificity ⇒ source order decides, so the floor must come last.
    expect(floor).toBeGreaterThan(media);
  });

  it("gates the mobile type tier on the device, not the page identity", () => {
    const media = rules.find((r) => r.sel.startsWith("@media "))!.sel;
    expect(media).toMatch(/pointer:\s*coarse/);
    expect(media).toMatch(/hover:\s*none/);
    expect(media).not.toMatch(/max-width|min-width/);
  });

  it("overrides the theme's type tokens from a selector that can win", () => {
    // The reading text has no `font-size` of its own — it inherits from `body`,
    // which reads `--vscode-font-size`. The themes declare that token on
    // `:root[data-theme="…"]`, i.e. two simple selectors, so an override carrying
    // only `[data-remote-page]` loses the cascade **silently**: measured on the
    // built page, the body stayed at 13px until the rule got its second attribute.
    const token = rules.find((r) => r.body.includes("--vscode-font-size"));
    expect(token, "no type-token override in remote-page.css").toBeDefined();
    expect(token!.sel).toMatch(/\[data-remote-page\]\[[a-z-]+\]/);

    // Belt and braces: the body rule delivers the reading size even if
    // `data-theme` ever goes away.
    const body = rules.find((r) =>
      /(^|@media> )\[data-remote-page\] body$/.test(r.sel),
    );
    expect(body, "no body rule for the reading text").toBeDefined();
    const size = Number(/font-size:\s*([\d.]+)px/.exec(body!.body)?.[1]);
    expect(size).toBeGreaterThanOrEqual(15);
  });

  it("gives both icon-button clusters a finger-sized target on touch devices", () => {
    // spec 场景 27. The two densest icon clusters on the page — the header's
    // right side (new session / session / switch machine / more) and the
    // composer's bottom left ("+" / "/") — were sized for a mouse pointer:
    // 22×22 buttons, 16×16 glyphs, 4px apart (26px between centres). Touch
    // needs 40×40 and 8px, and the two numbers have to move together: growing
    // the hit box while leaving the gap alone makes the boxes touch or overlap,
    // which makes mistaps *more* likely — exactly what he reported.
    const media = rules.findIndex((r) => r.sel.startsWith("@media"));
    expect(media).toBeGreaterThanOrEqual(0);
    const inTier = (sel: string) => {
      const r = rules.find((x) => x.sel === `@media> ${sel}`);
      expect(r, `no mobile-tier rule for ${sel}`).toBeDefined();
      expect(
        r!.index,
        `${sel} must sit inside the touch-device media query`,
      ).toBeGreaterThan(media);
      return r!.body;
    };

    for (const button of [
      "[data-remote-page] .header-button",
      "[data-remote-page] .toolbar-icon-button",
    ]) {
      const size = Number(/width:\s*([\d.]+)px/.exec(inTier(button))?.[1]);
      expect(size, button).toBeGreaterThanOrEqual(40);
    }
    for (const glyph of [
      "[data-remote-page] .header-button .header-icon",
      "[data-remote-page] .toolbar-icon-button .toolbar-icon",
    ]) {
      const size = Number(/width:\s*([\d.]+)px/.exec(inTier(glyph))?.[1]);
      expect(size, glyph).toBeGreaterThanOrEqual(20);
    }
    for (const cluster of [
      "[data-remote-page] .header-buttons",
      "[data-remote-page] .context-actions",
    ]) {
      const gap = Number(/gap:\s*([\d.]+)px/.exec(inTier(cluster))?.[1]);
      expect(gap, cluster).toBeGreaterThanOrEqual(8);
    }
  });

  it("grows the two fixed-height rails that carry the enlarged buttons", () => {
    // The header is a fixed 44px and the composer's button row a fixed 40px;
    // a 40px button in either one sits flush against both edges, so the height
    // has to come along with the size. Whatever it becomes must still keep the
    // buttons off the edges (spec 场景 14's one-screen constraint is the harder
    // half and is checked on device, not here).
    const inTier = (sel: string) => {
      const r = rules.find((x) => x.sel === `@media> ${sel}`);
      expect(r, `no mobile-tier rule for ${sel}`).toBeDefined();
      return Number(/height:\s*([\d.]+)px/.exec(r!.body)?.[1]);
    };
    expect(inTier("[data-remote-page] .chat-header")).toBeGreaterThanOrEqual(
      48,
    );
    expect(
      inTier("[data-remote-page] .input-buttons-row"),
    ).toBeGreaterThanOrEqual(48);
  });

  it("keeps every rule scoped to the remote page", () => {
    // Unscoped rules here would lift the IDE and desktop density too, since all
    // five hosts load this file.
    expect(scoped.length).toBeGreaterThan(0);
    for (const { sel } of scoped) {
      for (const part of selectorParts(sel.replace("@media> ", ""))) {
        expect(part.startsWith("[data-remote-page]"), sel).toBe(true);
      }
    }
  });

  it("keeps control rules out of the shared stylesheet", () => {
    expect(strip(read("src/styles/globals.css"))).not.toMatch(
      /input|textarea|select|\[contenteditable/,
    );
  });
});
