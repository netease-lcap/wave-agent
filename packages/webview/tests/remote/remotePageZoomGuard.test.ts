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

  it("wins against the tier groups by importance, not by source order", () => {
    // The floor's selector is attribute + element (0,1,1) while every tier group is
    // attribute + class (0,2,0): a tier group that lists a control's class name wins
    // on specificity alone, no matter how late the floor is written. On device
    // 2026-10-15 that is exactly what happened — `.session-list-search` was listed in
    // the secondary-info group (14px against its 12px component baseline), so opening
    // the header's「会话」popup auto-focused the search box and zoomed the whole page.
    // Hence `!important`; source order only decides among equals.
    const floor = rules.find((r) =>
      /input,\s*textarea,\s*select,\s*\[contenteditable\]/.test(r.sel),
    );
    expect(floor).toBeDefined();
    expect(floor!.body).toMatch(/font-size:\s*16px\s*!important/);
  });

  it("applies the floor after the tier it shares specificity with", () => {
    const floor = rules.findIndex((r) =>
      /input,\s*textarea,\s*select,\s*\[contenteditable\]/.test(r.sel),
    );
    const media = rules.findIndex((r) => r.sel.startsWith("@media"));
    expect(media).toBeGreaterThanOrEqual(0);
    // Same specificity ⇒ source order decides, so the floor must still come last.
    expect(floor).toBeGreaterThan(media);
  });

  it("keeps text-control class names out of the tier groups", () => {
    // Controls get their size from the floor alone, so a tier group must not carry
    // their class names: doing so shadows the floor (see the test above). These are
    // the three that were listed and shipped a page that zoomed on focus.
    const tier = new Set(
      rules
        .filter((r) => r.sel.startsWith("@media> "))
        .flatMap((r) =>
          [...r.sel.matchAll(/\.([a-z0-9_-]+)/g)].map((m) => m[1]),
        ),
    );
    for (const cls of [
      "session-list-search",
      "history-search-input",
      "settings-select",
    ]) {
      expect(tier.has(cls), `${cls} must not sit in a tier group`).toBe(false);
    }
  });

  it("carries exactly one font-size !important — the floor's", () => {
    // A second one could pull a control back below the line, and would make the
    // winner depend on file order again.
    const important = rules.filter((r) =>
      /font-size:[^;]*!important/.test(r.body),
    );
    expect(important).toHaveLength(1);
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
