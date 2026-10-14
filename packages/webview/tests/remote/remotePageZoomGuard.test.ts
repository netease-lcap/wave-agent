import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Web page must not let the browser zoom itself when a text control is
 * focused (spec remote-control「Web 页作为第五种宿主」场景 14): iOS Safari zooms
 * the whole page to an effective 16px when a focused control computes below that
 * (15px still triggers), and every control on this page sits below it — the
 * composer at 12px, the settings inputs at 14px.
 *
 * The guard is the page's own `maximum-scale`, not bigger text: lifting every
 * control to 16px does stop the zoom, but he looked at that build on device
 * (2026-10-14) and found it a size too big — so the page locks the zoom instead
 * and keeps the designed sizes. The trade is manual pinch zoom, which a
 * responsive control panel has no use for.
 *
 * Pinned here: the lock survives edits to the generated skeleton, it does not
 * quietly take `viewport-fit=cover` with it (that one carries the safe-area
 * handling from the 100dvh fix), and the size route does not creep back in
 * through the stylesheet all five hosts share. The real check is on device —
 * focus an input and `visualViewport.scale` stays 1.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const WEBVIEW = resolve(HERE, "../..");
const read = (rel: string) => fs.readFileSync(resolve(WEBVIEW, rel), "utf-8");

const viewport = read("remote/build.mjs").match(
  /<meta\s+name="viewport"\s+content="([^"]*)"/,
)?.[1];

describe("remote page autozoom lock", () => {
  it("locks the maximum scale in the page's viewport meta", () => {
    expect(viewport).toBeDefined();
    expect(viewport).toMatch(/maximum-scale=1(\.0)?\b/);
  });

  it("keeps the full-bleed viewport the safe-area fix relies on", () => {
    expect(viewport).toContain("width=device-width");
    expect(viewport).toContain("initial-scale=1");
    expect(viewport).toContain("viewport-fit=cover");
  });

  it("keeps input sizes out of the shared stylesheet", () => {
    // A control rule in globals.css would lift the IDE and desktop density too,
    // since all five hosts load that file — controls are not the place to fix a
    // browser-host-only behaviour.
    const rules = read("src/styles/globals.css").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(rules).not.toMatch(/input|textarea|select|\[contenteditable/);
  });
});
