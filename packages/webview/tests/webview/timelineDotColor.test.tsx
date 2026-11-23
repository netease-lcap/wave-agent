import { describe, it, expect, beforeEach } from "vitest";
import { renderChatApp, sendCommand } from "./test-utils";
import { TOOL_STATUS_COLORS } from "../../src/utils/statusColors";
// The stylesheet is read as text rather than through node:fs, so this guard
// runs in the same browser project as the rest of the suite.
import desktopHostCss from "../../src/styles/host-desktop.css?raw";

// 状态色自 F-08 起走语义 token（statusColors.ts 的值是 `var(--cc-state-*, <原 hex>)`），
// 故这里断言 token 串而不是解析后的色值：组件下发设计 token（而不是写死的色值）本身
// 就是产品契约，一旦把它换算成具体颜色，断言就锁不住「这个颜色来自设计系统的哪一档
// token」，token 层改动时只会假红/假绿。两档取值由 host-desktop.css 定义：
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

function dotColorOf(el: HTMLElement): string {
  return el.style.getPropertyValue("--dot-color");
}

/**
 * 时间线圆点按助手回合出（spec ui/message-rendering-system.md「时间线圆点按助手
 * 回合出现（行级）」）：`--dot-color` 与 `.timeline-message` 挂在消息根节点上，
 * 块行 `.timeline-row` 不再各自带点、也不带色。
 */
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
    const streamingRow = getLastMessage();
    expect(streamingRow.classList.contains("timeline-message")).toBe(true);
    expect(dotColorOf(streamingRow)).toBe(STREAMING);

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
    const doneRow = getLastMessage();
    expect(dotColorOf(doneRow)).toBe(SUCCEEDED);
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
    expect(dotColorOf(getLastMessage())).toBe(STREAMING);

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
    expect(dotColorOf(getLastMessage())).toBe(SUCCEEDED);
  });

  // 网关偶发只给一个 "\n" 作为 reasoning_content（模型报了 reasoning_tokens
  // 却没给真实文本，见 docs/specs/core/stream-content-updates.md「思考用时
  // 展示」）。这种块不渲染、不占时间线圆点——与上一条用例对照：同样的 stage，
  // 唯一差别是 content trim 后是否为空。
  it("whitespace-only reasoning block renders no message element at all", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m2b",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "reasoning", content: "\n", stage: "end" }],
        },
      ],
    });
    // 这种块渲染不出任何节点，整条消息不进列表（visibleMessages 的过滤）：
    // 既没有 `.message` 外壳，也没有任何 `.timeline-row`。
    const container = document.querySelector(
      '[data-testid="messages-container"]',
    )!;
    expect(container.querySelectorAll(".message")).toHaveLength(0);
    expect(container.querySelectorAll(".timeline-row")).toHaveLength(0);
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
    const dotColor = () => dotColorOf(getLastMessage());

    sendBlock({ type: "tool", name: "bash", stage: "streaming" });
    expect(dotColor()).toBe(STREAMING);

    // `start` = 工具已点名、参数还没开始流：进行中，不是失败。遥控页上一次 start
    // 帧会被单独渲染出来（离散直发），这里守住它别是红的。
    sendBlock({ type: "tool", name: "bash", stage: "start" });
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
    expect(dotColorOf(getLastMessage())).toBe(SUCCEEDED);
  });

  it("compact block gives the message the link-accent dot", () => {
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
    const message = getLastMessage();
    expect(message.classList.contains("timeline-message")).toBe(true);
    expect(message.querySelector(".compact-block")).not.toBeNull();
    expect(dotColorOf(message)).toContain("textLink");
  });

  // 场景 1：一条消息里有多个块（思考 + 正文 + 两个工具调用）时只有一个圆点，
  // 块行不再各带一个点、也不再各带一份状态色。
  it("一条消息里的多个块只出一个圆点，块行不带点色", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m6",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [
            { type: "reasoning", content: "先看看", stage: "end" },
            { type: "text", content: "我来跑两个命令", stage: "end" },
            { type: "tool", name: "bash", stage: "end", success: true },
            { type: "tool", name: "bash", stage: "end", success: true },
          ],
        },
      ],
    });

    const container = document.querySelector(
      '[data-testid="messages-container"]',
    )!;
    expect(container.querySelectorAll(".timeline-message")).toHaveLength(1);
    const rows = Array.from(container.querySelectorAll(".timeline-row"));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect((row as HTMLElement).hasAttribute("style")).toBe(false);
    }
    expect(
      dotColorOf(container.querySelector(".timeline-message") as HTMLElement),
    ).toBe(SUCCEEDED);
  });

  // 场景 2：整行共用一个聚合状态，同一行不会出现两个点各自变色。
  // 优先级「进行中 > 失败 > 已完成」对齐 CC 扩展 2.1.330 的 `MPn`（先判本回合是否
  // 仍在跑，落定后才看有没有失败）——差别只在瞬时窗口。
  it("块状态不一致时按「进行中 > 失败 > 已完成」聚合", () => {
    renderChatApp();

    const send = (blocks: Record<string, unknown>[]) =>
      sendCommand("updateMessages", {
        messages: [
          {
            id: "m7",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks,
          },
        ],
      });
    const dotColor = () => dotColorOf(getLastMessage());

    // 一个成功、一个失败，且回合已落定 → 失败（顺序无关）。
    send([
      { type: "tool", name: "bash", stage: "end", success: true },
      { type: "tool", name: "bash", stage: "end", error: "boom" },
    ]);
    expect(dotColor()).toBe(FAILED);
    send([
      { type: "tool", name: "bash", stage: "end", error: "boom" },
      { type: "tool", name: "bash", stage: "end", success: true },
    ]);
    expect(dotColor()).toBe(FAILED);

    // 已有块失败、但回合还在跑 → 进行中压过失败（CC 口径）：一个仍在续跑的回合
    // 不能被显示成「已结束且失败」。
    send([
      { type: "tool", name: "bash", stage: "end", error: "boom" },
      { type: "tool", name: "bash", stage: "running" },
    ]);
    expect(dotColor()).toBe(RUNNING);
    send([
      { type: "tool", name: "bash", stage: "end", error: "boom" },
      { type: "tool", name: "bash", stage: "streaming" },
    ]);
    expect(dotColor()).toBe(STREAMING);
    send([
      { type: "text", content: "还在写", stage: "streaming" },
      { type: "tool", name: "bash", stage: "end", error: "boom" },
    ]);
    expect(dotColor()).toBe(STREAMING);

    // 已完成 + 还在流式 → 进行中（流式档）。
    send([
      { type: "tool", name: "bash", stage: "end", success: true },
      { type: "tool", name: "bash", stage: "streaming" },
    ]);
    expect(dotColor()).toBe(STREAMING);

    // 已完成 + 正在执行 → 进行中（运行档）。
    send([
      { type: "text", content: "done", stage: "end" },
      { type: "tool", name: "bash", stage: "running" },
    ]);
    expect(dotColor()).toBe(RUNNING);
  });

  // 场景 5：只有 notice 通知行的消息照常渲染那一行，但不出圆点。
  it("只有 notice 的消息渲染通知行，但不带时间线圆点", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m8",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "notice", level: "info", content: "🔄 第 3 轮" }],
        },
      ],
    });

    const message = getLastMessage();
    expect(message).not.toBeNull();
    expect(message.classList.contains("timeline-message")).toBe(false);
    expect(dotColorOf(message)).toBe("");
  });

  // 进行中的消息多带一个 --running 类（原型 .design-activity.is-running 的呼吸光
  // 晕）；收尾后回到静态点。光晕本体是 Message.css 的 `@keyframes status-pulse`
  // （box-shadow 环从 0 扩到 5px 再淡出，颜色取 --dot-color），设计师定稿的效果，
  // 断言到 computed animation-name 上，免得改选择器时把它悄悄带掉。
  it("进行中的消息带 --running 与呼吸光晕，结束后收回", () => {
    renderChatApp();

    const send = (stage: string) =>
      sendCommand("updateMessages", {
        messages: [
          {
            id: "m9",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "tool", name: "bash", stage }],
          },
        ],
      });

    send("running");
    const running = getLastMessage();
    expect(running.classList.contains("timeline-message--running")).toBe(true);
    const halo = getComputedStyle(running, "::before");
    expect(halo.animationName).toBe("status-pulse");
    expect(halo.animationIterationCount).toBe("infinite");

    send("end");
    const done = getLastMessage();
    expect(done.classList.contains("timeline-message--running")).toBe(false);
    expect(getComputedStyle(done, "::before").animationName).toBe("none");
  });
});

// JS ↔ CSS 契约守卫：statusColors.ts 引用的每个 --cc-state-* token 都必须在
// host-desktop.css 的浅色档与深色档里各有定义。任一侧改名/删除（JS 引用了 CSS
// 未定义的 token → 静默回落 fallback；CSS 删了 token → 桌面端配色失去主题分档）
// 都会让这条守卫变红，避免「两边各自漂移、只靠字面 hex 断言看不出来」。
describe("statusColors ↔ host-desktop.css 状态色 token 契约", () => {
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
    const light = declarationsOf(desktopHostCss, LIGHT_SELECTOR);
    const dark = declarationsOf(desktopHostCss, DARK_SELECTOR);
    for (const token of referencedTokens) {
      expect(light.get(token), `浅色档缺少 ${token}`).toBeTruthy();
      expect(dark.get(token), `深色档缺少 ${token}`).toBeTruthy();
    }
  });

  it("桌面端深色档与浅色档分档（状态色不沿用浅色值）", () => {
    // 深色档存在的意义就是「不沿用浅色值」：若某 token 两档同值，说明深色档
    // 没接上（回退成 F-08 之前的行为），这里直接失败。
    const css = desktopHostCss;
    const light = declarationsOf(css, LIGHT_SELECTOR);
    const dark = declarationsOf(css, DARK_SELECTOR);
    for (const token of referencedTokens) {
      expect(dark.get(token), `${token} 深浅同值，深色档未生效`).not.toBe(
        light.get(token),
      );
    }
  });
});
