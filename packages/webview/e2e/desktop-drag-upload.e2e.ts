import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

const WORKDIR = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/**
 * 桌面端文件拖拽上传浮层（spec desktop-file-panel.md「文件拖拽上传」）。
 *
 * 拖拽用的是真实的 `DragEvent` + `DataTransfer`，所以只有真实浏览器能验：
 * 浮层只在 `dataTransfer.types` 含 `Files` 时出现（从浏览器拖一段文字进来
 * 不该触发上传），离开与释放都要把它收掉。
 */
test.describe("Desktop file drag-and-drop upload overlay", () => {
  test("file drag raises the overlay, leaving or dropping clears it", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    const overlay = webviewPage.getByTestId("chat-drag-overlay");

    const dispatchDrag = (type: string, withFile: boolean) =>
      webviewPage.evaluate(
        ({ type, withFile }) => {
          const dataTransfer = new DataTransfer();
          if (withFile) dataTransfer.items.add(new File([""], "hello.txt"));
          else dataTransfer.setData("text/plain", "hello");
          document
            .querySelector('[data-testid="chat-container"]')
            ?.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer,
              }),
            );
        },
        { type, withFile },
      );

    // Non-file drags (dragging selected text, say) must not raise the overlay.
    await dispatchDrag("dragenter", false);
    await expect(overlay).toHaveCount(0);

    await dispatchDrag("dragenter", true);
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("释放以上传文件");
    await expect(overlay).toContainText("支持多文件，上传到当前对话");

    // Re-entering a child element increments the enter counter; the overlay has
    // to survive one matching leave (the counter is what keeps it from
    // flickering as the pointer crosses inner elements).
    await dispatchDrag("dragenter", true);
    await dispatchDrag("dragleave", true);
    await expect(overlay).toBeVisible();

    await dispatchDrag("dragleave", true);
    await expect(overlay).toHaveCount(0);

    // A drop consumes the drag and hides the overlay as well.
    await dispatchDrag("dragenter", true);
    await expect(overlay).toBeVisible();
    await dispatchDrag("drop", true);
    await expect(overlay).toHaveCount(0);
  });
});
