import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { BASH_TOOL_NAME, type Message } from "wave-agent-sdk";

/**
 * Confirm action bar narrow-width behavior (confirm-ui.md button-layout story,
 * scenario 8): buttons that don't fit must wrap onto a right-aligned second
 * line with fully readable labels; text ellipsis stays only as the
 * single-button fallback. Guards both the wide single-row case and the
 * narrow wrapped case (bash bar = 4 buttons, the widest one).
 */
test.describe("Confirmation actions wrap", () => {
  async function openBashConfirmation(
    webviewPage: import("@playwright/test").Page,
    first: boolean,
  ) {
    const injector = new MessageInjector(webviewPage);
    if (first) {
      await injector.simulateExtensionMessage("setInitialState", {
        messages: [],
        isStreaming: false,
        sessions: [],
        configurationData: {
          apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
          baseURL: "https://api.anthropic.com/v1",
          model: "claude-sonnet-4-20250514",
          fastModel: "claude-haiku-4-20250514",
        },
        permissionMode: "default",
      });
      const msg: Message = {
        id: "msg_wrap_bash",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "tool",
            name: BASH_TOOL_NAME,
            stage: "running",
            parameters: JSON.stringify({
              command: "pnpm -F @nebula/payment-service test -- --coverage",
              description: "运行支付服务测试套件并生成覆盖率报告",
            }),
          },
        ],
      };
      await injector.updateMessages([msg]);
    }
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: `bash-wrap-${first ? "700" : "460"}`,
      confirmationType: "Bash 命令执行确认",
      toolName: BASH_TOOL_NAME,
      toolInput: {
        command: "pnpm -F @nebula/payment-service test -- --coverage",
        description: "运行支付服务测试套件并生成覆盖率报告",
      },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");
  }

  interface BtnBox {
    label: string;
    left: number;
    right: number;
    top: number;
    height: number;
    clipped: boolean;
  }

  async function measureBar(page: import("@playwright/test").Page) {
    return page.evaluate<BtnBox[]>(() => {
      const bar = document.querySelector(".confirmation-actions");
      if (!bar) throw new Error("action bar not found");
      return [...bar.querySelectorAll(".confirmation-btn")].map((b) => {
        const r = b.getBoundingClientRect();
        const span = b.querySelector(".btn-text");
        return {
          label: span?.textContent ?? "",
          left: r.left,
          right: r.right,
          top: r.top,
          height: r.height,
          clipped: span ? span.scrollWidth > span.clientWidth + 1 : false,
        };
      });
    });
  }

  test("wide dialog keeps all four buttons on one row, labels intact", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 700, height: 800 });
    await openBashConfirmation(webviewPage, true);
    const boxes = await measureBar(webviewPage);
    expect(boxes).toHaveLength(4);
    // One visual row: tops differ only by the shorter feedback button's
    // align-items:center midline offset (~4px), not a full line height.
    const tall = boxes.filter((b) => b.height >= 32).map((b) => b.top);
    expect(Math.max(...tall) - Math.min(...tall)).toBeLessThan(2);
    for (const b of boxes) expect(b.clipped, b.label).toBe(false);
  });

  test("narrow width wraps buttons to right-aligned rows instead of truncating", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 460, height: 700 });
    await openBashConfirmation(webviewPage, false);
    const boxes = await measureBar(webviewPage);
    expect(boxes).toHaveLength(4);

    // Wrapped onto more than one line.
    const rowTops = [...new Set(boxes.map((b) => Math.round(b.top)))];
    expect(rowTops.length).toBeGreaterThan(1);

    // The primary button shares the top line with at least one secondary —
    // wrap order (row-reverse + wrap fills each line from the DOM tail)
    // keeps 批准并继续 top-right rather than pushed down alone.
    const minTop = Math.min(...boxes.map((b) => b.top));
    const topRow = boxes.filter(
      (b) => Math.round(b.top) === Math.round(minTop),
    );
    expect(topRow.some((b) => b.label === "批准并继续")).toBe(true);
    expect(topRow.length).toBeGreaterThanOrEqual(2);

    // Every occupied row ends flush with the same right edge (right-aligned).
    // Row identity comes from the 32px buttons only — the shorter 提供反馈
    // button shares a row's vertical middle (align-items:center) but its top
    // differs, so grouping on raw tops would invent an extra phantom row.
    const rowKeyOf = (b: BtnBox) => {
      if (b.height >= 32) return Math.round(b.top);
      const mid = b.top + b.height / 2;
      const tall = boxes.filter((x) => x.height >= 32);
      const nearest = tall.reduce((a, x) =>
        Math.abs(x.top + x.height / 2 - mid) <
        Math.abs(a.top + a.height / 2 - mid)
          ? x
          : a,
      );
      // Reuse that row's exact key (its rounded top).
      return Math.round(nearest.top);
    };
    const byRow = new Map<number, BtnBox[]>();
    for (const b of boxes) {
      const k = rowKeyOf(b);
      byRow.set(k, [...(byRow.get(k) ?? []), b]);
    }
    const rights = [...byRow.values()].map((row) =>
      Math.max(...row.map((b) => b.right)),
    );
    for (const r of rights.slice(1))
      expect(Math.abs(r - rights[0])).toBeLessThan(2);

    // All labels fully readable even while wrapped.
    for (const b of boxes) expect(b.clipped, b.label).toBe(false);
  });
});
