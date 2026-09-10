import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { renderChatApp, sendCommand } from "./test-utils";
import { TOOL_STATUS_COLORS } from "../../src/utils/statusColors";

// 状态色自 F-08 起走语义 token（statusColors.ts 的值是 `var(--cc-state-*, <原 hex>)`），
// 故这里断言 token 串而不是解析后的色值——CSS 变量在 jsdom 里不解析，断言 hex
// 只会在 token 层改动时假红/假绿。两档取值由 host-desktop.css 定义：
//   浅色档（:root[data-host="desktop"][data-theme="light"]，值 = 原 hex，观感零回归）
//   深色档（:root[data-host="desktop"][data-theme="dark"]，深色画布上提亮/降饱和）
// 桌面端深色档相对浅色档的**新契约**（浅色档不变）：
//   streaming 橙 #E6A23C → #E8BF78 / succeeded 绿 #16A34A → #83D6A0
//   running   蓝 #2F5EDB → #8BBCF0 / failed    红 #D92D20 → #F19B95
//   idle 由 var(--vscode-descriptionForeground) 改为固定中性灰（浅 #98A2B3 / 深 #A0A5A8）
// 下面的契约守卫用例会在 JS 与 CSS 两侧漂移时变红。
const STREAMING = "var(--cc-state-streaming, #E6A23C)";
const SUCCEEDED = "var(--cc-state-succeeded, #16A34A)";
const RUNNING = "var(--cc-state-running, #2F5EDB)";
const FAILED = "var(--cc-state-failed, #D92D20)";

function getLastMessage(): HTMLElement {
  const container = document.querySelector(
    '[data-testid="messages-container"]',
  )!;
  const msgs = Array.from(container.querySelectorAll(".message"));
  return msgs[msgs.length - 1] as HTMLElement;
}

describe("timeline dot color by stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text block dot is orange while streaming and green when done", () => {
    renderChatApp();

    // streaming text → orange (流式传输 --cc-state-streaming)
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "hello", stage: "streaming" }],
        },
      ],
    });
    const streamingRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(streamingRow.style.getPropertyValue("--dot-color")).toBe(STREAMING);

    // finished text → green (成功 --cc-state-succeeded)
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "hello", stage: "end" }],
        },
      ],
    });
    const doneRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(doneRow.style.getPropertyValue("--dot-color")).toBe(SUCCEEDED);
  });

  it("reasoning block dot is orange while streaming and green when done", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [
            { type: "reasoning", content: "thinking", stage: "streaming" },
          ],
        },
      ],
    });
    const streamingRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(streamingRow.style.getPropertyValue("--dot-color")).toBe(STREAMING);

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "reasoning", content: "thinking", stage: "end" }],
        },
      ],
    });
    const doneRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(doneRow.style.getPropertyValue("--dot-color")).toBe(SUCCEEDED);
  });

  it("tool block dot follows tool status: streaming orange / running blue / success green / error red", () => {
    renderChatApp();

    const sendBlock = (block: Record<string, unknown>) => {
      sendCommand("updateMessages", {
        messages: [
          {
            id: "m5",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [block],
          },
        ],
      });
    };
    const dotColor = () =>
      (
        getLastMessage().querySelector(".timeline-row") as HTMLElement
      ).style.getPropertyValue("--dot-color");

    sendBlock({ type: "tool", name: "bash", stage: "streaming" });
    expect(dotColor()).toBe(STREAMING);

    sendBlock({ type: "tool", name: "bash", stage: "running" });
    expect(dotColor()).toBe(RUNNING);

    sendBlock({ type: "tool", name: "bash", stage: "end", success: true });
    expect(dotColor()).toBe(SUCCEEDED);

    sendBlock({ type: "tool", name: "bash", stage: "end", error: "boom" });
    expect(dotColor()).toBe(FAILED);
  });

  it("history text block without stage defaults to green dot", () => {
    renderChatApp();

    // A loaded-from-history text block has no stage → treated as done (green).
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m3",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "past message" }],
        },
      ],
    });
    const row = getLastMessage().querySelector(".timeline-row") as HTMLElement;
    expect(row.style.getPropertyValue("--dot-color")).toBe(SUCCEEDED);
  });

  it("compact block is wrapped in a timeline row with the link-accent dot", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m4",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "compact", content: "对话摘要" }],
        },
      ],
    });
    const row = getLastMessage().querySelector(".timeline-row") as HTMLElement;
    // The compact block renders inside a .timeline-row so it gets the dot and
    // the 10px top spacing like text/tool/reasoning blocks.
    expect(row).not.toBeNull();
    expect(row.querySelector(".compact-block")).not.toBeNull();
    expect(row.style.getPropertyValue("--dot-color")).toContain("textLink");
  });
});

// JS ↔ CSS 契约守卫：statusColors.ts 引用的每个 --cc-state-* token 都必须在
// host-desktop.css 的浅色档与深色档里各有定义。任一侧改名/删除（JS 引用了 CSS
// 未定义的 token → 静默回落 fallback；CSS 删了 token → 桌面端配色失去主题分档）
// 都会让这条守卫变红，避免「两边各自漂移、只靠字面 hex 断言看不出来」。
describe("statusColors ↔ host-desktop.css 状态色 token 契约", () => {
  const CSS_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../src/styles/host-desktop.css",
  );
  const LIGHT_SELECTOR = ':root[data-host="desktop"][data-theme="light"]';
  const DARK_SELECTOR = ':root[data-host="desktop"][data-theme="dark"]';

  /** 取出某个 `:root[...]` 块里的自定义属性声明（值已 trim）。 */
  const declarationsOf = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`host-desktop.css 缺少 ${selector} 块`);
    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    const decls = new Map<string, string>();
    for (const line of css.slice(open + 1, close).split("\n")) {
      const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
      if (m) decls.set(m[1], m[2].trim());
    }
    return decls;
  };

  // statusColors.ts 里引用的 token（值形如 `var(--cc-state-x, fallback)`）。
  const referencedTokens = [
    ...new Set(
      Object.values(TOOL_STATUS_COLORS).map((value) => {
        const m = value.match(/var\((--cc-state-[a-z0-9-]+)/i);
        if (!m)
          throw new Error(
            `statusColors.ts 的值应引用 --cc-state-* token，实际：${value}`,
          );
        return m[1];
      }),
    ),
  ];

  it("JS 引用的每个 token 同时有浅色档与深色档（含 idle）", () => {
    expect(referencedTokens).toEqual(
      expect.arrayContaining([
        "--cc-state-streaming",
        "--cc-state-succeeded",
        "--cc-state-running",
        "--cc-state-failed",
        "--cc-state-idle",
      ]),
    );
    const light = declarationsOf(
      readFileSync(CSS_PATH, "utf8"),
      LIGHT_SELECTOR,
    );
    const dark = declarationsOf(readFileSync(CSS_PATH, "utf8"), DARK_SELECTOR);
    for (const token of referencedTokens) {
      expect(light.get(token), `浅色档缺少 ${token}`).toBeTruthy();
      expect(dark.get(token), `深色档缺少 ${token}`).toBeTruthy();
    }
  });

  it("桌面端深色档与浅色档分档（状态色不沿用浅色值）", () => {
    // 深色档存在的意义就是「不沿用浅色值」：若某 token 两档同值，说明深色档
    // 没接上（回退成 F-08 之前的行为），这里直接失败。
    const css = readFileSync(CSS_PATH, "utf8");
    const light = declarationsOf(css, LIGHT_SELECTOR);
    const dark = declarationsOf(css, DARK_SELECTOR);
    for (const token of referencedTokens) {
      expect(dark.get(token), `${token} 深浅同值，深色档未生效`).not.toBe(
        light.get(token),
      );
    }
  });
});
