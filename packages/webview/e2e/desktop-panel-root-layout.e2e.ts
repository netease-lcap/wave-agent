import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import fs from "fs";
import path from "path";

// Real-browser regression for the panel divider drag clamp. The old ROOT
// layout (a direct .desktop-layout > .chat-container flex child) had no
// min-width:0, so the chat container's implicit flex min-width:auto let the
// conversation column's min-content (chat main + fixed-width panel slot)
// widen the container itself: the clamp's `containerW - 360` ceiling grew
// with every drag, the panel kept widening and its right edge ran off the
// window. That CSS path is gone — the pane layout is pushed at desktopReady
// (spec desktop-layout.md「启动即单个分屏」), so the welcome/empty chat lives
// in the single pane whose chat container carries `.desktop-pane
// .chat-container { min-width: 0 }`. These geometry assertions pin the same
// contract for the startup single pane: dragging the divider far past the
// conversation minimum clamps the slot instead of growing the container.
async function setupSinglePane(page: any, injector: MessageInjector) {
  await page.setViewportSize({ width: 1280, height: 720 });
  // The real desktop index.html loads host-desktop.css; the shared harness
  // does not. Inject it so the [data-host="desktop"] rules (composer sizing,
  // theme overrides) apply and the geometry matches a real desktop window.
  const hostCss = fs.readFileSync(
    path.join(process.cwd(), "src", "styles", "host-desktop.css"),
    "utf8",
  );
  await page.addStyleTag({ content: hostCss });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: "/Users/dev/projects/wave-agent",
    recentWorkdirs: ["/Users/dev/projects/wave-agent"],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    configurationData: {
      model: "claude-sonnet-4-20250514",
      fastModel: "claude-haiku-4-20250514",
    },
    permissionMode: "default",
  });
  // The harness answers desktopReady by pushing the single unbound pane, so
  // the welcome chat renders inside .desktop-pane-pane-1 — no manual push.
  await expect(page.getByTestId("desktop-pane-pane-1")).toBeVisible();
}

// Measure geometry scoped to the pane hosting the conversation + panel slot.
async function geometry(page: any) {
  return page.evaluate(() => {
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, w: b.width, right: b.right };
    };
    const pane = document.querySelector(".desktop-pane");
    return {
      chat: r(pane?.querySelector(".chat-container") ?? null),
      main: r(document.querySelector(".desktop-chat-main")),
      slot: r(document.querySelector(".desktop-panel-slot")),
    };
  });
}

async function dragWide(page: any, dx: number) {
  const handle = page.getByTestId("panel-slot-drag-handle");
  const h = await handle.boundingBox();
  const y = h!.y + h!.height / 2;
  const x0 = h!.x + h!.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y, { steps: 24 });
  await page.mouse.up();
}

test("startup single pane: divider cannot widen the panel past the conversation minimum", async ({
  webviewPage,
}) => {
  const page = webviewPage as any;
  const injector = new MessageInjector(page);
  await setupSinglePane(page, injector);

  // Open the side panel in its EMPTY state (no tab) — the reporter's repro
  // used the empty panel; its placeholder content sets the slot's min-content.
  await page.getByTestId("panel-toggle-btn").click();
  await expect(page.getByTestId("desktop-panel-slot")).toBeVisible();
  await expect(page.getByTestId("panel-empty-state")).toBeVisible();

  const before = await geometry(page);
  expect(before.chat!.w).toBeGreaterThan(0);
  // The welcome/empty chat renders inside the startup single pane.
  expect(await page.locator(".desktop-pane").count()).toBe(1);

  // Narrow first (leaves headroom to widen), then try to widen far past the
  // conversation minimum — pre-fix this grew the chat container itself and ran
  // the slot's right edge off the window.
  //
  // Reproducing the real-Electron failure: in the user's session the welcome
  // column's content min-content (~497px — the composer) could not shrink, so
  // .desktop-chat-body's min-content (main + fixed-width slot) exceeded the
  // container and — without the pane's min-width:0 — stretched the chat
  // container itself on every drag. Headless Chromium's composer has a smaller
  // min-content so it never overflows; force the same condition by pinning an
  // inline min-width on the chat main.
  await page.evaluate(() => {
    const main = document.querySelector(".desktop-chat-main") as HTMLElement;
    main.style.minWidth = "500px";
  });
  await dragWide(page, 500);
  const narrowed = await geometry(page);
  expect(narrowed.slot!.w).toBeLessThan(before.slot!.w - 100);

  // Two consecutive "widen far past the limit" drags: pre-fix each drag fed
  // back into the chat container's own width (min-width:auto), so the clamp's
  // `containerW - 360` ceiling grew with the panel and the slot widened with
  // no bound. Post-fix the container stays fixed, the first drag clamps the
  // slot to the ceiling, and a second drag must not widen it further.
  await dragWide(page, -3000);
  const after = await geometry(page);

  await dragWide(page, -3000);
  const after2 = await geometry(page);

  // 1. The conversation column keeps its minimum width (clamp fired).
  expect(after.main!.w).toBeGreaterThanOrEqual(356);
  // 2. The chat container did NOT grow (no container-feedback loop).
  expect(Math.abs(after.chat!.w - before.chat!.w)).toBeLessThanOrEqual(3);
  // 3. The second drag does not widen the slot further (clamp holds, no
  //    positive feedback) and the panel ended at the ceiling ≈ chat − 360.
  expect(after2.slot!.w).toBeLessThanOrEqual(after.slot!.w + 1);
  expect(Math.abs(after2.slot!.w - (after2.chat!.w - 360))).toBeLessThanOrEqual(
    6,
  );
  expect(Math.abs(after2.chat!.w - before.chat!.w)).toBeLessThanOrEqual(3);
});
