/**
 * 确认操作栏的窄宽行为（confirm-ui.md button-layout 故事场景 8）：放不下的按钮
 * 必须折到右对齐的第二行、且标签完整可读；文字省略号只留作单颗按钮时的兜底。
 * 宽的整行与窄的折行两种形态都钉住（bash 栏是 4 颗按钮，最宽的一档）。
 *
 * 迁移自 `e2e/confirm-actions-wrap.e2e.ts`：折行是布局算出来的，本套件跑在真
 * Chromium 里，窗口宽度用 `page.viewport` 直接给。
 */

import { describe, it, expect } from "vitest";
import { page } from "vitest/browser";
import { renderChatApp, sendCommand } from "./test-utils";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";

interface BtnBox {
  label: string;
  left: number;
  right: number;
  top: number;
  height: number;
  clipped: boolean;
}

const COMMAND = "pnpm -F @nebula/payment-service test -- --coverage";
const DESCRIPTION = "运行支付服务测试套件并生成覆盖率报告";

/**
 * ChatApp 初始化之后才会渲染输入区（确认框也在里面）——加载动画扫过之前它不出现，
 * 所以两种宽度都先把初始状态发完，和真宿主的流程一致。
 */
function openBashConfirmation(first: boolean) {
  renderChatApp();
  sendCommand("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  if (first) {
    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg_wrap_bash",
          role: "assistant",
          timestamp: "2025-07-09T10:30:00.000Z",
          blocks: [
            {
              type: "tool",
              name: BASH_TOOL_NAME,
              stage: "running",
              parameters: JSON.stringify({
                command: COMMAND,
                description: DESCRIPTION,
              }),
            },
          ],
        },
      ],
    });
  }
  sendCommand("showConfirmation", {
    confirmationId: `bash-wrap-${first ? "700" : "460"}`,
    confirmationType: "Bash 命令执行确认",
    toolName: BASH_TOOL_NAME,
    toolInput: { command: COMMAND, description: DESCRIPTION },
  });
}

function measureBar(): BtnBox[] {
  const bar = document.querySelector(".confirmation-actions");
  if (!bar) throw new Error("action bar not found");
  return Array.from(bar.querySelectorAll(".confirmation-btn")).map((button) => {
    const rect = button.getBoundingClientRect();
    const span = button.querySelector(".btn-text");
    return {
      label: span?.textContent ?? "",
      left: rect.left,
      right: rect.right,
      top: rect.top,
      height: rect.height,
      clipped: span ? span.scrollWidth > span.clientWidth + 1 : false,
    };
  });
}

describe("确认操作栏折行", () => {
  it("宽对话框把四颗按钮排在一行，标签完整", async () => {
    await page.viewport(700, 800);
    openBashConfirmation(true);
    const boxes = measureBar();
    expect(boxes).toHaveLength(4);
    // One visual row: tops differ only by the shorter feedback button's
    // align-items:center midline offset (~4px), not a full line height.
    const tall = boxes.filter((box) => box.height >= 32).map((box) => box.top);
    expect(Math.max(...tall) - Math.min(...tall)).toBeLessThan(2);
    for (const box of boxes) expect(box.clipped, box.label).toBe(false);
  });

  it("窄宽度把按钮折成右对齐的几行，而不是截断文字", async () => {
    await page.viewport(460, 700);
    openBashConfirmation(false);
    const boxes = measureBar();
    expect(boxes).toHaveLength(4);

    // Wrapped onto more than one line.
    const rowTops = [...new Set(boxes.map((box) => Math.round(box.top)))];
    expect(rowTops.length).toBeGreaterThan(1);

    // The primary button is last in the DOM/visual order ([提供反馈] [自动类]
    // [批准并继续] — primary last, aligned with Claude's confirm UIs; the
    // 第 30 轮 ghost-to-bottom reorder served the vertical layout and was
    // reverted when the bar went horizontal again), so on a narrow bar it
    // wraps onto the bottom line and stays pinned right.
    const maxTop = Math.max(...boxes.map((box) => box.top));
    const bottomRow = boxes.filter(
      (box) => Math.round(box.top) === Math.round(maxTop),
    );
    const primary = bottomRow.find((box) => box.label === "批准并继续");
    expect(primary).toBeDefined();
    const bottomMaxRight = Math.max(...bottomRow.map((box) => box.right));
    expect(Math.abs(primary!.right - bottomMaxRight)).toBeLessThan(2);

    // Every occupied row ends flush with the same right edge (right-aligned).
    // Row identity comes from the 32px buttons only — the shorter 提供反馈
    // button shares a row's vertical middle (align-items:center) but its top
    // differs, so grouping on raw tops would invent an extra phantom row.
    const rowKeyOf = (box: BtnBox) => {
      if (box.height >= 32) return Math.round(box.top);
      const mid = box.top + box.height / 2;
      const tall = boxes.filter((candidate) => candidate.height >= 32);
      const nearest = tall.reduce((a, candidate) =>
        Math.abs(candidate.top + candidate.height / 2 - mid) <
        Math.abs(a.top + a.height / 2 - mid)
          ? candidate
          : a,
      );
      // Reuse that row's exact key (its rounded top).
      return Math.round(nearest.top);
    };
    const byRow = new Map<number, BtnBox[]>();
    for (const box of boxes) {
      const key = rowKeyOf(box);
      byRow.set(key, [...(byRow.get(key) ?? []), box]);
    }
    const rights = [...byRow.values()].map((row) =>
      Math.max(...row.map((box) => box.right)),
    );
    for (const right of rights.slice(1))
      expect(Math.abs(right - rights[0])).toBeLessThan(2);

    // All labels fully readable even while wrapped.
    for (const box of boxes) expect(box.clipped, box.label).toBe(false);
  });
});
