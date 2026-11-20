/**
 * 提问卡片高度跟内容（ask-user-tool.md「提问卡片高度跟内容、不再固定封顶」）。
 *
 * 卡片此前固定 `max-height: min(70vh, 560px)`：选项一多，可见高度就停在 560px，
 * 其余选项要卡内滚动才看得到；CC 桌面端的提问卡是 `max-height: none`。放开之后
 * 超面板高度不再靠「卡内滚动」兜底，而是「卡片收缩 + 弹窗主体内部滚」——后者是
 * `.input-area-container--confirm` 那条 flex 收缩链，只能在真实浏览器里量。
 *
 * 迁移自 `e2e/confirm-card-height.e2e.ts`：那边原来写「jsdom 不解析外部样式表，
 * 高度/溢出一律量不到」，而本套件跑在真 Chromium 里，量到的就是真布局。
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { page } from "vitest/browser";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  BASH_TOOL_NAME,
} from "wave-agent-sdk/constants";
import "../../src/styles/globals.css";
import "../../src/styles/host-desktop.css";

const WORKDIR = "/work/a";

const TALL = { width: 1400, height: 900 };
const SHORT = { width: 900, height: 520 };

/** 旧封顶：改前卡片高度上限（70vh 与 560 取小）。 */
const OLD_CAP = 560;

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 8 个选项：内容高度超过 560（桌面一个选项约 54px），旧封顶会在这道题上生效。 */
const manyQuestions = [
  {
    question: "这一轮先做哪几件事？",
    options: Array.from({ length: 8 }, (_, i) => ({
      label: `候选项 ${i + 1}`,
      description: `第 ${i + 1} 件事的说明`,
    })),
    multiSelect: true,
  },
];

function renderDesktop() {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  // 一条一条发：`desktopWorkdirState` 挂出 ChatApp，下一条才落得到它的监听上。
  sendCommand("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  sendCommand("setInitialState", initialState);
  return vscode;
}

function seedConversation() {
  sendCommand("updateMessages", {
    messages: [
      {
        id: "msg-ch-u1",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [{ type: "text", content: "这一轮先确认几件事。" }],
      },
      {
        id: "msg-ch-a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [{ type: "text", content: "好的，我把候选项列出来。" }],
      },
    ],
  });
}

async function openQuestion(
  viewport: { width: number; height: number },
  confirmationId: string,
) {
  await page.viewport(viewport.width, viewport.height);
  renderDesktop();
  seedConversation();
  sendCommand("showConfirmation", {
    confirmationId,
    toolName: ASK_USER_QUESTION_TOOL_NAME,
    confirmationType: "需要确认",
    toolInput: { questions: manyQuestions },
  });
  // 卡片高度跟内容走：等它真的量到高度再读（不再用固定的 sleep）。
  await expect
    .poll(() =>
      Math.round(
        document
          .querySelector(".confirmation-dialog-inner")!
          .getBoundingClientRect().height,
      ),
    )
    .toBeGreaterThan(0);
}

function measure() {
  const box = (selector: string) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      visible: el.offsetParent !== null && rect.height > 0,
    };
  };
  const list = document.querySelector(".options-list") as HTMLElement;
  const listBox = list.getBoundingClientRect();
  return {
    viewportHeight: window.innerHeight,
    card: box(".confirmation-dialog-inner"),
    body: box(".confirmation-body"),
    list: box(".options-list"),
    nav: box(".question-navigation"),
    // 每个选项行是否完整落在列表盒内（半行裁切就是 row.bottom 越过 list.bottom）
    optionsFullyVisible: [...document.querySelectorAll(".option-item")].map(
      (el) => {
        const rect = el.getBoundingClientRect();
        return rect.bottom <= listBox.bottom + 1 && rect.top >= listBox.top - 1;
      },
    ),
  };
}

describe("提问卡片高度跟内容", () => {
  it("长过旧 560px 封顶，一次显示全部选项", async () => {
    await openQuestion(TALL, "card-height-tall");

    const sizes = measure();
    expect(sizes.card).not.toBeNull();
    // 封顶真的没了：内容需要的高度超过旧上限，卡片就长到超过它。
    expect(sizes.card!.height).toBeGreaterThan(OLD_CAP + 40);
    // 卡片里没有第二个滚动框（内容全部铺开），卡片本身也不溢出。
    expect(sizes.card!.scrollHeight).toBeLessThanOrEqual(
      sizes.card!.clientHeight + 1,
    );
    expect(sizes.list!.scrollHeight).toBeLessThanOrEqual(
      sizes.list!.clientHeight + 1,
    );
    // 8 个选项 +「其他」一次全见，一个都没被裁。
    expect(sizes.optionsFullyVisible).toHaveLength(9);
    expect(sizes.optionsFullyVisible.every(Boolean)).toBe(true);
  });

  it("面板变矮时卡片收缩，改由主体内部滚", async () => {
    await openQuestion(SHORT, "card-height-short");

    const sizes = measure();
    // 卡片收在面板内（不顶出视口），高度由可用高度而不是内容决定。
    expect(sizes.card!.bottom).toBeLessThanOrEqual(sizes.viewportHeight + 1);
    expect(sizes.card!.height).toBeLessThan(OLD_CAP);
    // 底部按钮栏与卡头都还在屏上可点。
    expect(sizes.nav!.visible).toBe(true);
    expect(sizes.nav!.bottom).toBeLessThanOrEqual(sizes.card!.bottom + 1);
    // 主体内部滚：选项区这一支是滚动容器（题干 / 进度条 / 按钮栏都不动），
    // 滚到底能看到最后一个选项。
    expect(sizes.list!.scrollHeight).toBeGreaterThan(sizes.list!.clientHeight);
    const list = document.querySelector(".options-list") as HTMLElement;
    list.scrollTop = list.scrollHeight;
    const items = document.querySelectorAll(".option-item");
    const last = items[items.length - 1].getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    expect(
      last.bottom <= listBox.bottom + 1 && last.top >= listBox.top - 1,
    ).toBe(true);
  });

  it("其余确认类型仍是通用卡（封顶留在身上）", async () => {
    await page.viewport(TALL.width, TALL.height);
    renderDesktop();
    sendCommand("showConfirmation", {
      confirmationId: "card-height-bash",
      confirmationType: "命令执行待确认",
      toolName: BASH_TOOL_NAME,
      toolInput: {
        command: "pnpm -F wave-agent-sdk test -- --run",
        description: "运行 SDK 测试",
      },
    });
    await expect
      .poll(
        () =>
          document
            .querySelector(".confirmation-dialog-inner")
            ?.getBoundingClientRect().height ?? 0,
      )
      .toBeGreaterThan(0);

    const card = (() => {
      const el = document.querySelector(
        ".confirmation-dialog-inner",
      ) as HTMLElement;
      return {
        height: el.getBoundingClientRect().height,
        isAskUser: el.classList.contains("is-ask-user"),
        maxHeight: getComputedStyle(el).maxHeight,
      };
    })();

    // 没有问句卡那个「不限高」标记，封顶留在身上
    //（900px 高的视口里 min(70vh, 560px) 解出来就是 560px）。
    expect(card.isAskUser).toBe(false);
    expect(card.maxHeight).toBe("560px");
    expect(card.height).toBeLessThan(OLD_CAP + 1);
  });
});
