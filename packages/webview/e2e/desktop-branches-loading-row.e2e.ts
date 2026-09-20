import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

// The branch-query loading placeholder (desktop-sessions.md 场景 7/8/25) sits in
// the same input-workdir-row slot as the branch/worktree controls it replaces.
// The row bottom-aligns its items (align-items: flex-end) and every control in
// it is a 32px-tall flex box, so the placeholder must carry that same 32px
// extent and center its own text — a bare one-line block would hang at the
// row's bottom edge and read ~7px below 本地 / the workdir name next to it.
const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

test.describe("Desktop branch-loading placeholder geometry", () => {
  test("sits on the same line as the host/workdir selectors it follows", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    // The harness never answers desktopListGitBranches, so the 300ms delay
    // elapses and the placeholder takes the controls' place.
    const loading = webviewPage.getByTestId("desktop-branches-loading");
    await expect(loading).toBeVisible();

    const hostBox = await webviewPage
      .locator(".desktop-host-trigger")
      .boundingBox();
    const workdirBox = await webviewPage
      .getByTestId("desktop-workdir")
      .boundingBox();
    const loadingBox = await loading.boundingBox();
    if (!hostBox || !workdirBox || !loadingBox)
      throw new Error("expected the row controls to be laid out");

    // Same vertical extent as the 32px controls, i.e. its text line sits on
    // their line instead of at the row's bottom edge.
    expect(loadingBox.height).toBeCloseTo(hostBox.height, 1);
    expect(loadingBox.height).toBeCloseTo(workdirBox.height, 1);
    expect(loadingBox.y).toBeCloseTo(hostBox.y, 1);
    expect(loadingBox.y).toBeCloseTo(workdirBox.y, 1);

    // The controls it replaces land in the same slot (no position jump).
    await injector.simulateExtensionMessage("desktopGitBranches", {
      workdir: DIR_A,
      result: { branches: ["main", "dev"], current: "main" },
    });
    const branchBox = await webviewPage
      .getByTestId("desktop-branch-selector")
      .boundingBox();
    if (!branchBox)
      throw new Error("expected the branch selector to be laid out");
    expect(branchBox.y).toBeCloseTo(loadingBox.y, 1);
    expect(branchBox.height).toBeCloseTo(loadingBox.height, 1);
    expect(branchBox.x).toBeCloseTo(loadingBox.x, 1);
  });
});
