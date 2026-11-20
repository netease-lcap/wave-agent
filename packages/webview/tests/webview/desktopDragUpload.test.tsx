/**
 * 桌面端文件拖拽上传浮层（spec desktop-file-panel.md「文件拖拽上传」）。
 *
 * 迁移自 `e2e/desktop-drag-upload.e2e.ts`。拖拽用的是真实的 `DragEvent` +
 * `DataTransfer`，所以只有真实浏览器能验（browser mode 跑的正是真 Chromium）：
 * 浮层只在 `dataTransfer.types` 含 `Files` 时出现（从浏览器拖一段文字进来不该触发
 * 上传），离开与释放都要把它收掉。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { act } from "@testing-library/react";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const WORKDIR = "/Users/dev/projects/wave-agent";

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

const OVERLAY = '[data-testid="chat-drag-overlay"]';

/**
 * 派发一次真实拖拽事件。`fireEvent` 不能用来造 `dataTransfer`：它会用
 * `new window.DataTransfer()` 重建一个，只拷贝源对象的**自有属性**，原生
 * `DataTransfer` 到组件里就是空的 —— 既没有 `types`（浮层永不出现）也没有
 * `files`（什么都不会上传）。
 */
function dispatchDrag(type: string, withFile: boolean) {
  const dataTransfer = new DataTransfer();
  if (withFile) dataTransfer.items.add(new File([""], "hello.txt"));
  else dataTransfer.setData("text/plain", "hello");
  const target = document.querySelector('[data-testid="chat-container"]');
  if (!target) throw new Error("desktop shell rendered no chat container");
  act(() => {
    target.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
  });
}

describe("Desktop file drag-and-drop upload overlay", () => {
  it("file drag raises the overlay, leaving or dropping clears it", async () => {
    await page.viewport(960, 640);
    renderDesktopApp();
    bootDesktop({ workdir: WORKDIR });

    const overlayCount = () => document.querySelectorAll(OVERLAY).length;

    // Non-file drags (dragging selected text, say) must not raise the overlay.
    dispatchDrag("dragenter", false);
    expect(overlayCount()).toBe(0);

    dispatchDrag("dragenter", true);
    await expect.poll(() => isVisible(OVERLAY)).toBe(true);
    const overlayText = () =>
      document.querySelector(OVERLAY)?.textContent ?? "";
    expect(overlayText()).toContain("释放以上传文件");
    expect(overlayText()).toContain("支持多文件，上传到当前对话");

    // Re-entering a child element increments the enter counter; the overlay has
    // to survive one matching leave (the counter is what keeps it from
    // flickering as the pointer crosses inner elements).
    dispatchDrag("dragenter", true);
    dispatchDrag("dragleave", true);
    expect(isVisible(OVERLAY)).toBe(true);

    dispatchDrag("dragleave", true);
    await expect.poll(overlayCount).toBe(0);

    // A drop consumes the drag and hides the overlay as well.
    dispatchDrag("dragenter", true);
    await expect.poll(() => isVisible(OVERLAY)).toBe(true);
    dispatchDrag("drop", true);
    await expect.poll(overlayCount).toBe(0);
  });
});
