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
 * keeps the full-bleed props the 100dvh/safe-area fix relies on, and the floor
 * rides the same touch-device media query as the mobile type tier — a PC browser
 * opening the same page keeps the designed density, controls included. (Until
 * 2026-10-16 the floor was unconditional "in case the query misses"; he opened
 * the page on a PC, saw every input oversized against the 13px reading text, and
 * the trigger — iOS's font *threshold* — turned out not to apply to Android at
 * all, see the media query's comment.) The real check is still on device: focus
 * an input and `visualViewport.scale` stays 1.
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

  it("rides in the same touch-device media query as the tier", () => {
    // Source order cannot help here (a tier group wins on specificity whatever
    // the order — see the test above), so the floor has to be *inside* the query
    // to stay off the PC path. On a PC the reading text is 13px, and a 16px
    // input beside it is what he reported on 2026-10-16.
    const floor = rules.find((r) =>
      /input,\s*textarea,\s*select,\s*\[contenteditable\]/.test(r.sel),
    );
    expect(floor).toBeDefined();
    expect(floor!.sel).toMatch(/^@media> /);
  });

  it("keeps text controls out of the unconditional path", () => {
    // Anything outside the media query reaches PC browsers too. The autozoom it
    // guards against is an iOS *font threshold* — Android's focus zoom is a
    // viewport compensation and its text inflation only fires when the page is
    // laid out wider than the device, so this page (width=device-width) owns
    // neither. A control rule left here would be pure cost on the desktop side.
    const unconditional = rules.filter((r) => !r.sel.startsWith("@media> "));
    for (const { sel } of unconditional) {
      expect(
        sel,
        `${sel} lifts a text control on every device, PC included`,
      ).not.toMatch(/input|textarea|select|\[contenteditable/);
    }
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

  it("gives both icon-button clusters a finger-sized target on touch devices", () => {
    // spec 场景 27. The densest icon clusters on the page — the header's right
    // side (new session / session / switch machine / more), the composer's
    // bottom left ("+" / "/"), and the question dialog's top-right pair
    // (collapse options / close) — were sized for a mouse pointer: 22×22
    // buttons (20×20 in the dialog), 16×16 glyphs, 4px apart (26px between
    // centres). Touch needs 40×40 and 8px, and the two numbers have to move
    // together: growing the hit box while leaving the gap alone makes the boxes
    // touch or overlap, which makes mistaps *more* likely — exactly what he
    // reported twice (2026-10-15 for the header/composer, 2026-10-19 for the
    // dialog pair, which the first pass had left out of scope).
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
      "[data-remote-page] .confirmation-collapse-btn, [data-remote-page] .confirmation-close-btn",
    ]) {
      const size = Number(/width:\s*([\d.]+)px/.exec(inTier(button))?.[1]);
      expect(size, button).toBeGreaterThanOrEqual(40);
    }
    for (const glyph of [
      "[data-remote-page] .header-button .header-icon",
      "[data-remote-page] .toolbar-icon-button .toolbar-icon",
      "[data-remote-page] .confirmation-collapse-chevron, [data-remote-page] .confirmation-close-btn-icon",
    ]) {
      const size = Number(/width:\s*([\d.]+)px/.exec(inTier(glyph))?.[1]);
      expect(size, glyph).toBeGreaterThanOrEqual(20);
    }
    for (const cluster of [
      "[data-remote-page] .header-buttons",
      "[data-remote-page] .context-actions",
      "[data-remote-page] .confirmation-header-actions",
    ]) {
      const gap = Number(/gap:\s*([\d.]+)px/.exec(inTier(cluster))?.[1]);
      expect(gap, cluster).toBeGreaterThanOrEqual(8);
    }
  });

  it("makes room for the dialog pair instead of letting it cover the content", () => {
    // The two clusters above live in fixed-height rails, so their rail grows with
    // them (next test). The dialog pair is absolutely positioned in the card's
    // top-right corner, so what has to give is the title row underneath: a 40px
    // button does not fit the base 24px row, and the title has to stop short of
    // the buttons instead of running under them. Both numbers are load-bearing —
    // measured on the built page at 390×844 (touch), dropping them puts the
    // buttons 16px past the row and over the first line of content.
    const r = rules.find(
      (x) => x.sel === "@media> [data-remote-page] .confirmation-header-top",
    );
    expect(
      r,
      "no title-row rule for the enlarged dialog buttons",
    ).toBeDefined();
    const minHeight = Number(/min-height:\s*([\d.]+)px/.exec(r!.body)?.[1]);
    expect(minHeight).toBeGreaterThanOrEqual(40);
    // Close-only dialogs (every confirmation except AskUserQuestion) carry one
    // button; AskUserQuestion carries two and reserves the wider gap.
    const base = Number(/padding-right:\s*([\d.]+)px/.exec(r!.body)?.[1]);
    expect(base).toBeGreaterThanOrEqual(48);
    const wide = rules.find((x) =>
      x.sel.includes(":has(.confirmation-collapse-btn)"),
    );
    expect(
      wide,
      "AskUserQuestion must reserve room for both buttons",
    ).toBeDefined();
    const widePad = Number(/padding-right:\s*([\d.]+)px/.exec(wide!.body)?.[1]);
    expect(widePad).toBeGreaterThan(base);
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
    // Unscoped rules here would lift the plugin host and desktop density too, since all
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
