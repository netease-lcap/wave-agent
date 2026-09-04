import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";
const DIR_C = "/Users/dev/projects/notes-app";

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

/**
 * Real-browser keyboard verification for the shared roving-tabindex model of
 * the desktop dropdowns (host / workdir / branch selectors, the sidebar more
 * menu, and the header panel-toggle menu). jsdom tests can only simulate
 * focus() by hand — here every keystroke is a real keyboard event and every
 * focus assertion goes through Playwright's toBeFocused, which is what
 * actually validates: opening auto-focuses an item, Arrow keys move real
 * focus, Enter/Space activate the focused item, Escape closes back to the
 * trigger, and Tab closes the menu.
 */
test.describe("Desktop dropdown roving keyboard", () => {
  test("workdir menu: opens focused, arrows move, Enter selects, Escape returns to trigger", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
    });

    const trigger = webviewPage.getByTestId("desktop-workdir");
    await trigger.focus();
    await webviewPage.keyboard.press("Enter");
    const menu = webviewPage.getByTestId("desktop-workdir-menu");
    await expect(menu).toBeVisible();

    // Opening focuses the first recent item (hook's rAF-deferred focus).
    const recents = webviewPage.getByTestId("desktop-workdir-recent-item");
    await expect(recents.first()).toBeFocused();

    // ArrowDown moves real focus to the next recent entry.
    await webviewPage.keyboard.press("ArrowDown");
    await expect(recents.nth(1)).toBeFocused();

    // Enter activates the focused entry: posts the selection and closes.
    await webviewPage.keyboard.press("Enter");
    await injector.waitForMessage("desktopSelectRecentWorkdir");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("workdir menu: Escape returns focus, Tab closes without activating", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
    });

    const trigger = webviewPage.getByTestId("desktop-workdir");
    const menu = webviewPage.getByTestId("desktop-workdir-menu");

    await trigger.focus();
    await webviewPage.keyboard.press("Enter");
    await expect(webviewPage.getByTestId("desktop-workdir-menu")).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-workdir-recent-item").first(),
    ).toBeFocused();

    await webviewPage.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    // Reopen and leave with Tab: the menu closes, nothing gets activated
    // (no desktopSelectRecentWorkdir / desktopSelectWorkdir posted).
    await webviewPage.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    // Wait for the open auto-focus to land on the first item first — Tab
    // closes the menu only from an item (from the trigger it would just move
    // focus to the next tab stop with the menu open).
    await expect(
      webviewPage.getByTestId("desktop-workdir-recent-item").first(),
    ).toBeFocused();
    await webviewPage.keyboard.press("Tab");
    await expect(menu).toBeHidden();
  });

  test("host menu: arrows rove over 本地/SSH hosts and Enter selects", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod", "stage"],
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
    });

    const trigger = webviewPage.getByTestId("desktop-host");
    await trigger.focus();
    await webviewPage.keyboard.press("Enter");
    const menu = webviewPage.getByTestId("desktop-host-menu");
    await expect(menu).toBeVisible();

    // Opens focused on 本地, then arrows walk prod → stage (no wrap below).
    const localItem = webviewPage.getByTestId("desktop-host-local");
    const sshItems = webviewPage.getByTestId("desktop-host-item");
    const addItem = webviewPage.getByTestId("desktop-host-add-entry");
    await expect(localItem).toBeFocused();
    await webviewPage.keyboard.press("ArrowDown");
    await expect(sshItems.first()).toBeFocused();
    await webviewPage.keyboard.press("ArrowDown");
    await expect(sshItems.nth(1)).toBeFocused();
    // Next stop is the 添加主机… entry; pressing it again clamps there.
    await webviewPage.keyboard.press("ArrowDown");
    await expect(addItem).toBeFocused();
    await webviewPage.keyboard.press("ArrowDown");
    await expect(addItem).toBeFocused();

    // ArrowUp back to the last SSH host; Enter selects it and closes back to
    // the trigger.
    await webviewPage.keyboard.press("ArrowUp");
    await expect(sshItems.nth(1)).toBeFocused();
    await webviewPage.keyboard.press("Enter");
    await injector.waitForMessage("desktopSelectHost");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("branch menu: opens focused on the current branch (not necessarily first)", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
    });

    // The new-session page asks for the repo's branches; current is the LAST
    // item so the auto-focus must land there, not on the first option.
    await injector.waitForMessage("desktopListGitBranches");
    await injector.simulateExtensionMessage("desktopGitBranches", {
      workdir: DIR_A,
      result: {
        branches: ["main", "feature/login", "develop"],
        current: "develop",
      },
    });

    const trigger = webviewPage.getByTestId("desktop-branch-selector");
    await expect(
      webviewPage.getByTestId("desktop-worktree-controls"),
    ).toBeVisible();

    await trigger.focus();
    await webviewPage.keyboard.press("Enter");
    const items = webviewPage.getByTestId("desktop-branch-item");
    await expect(items.nth(2)).toBeFocused();

    // ArrowUp walks back to feature/login; Escape closes back to the trigger.
    await webviewPage.keyboard.press("ArrowUp");
    await expect(items.nth(1)).toBeFocused();
    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.getByTestId("desktop-branch-menu")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("account card more menu: auto-focus on open, arrows move, Escape returns", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      isAuthenticated: true,
    });
    await injector.simulateExtensionMessage("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      plan: null,
      apiQuota: null,
    });

    // v3 account card: the personal-info hotzone opens the menu.
    const trigger = webviewPage.getByTestId("account-card-hotzone");
    await trigger.click();
    const menu = webviewPage.getByTestId("more-menu");
    await expect(menu).toBeVisible();

    // Controlled menu mounts already open: the first item gets real focus.
    const settings = webviewPage.getByTestId("more-menu-settings");
    await expect(settings).toBeFocused();

    await webviewPage.keyboard.press("ArrowDown");
    await expect(webviewPage.getByTestId("more-menu-enterprise")).toBeFocused();

    await webviewPage.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("panel tabs ＋ menu: opens focused, Space activates + closes, arrows move, Escape returns", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
    });

    // The "＋" menu lives in the tab bar, so a first tab must exist: open the
    // terminal panel via the header toggle (empty slot → empty-state entry).
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-terminal").click();
    await expect(webviewPage.getByTestId("terminal-pane")).toBeVisible();

    const add = webviewPage.getByTestId("panel-tabs-add");
    await add.click();
    const menu = webviewPage.getByTestId("panel-toggle-menu");
    await expect(menu).toBeVisible();

    // Opening focuses the first item (预览).
    const preview = webviewPage.getByTestId("panel-toggle-item-preview");
    await expect(preview).toBeFocused();

    // Arrows move between items without activating.
    await webviewPage.keyboard.press("ArrowDown");
    await expect(
      webviewPage.getByTestId("panel-toggle-item-plan"),
    ).toBeFocused();
    await webviewPage.keyboard.press("ArrowDown");
    const diff = webviewPage.getByTestId("panel-toggle-item-diff");
    await expect(diff).toBeFocused();

    // Space activates the focused item; the tab-bar menu is closeOnActivate —
    // the diff panel opens and the menu closes back to the "＋" trigger.
    await webviewPage.keyboard.press(" ");
    await expect(menu).toBeHidden();
    await expect(webviewPage.getByTestId("diff-pane")).toBeVisible();
    await expect(add).toBeFocused();
  });
});
