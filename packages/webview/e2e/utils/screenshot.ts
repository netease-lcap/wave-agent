import type { Page, Locator } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * Screenshot helpers that emit WebP directly.
 *
 * Playwright's `page.screenshot()` only supports png/jpeg, so a naive pipeline
 * would need to capture PNG and post-process it into WebP. Chromium's CDP
 * `Page.captureScreenshot` natively supports `format: 'webp'`, which lets the
 * demo pipeline produce WebP directly with no intermediate file and no
 * conversion step. `quality` is honored for WebP (verified empirically).
 */

export interface WebpScreenshotOptions {
  /** Clip region, same shape as Playwright's `clip` option. */
  clip?: { x: number; y: number; width: number; height: number };
}

/**
 * Viewport-level WebP screenshot (equivalent to `page.screenshot({ path })`
 * without `fullPage`). Relative paths resolve against process.cwd() exactly
 * like Playwright's own `path` option.
 */
export async function screenshotWebp(
  page: Page,
  filePath: string,
  options: WebpScreenshotOptions = {},
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "webp",
    quality: 90,
    // Clips can extend beyond the viewport (tall elements like
    // .messages-container), so capture beyond it whenever a clip is given.
    captureBeyondViewport: !!options.clip,
    ...(options.clip ? { clip: { scale: 1, ...options.clip } } : {}),
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(shot.data, "base64"));
}

/**
 * Element-level WebP screenshot (equivalent to `locator.screenshot({ path })`).
 * Mirrors Playwright's behavior: scrolls the element into view first, then
 * captures the full element even when it extends beyond the viewport.
 */
export async function elementScreenshotWebp(
  locator: Locator,
  filePath: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(
      `Element screenshot failed: element not visible for ${filePath}`,
    );
  }
  await screenshotWebp(locator.page(), filePath, {
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
}
