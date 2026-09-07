import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    fastModel: "claude-haiku-4-20250514",
  },
  permissionMode: "default",
};

// Real-browser geometry regression for the panel divider drag. PR #2083
// (b7510480) hoisted the drag handle out of each pane onto .desktop-panel-slot,
// whose CSS had no `position` — so the handle's absolute positioning anchored
// to .desktop-chat-body instead and rendered at the far LEFT of the whole row
// (x≈257 vs the slot at x≈620): hover showed no divider highlight, cursor
// stayed default, dragging was a no-op. jsdom unit tests cannot catch this
// (they fire mousemove straight on window); these tests assert the real
// geometry: handle bbox on the slot's left edge + col-resize cursor + an
// actual width change after a mouse drag.
async function setupSinglePane(page: any, injector: MessageInjector) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-dr-1" }],
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

async function slotWidth(page: any): Promise<number> {
  const box = await page.getByTestId("desktop-panel-slot").boundingBox();
  if (!box) throw new Error("desktop-panel-slot not visible");
  return box.width;
}

// Drag the shared slot divider by dx (left-negative = widen, positive = narrow).
async function dragHandle(page: any, dx: number, steps = 24) {
  const handle = page.getByTestId("panel-slot-drag-handle");
  const h = await handle.boundingBox();
  if (!h) throw new Error("panel-slot-drag-handle not visible");
  const y = h.y + h.height / 2;
  const x0 = h.x + h.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y, { steps });
  await page.mouse.up();
}

const near = (got: number, want: number, tol: number) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

test.describe("Desktop panel divider drag (real geometry)", () => {
  test("divider handle sits on the slot's left edge, shows col-resize, and drags live", async ({
    webviewPage,
  }) => {
    const page = webviewPage as any;
    const injector = new MessageInjector(page);
    await setupSinglePane(page, injector);

    const slot = page.getByTestId("desktop-panel-slot");
    const handle = page.getByTestId("panel-slot-drag-handle");
    await expect(handle).toBeVisible();
    const slotBox = (await slot.boundingBox())!;
    const handleBox = (await handle.boundingBox())!;

    // Regression guard: the handle is absolutely positioned on the slot's left
    // edge (left:-3px) and spans the slot height — NOT the chat row's far left.
    near(handleBox.x, slotBox.x - 3, 2);
    near(handleBox.height, slotBox.height, 2);

    // Hover affordance: col-resize cursor on the divider (and while dragging).
    await handle.hover();
    const cursor = await handle.evaluate(
      (el: HTMLElement) => getComputedStyle(el).cursor,
    );
    expect(cursor).toBe("col-resize");

    // A real mouse drag narrows the slot while the button is still held.
    const S0 = slotBox.width;
    await handle.hover();
    const hb = (await handle.boundingBox())!;
    const y = hb.y + hb.height / 2;
    const x0 = hb.x + hb.width / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    const draggingCursor = await page.evaluate(
      () => getComputedStyle(document.body).cursor,
    );
    expect(draggingCursor).toBe("col-resize");
    await page.mouse.move(x0 + 90, y, { steps: 12 }); // mid-drag, button held
    await expect.poll(() => slotWidth(page)).toBeLessThanOrEqual(S0 - 80);
    near(await slotWidth(page), S0 - 90, 8);
    await page.mouse.move(x0 + 120, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => slotWidth(page)).toBeLessThanOrEqual(S0 - 110);
    near(await slotWidth(page), S0 - 120, 8);

    // Drag far right clamps at the panel minimum instead of collapsing.
    await dragHandle(page, 2000);
    near(await slotWidth(page), 320, 4);
    await expect(slot).toBeVisible();
    await expect(page.getByTestId("diff-pane")).toBeVisible();
  });

  test("manual drag locks the width against auto-fill; collapse/expand remembers it", async ({
    webviewPage,
  }) => {
    const page = webviewPage as any;
    const injector = new MessageInjector(page);
    await setupSinglePane(page, injector);

    const pane = page.getByTestId("desktop-pane-pane-1");
    const S_auto = await slotWidth(page);

    // Second tab while never manually dragged: still auto-filled (same width).
    await pane.getByTestId("panel-tabs-add").click();
    await pane.getByTestId("panel-toggle-item-preview").click();
    near(await slotWidth(page), S_auto, 3);

    // Manual drag narrows the slot and locks the width from then on.
    await dragHandle(page, 140);
    const S_manual = await slotWidth(page);
    near(S_manual, S_auto - 140, 8);

    // A new tab must NOT re-auto-fill a manually-dragged slot.
    await pane.getByTestId("panel-tabs-add").click();
    await pane.getByTestId("panel-toggle-item-diff").click();
    await expect.poll(() => slotWidth(page)).toBeLessThanOrEqual(S_manual + 3);
    near(await slotWidth(page), S_manual, 3);

    // Collapse → expand: the manual width comes back from the group cache.
    await pane.getByTestId("panel-toggle-btn").click();
    await expect(page.getByTestId("desktop-panel-slot")).toBeHidden();
    await pane.getByTestId("panel-toggle-btn").click();
    await expect(page.getByTestId("desktop-panel-slot")).toBeVisible();
    await expect.poll(() => slotWidth(page)).toBeLessThanOrEqual(S_manual + 3);
    near(await slotWidth(page), S_manual, 3);
  });

  test("empty state (no tabs) keeps the divider draggable", async ({
    webviewPage,
  }) => {
    const page = webviewPage as any;
    const injector = new MessageInjector(page);
    await setupSinglePane(page, injector);

    const S0 = await slotWidth(page);
    await page.getByTestId("panel-tab-close-diff-1").click();

    // Closing the last tab leaves the slot mounted in its empty state — the
    // divider handle must stay on the slot's left edge and still drag.
    await expect(page.getByTestId("panel-empty-state")).toBeVisible();
    await expect(page.getByTestId("panel-slot-drag-handle")).toBeVisible();
    const slotBox = (await page
      .getByTestId("desktop-panel-slot")
      .boundingBox())!;
    const handleBox = (await page
      .getByTestId("panel-slot-drag-handle")
      .boundingBox())!;
    near(handleBox.x, slotBox.x - 3, 2);

    // Auto-fill width is the maximum, so prove dragging by narrowing first,
    // then widening again (both directions move the empty-state slot).
    await dragHandle(page, 90);
    near(await slotWidth(page), S0 - 90, 8);
    await expect(page.getByTestId("panel-empty-state")).toBeVisible();

    await dragHandle(page, -45);
    near(await slotWidth(page), S0 - 45, 8);
    await expect(page.getByTestId("desktop-panel-slot")).toBeVisible();
  });
});
