import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

const DIR_A = "/Users/dev/projects/wave-agent";

// Mirrors `CHAT_MAIN_MIN_WIDTH` / `PANEL_MIN_WIDTH` in ChatApp.tsx.
const CHAT_MAIN_MIN_WIDTH = 360;
const PANEL_MIN_WIDTH = 202;

// 1600 is the shipping default window; 720 is Electron's `minWidth`
// (packages/desktop/src/main/index.ts), so this is the real user-reachable range.
const STAIR = [1600, 1400, 1200, 1000, 900, 800, 720];

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

// Regression for the "drag the desktop window narrower and the conversation
// column collapses to zero" bug (spec desktop-right-panel.md 场景 4): the panel
// slot used to carry an inline absolute pixel width with `flex: 0 0 auto` while
// `.desktop-chat-main` had `min-width: 0`, and ChatApp listened to no resize at
// all — so every pixel the window lost came out of the conversation column.
//
// The empty `messages` array keeps the welcome page branch on screen, which is
// the same DOM path (`.chat-container--welcome` → `.desktop-chat-body`).
async function setupSinglePane(page: any, injector: MessageInjector) {
  await page.setViewportSize({ width: 1600, height: 800 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-vr-1" }],
    focusedPaneId: "pane-1",
  });
  await page
    .getByTestId("desktop-pane-pane-1")
    .getByTestId("panel-toggle-btn")
    .click();
  await page
    .getByTestId("desktop-pane-pane-1")
    .getByTestId("panel-empty-item-diff")
    .click();
  await expect(page.getByTestId("desktop-panel-slot")).toBeVisible();
}

type Metrics = {
  /** `.chat-container` — what ChatApp's ResizeObserver measures (the derived-width input). */
  containerW: number;
  /** The row that holds conversation column + panel slot. */
  rowW: number;
  rowRight: number;
  /** `.desktop-chat-main` — the conversation column. */
  chatW: number;
  /** `.desktop-panel-slot` border-box width (inline width = effective width). */
  panelW: number;
  panelRight: number;
  /** True when the divider handle is actually hit-testable at its centre. */
  handleHit: boolean;
  docScrollWidth: number;
  docClientWidth: number;
};

const measure = (page: any): Promise<Metrics> =>
  page.evaluate(() => {
    const container = document.querySelector(
      ".chat-container",
    ) as HTMLElement | null;
    const row = document.querySelector(
      ".desktop-chat-body",
    ) as HTMLElement | null;
    const chat = document.querySelector(
      ".desktop-chat-main",
    ) as HTMLElement | null;
    const slot = document.querySelector(
      '[data-testid="desktop-panel-slot"]',
    ) as HTMLElement | null;
    const handle = document.querySelector(
      '[data-testid="panel-slot-drag-handle"]',
    ) as HTMLElement | null;
    if (!container || !row || !chat || !slot || !handle) {
      throw new Error(
        "desktop chat row / chat column / panel slot not mounted",
      );
    }
    const cr = container.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    const hr = handle.getBoundingClientRect();
    const hit = document.elementFromPoint(
      hr.x + hr.width / 2,
      hr.y + hr.height / 2,
    );
    return {
      containerW: cr.width,
      rowW: rr.width,
      rowRight: rr.right,
      chatW: chat.clientWidth,
      panelW: sr.width,
      panelRight: sr.right,
      handleHit: hit !== null && (hit === handle || handle.contains(hit)),
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    };
  });

/** `clamp(memory, PANEL_MIN_WIDTH, max(PANEL_MIN_WIDTH, row − CHAT_MAIN_MIN_WIDTH))` */
const effectivePanelWidth = (rowW: number, memory: number): number =>
  Math.max(
    PANEL_MIN_WIDTH,
    Math.min(memory, Math.max(PANEL_MIN_WIDTH, rowW - CHAT_MAIN_MIN_WIDTH)),
  );

const near = (got: number, want: number, tol = 2) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

async function dragHandle(page: any, dx: number) {
  const handle = page.getByTestId("panel-slot-drag-handle");
  const h = (await handle.boundingBox())!;
  const y = h.y + h.height / 2;
  const x0 = h.x + h.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y, { steps: 24 });
  await page.mouse.up();
}

test.describe("Desktop panel vs conversation column on window resize", () => {
  test("viewport stair: conversation column holds 360, panel derives from the row, nothing overflows", async ({
    webviewPage,
  }) => {
    const page = webviewPage as any;
    const injector = new MessageInjector(page);
    await setupSinglePane(page, injector);

    const wide = await measure(page);
    // The never-dragged slot is the live 40/60 split; that value is the
    // "remembered" width for the rest of the stair (window resizes must not
    // rewrite it).
    const memory = wide.panelW;
    near(wide.panelW, effectivePanelWidth(wide.containerW, memory), 4);

    const table: Array<Record<string, number | boolean>> = [];
    for (const viewport of STAIR) {
      await page.setViewportSize({ width: viewport, height: 800 });
      // Let ResizeObserver + the derived-width render settle before measuring.
      await page.waitForTimeout(250);
      table.push({ viewport, ...(await measure(page)) });
    }
    console.log("viewport stair metrics", JSON.stringify(table, null, 2));

    for (const row of table) {
      const viewport = row.viewport as number;
      const m = row as unknown as Metrics;
      const label = `viewport ${viewport}px`;
      // 1. The conversation column keeps its floor — 359.x with pixel rounding.
      expect(m.chatW, `${label}: chat column`).toBeGreaterThanOrEqual(
        CHAT_MAIN_MIN_WIDTH - 4,
      );
      // 2. No horizontal scrolling of the document.
      expect(m.docScrollWidth, `${label}: document scrollWidth`).toBe(
        m.docClientWidth,
      );
      // 3. The panel is the derived width, not the stale stored pixels.
      near(m.panelW, effectivePanelWidth(m.containerW, memory), 3);

      // 4. Whenever the row can no longer hold both floors, the panel's right
      //    edge is clipped (not reflowed into a sliver) and the divider handle
      //    on its LEFT edge stays hittable — otherwise the panel would be
      //    unreachable at narrow widths.
      if (m.panelRight > m.rowRight + 1) {
        expect(m.handleHit, `${label}: divider handle hittable`).toBe(true);
      }
    }

    // The narrowest step must genuinely exercise the clipping branch, otherwise
    // the assertions above would pass vacuously.
    const narrow = table[table.length - 1];
    expect(narrow.panelRight as number).toBeGreaterThan(
      (narrow.rowRight as number) + 1,
    );
    near(narrow.panelW as number, PANEL_MIN_WIDTH, 3);
    console.log("viewport stair metrics", JSON.stringify(table, null, 2));
  });

  test("window resize never writes the derived width back into the session memory", async ({
    webviewPage,
  }) => {
    const page = webviewPage as any;
    const injector = new MessageInjector(page);
    await setupSinglePane(page, injector);

    // Drag the panel as wide as the row allows (clamped at row − 360).
    await dragHandle(page, -2000);
    const widest = await measure(page);
    near(widest.panelW, widest.rowW - CHAT_MAIN_MIN_WIDTH, 4);

    // Shrink: the panel shrinks to the derived width, conversation holds 360.
    // Poll the derived width itself — the conversation column is already at its
    // CSS floor on the first frame after the resize, so polling chatW would
    // return before ResizeObserver has delivered the new row width.
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect
      .poll(async () => {
        const m = await measure(page);
        return Math.abs(
          m.panelW - effectivePanelWidth(m.containerW, widest.panelW),
        );
      })
      .toBeLessThanOrEqual(3);
    const shrunk = await measure(page);
    expect(shrunk.chatW).toBeGreaterThanOrEqual(CHAT_MAIN_MIN_WIDTH - 4);
    expect(shrunk.panelW).toBeLessThan(widest.panelW - 100);

    // Grow back: the user's dragged width returns. A `setPanelWidth(clamped)`
    // on resize would have frozen the narrowed value here instead.
    await page.setViewportSize({ width: 1600, height: 800 });
    await expect
      .poll(async () => (await measure(page)).panelW)
      .toBeGreaterThan(shrunk.panelW + 100);
    const restored = await measure(page);
    near(restored.panelW, widest.panelW, 3);

    // Same round trip from the bottom of the range: narrow window puts the
    // panel at its floor, growing back still restores the dragged width.
    await page.setViewportSize({ width: 720, height: 800 });
    await expect
      .poll(async () => (await measure(page)).panelW)
      .toBeLessThanOrEqual(PANEL_MIN_WIDTH + 3);
    near((await measure(page)).panelW, PANEL_MIN_WIDTH, 3);
    await page.setViewportSize({ width: 1600, height: 800 });
    await expect
      .poll(async () => (await measure(page)).panelW)
      .toBeGreaterThan(PANEL_MIN_WIDTH + 100);
    near((await measure(page)).panelW, widest.panelW, 3);
    // The conversation column never paid for any of it.
    expect((await measure(page)).chatW).toBeGreaterThanOrEqual(
      CHAT_MAIN_MIN_WIDTH - 4,
    );
  });
});
