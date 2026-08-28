import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

// Real-browser verification of the sidebar session-tree keyboard model
// (spec docs/specs/ui/desktop-app.md 「会话管理」scenarios 13-19): every
// session row is natively Tab-focusable (claude.ai model), ↑/↓/Home/End
// move between rows as an accelerator, delete buttons sit outside the Tab
// order (←/→ only), and no delete shortcut exists. jsdom covers the focus
// logic; this file covers what jsdom cannot: native button Enter/Space
// activation, :focus-within reveal and real Tab-order traversal.

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";

const treeSession = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  running: false,
  waitingConfirmation: false,
});

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

const activeTestId = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute("data-testid") ?? null;
  });

// Group header buttons carry no data-testid themselves (it lives on the
// wrapping group div); assert focus by their class instead.
const activeIsGroupHeader = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.classList.contains(
      "desktop-session-group-header",
    ),
  );

test.describe("Desktop sidebar keyboard navigation", () => {
  test("Tab walks every row, arrows, Enter semantics and group collapse", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B],
    });
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: DIR_A,
          sessions: [treeSession("s1", "会话一"), treeSession("s2", "会话二")],
        },
        {
          host: "local",
          workdir: DIR_B,
          sessions: [treeSession("s3", "会话三")],
        },
      ],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    const sidebar = webviewPage.getByTestId("desktop-sidebar");
    await expect(sidebar).toBeVisible();

    const mainS1 = webviewPage.getByTestId("desktop-session-main-s1");
    const mainS3 = webviewPage.getByTestId("desktop-session-main-s3");
    const deleteS1 = webviewPage.getByTestId("desktop-session-delete-s1");
    const headerA = webviewPage
      .getByTestId("desktop-session-group-local:" + DIR_A)
      .locator(".desktop-session-group-header");

    // ── Scenario 13: Tab walks the tree row by row ──────────────────
    // Tab from before the tree: group headers and session mains are ALL in
    // the Tab order (claude.ai model); delete buttons never are.
    await webviewPage.getByTestId("desktop-new-session").focus();
    const tabStops: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      await webviewPage.keyboard.press("Tab");
      tabStops.push(
        (await activeIsGroupHeader(webviewPage))
          ? "group-header"
          : await activeTestId(webviewPage),
      );
    }
    // Order: header A → s1 → s2 → header B → s3 (delete buttons skipped).
    expect(tabStops).toEqual([
      "group-header",
      "desktop-session-main-s1",
      "desktop-session-main-s2",
      "group-header",
      "desktop-session-main-s3",
    ]);

    // ── Scenario 14/15: ↑/↓ move across groups with wrap-around; Home/End ──
    await mainS1.focus();
    await webviewPage.keyboard.press("ArrowDown");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s2");
    // Past the last row wraps to the first (crossing group A → B → A).
    await webviewPage.keyboard.press("ArrowDown");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s3");
    await webviewPage.keyboard.press("ArrowDown");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s1");
    await webviewPage.keyboard.press("ArrowUp");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s3");
    await webviewPage.keyboard.press("Home");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s1");
    await webviewPage.keyboard.press("End");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s3");

    // ── Scenario 17 (first half): Enter on the main button restores ──
    await webviewPage.evaluate(() => window.clearTestMessages());
    await mainS1.focus();
    await webviewPage.keyboard.press("Enter");
    const posted = await webviewPage.evaluate(() => window.getTestMessages());
    expect(posted).toContainEqual(
      expect.objectContaining({
        command: "desktopSelectSession",
        sessionId: "s1",
      }),
    );

    // ── Scenario 16: ←/→ cross one row; the delete button reveals on
    // focus (:focus-within) and stays clamped at the row's edge ──
    await webviewPage.keyboard.press("ArrowRight");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-delete-s1");
    await expect(deleteS1).toHaveCSS("opacity", "1");
    // Second → stays clamped on the delete button.
    await webviewPage.keyboard.press("ArrowRight");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-delete-s1");
    // ← returns to the row's main button; the delete button STAYS visible —
    // the row is still :focus-within (mirrors Claude's group-focus-within).
    await webviewPage.keyboard.press("ArrowLeft");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s1");
    await expect(deleteS1).toHaveCSS("opacity", "1");

    // Focus leaving the row hides it again.
    await webviewPage.keyboard.press("ArrowDown");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s2");
    await expect(deleteS1).toHaveCSS("opacity", "0");

    // Vertical movement resumes from that row while on the delete button.
    await webviewPage.keyboard.press("ArrowUp");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s1");
    await webviewPage.keyboard.press("ArrowRight");
    await webviewPage.keyboard.press("ArrowDown");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s2");

    // ── Scenario 17 (second half): Enter on the delete button opens the
    // confirm dialog; Escape cancels ──
    await webviewPage.keyboard.press("ArrowLeft");
    await webviewPage.keyboard.press("ArrowRight");
    await webviewPage.keyboard.press("Enter");
    const overlay = webviewPage.getByTestId("confirm-dialog-overlay");
    await expect(overlay).toBeVisible();
    await webviewPage.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    // Deletion never posted without confirmation (scenario 19).
    const posted2 = await webviewPage.evaluate(() => window.getTestMessages());
    expect(
      posted2.filter((m) => m["command"] === "desktopDeleteSession"),
    ).toHaveLength(0);

    // ── Scenario 18: group headers are keyboard-toggleable buttons ──
    await webviewPage.keyboard.press("Escape"); // ensure dialog is gone
    await headerA.focus();
    await webviewPage.keyboard.press("Enter");
    await expect(headerA).toHaveAttribute("aria-expanded", "false");
    await expect(mainS1).toBeHidden();
    // Collapsed rows leave the arrow-navigation set entirely: only s3
    // remains, so ↓ wraps onto itself.
    await mainS3.focus();
    await webviewPage.keyboard.press("ArrowDown");
    expect(await activeTestId(webviewPage)).toBe("desktop-session-main-s3");
    // Re-expand for a clean teardown.
    await headerA.focus();
    await webviewPage.keyboard.press("Enter");
    await expect(headerA).toHaveAttribute("aria-expanded", "true");
    await expect(mainS1).toBeVisible();
  });
});
