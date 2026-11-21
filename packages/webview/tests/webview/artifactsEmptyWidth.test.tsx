/**
 * 创作集（`.artifacts-content`）的宽度只该由父级决定，不该由「有没有列表」决定。
 *
 * 线上现象（设计师截图）：空态下整页内容列明显变窄、整体右移居中 ——「创作集」标题
 * 的左边距从 276 变成 375 左右，分类 tab 行、搜索框跟着一起收。根因是内容列靠
 * `margin-inline: auto` 居中，而**交叉轴上的 auto margin 会让这条 flex 子项不再吃
 * 父级的 `align-items: stretch`**（CSS Flexbox §8.1/§9.5），宽度退化成 fit-content：
 * 有列表时被宽表格撑满，表格不渲染（空态 / 加载 / 出错 / 未登录）时就只剩页头那行
 * 文字的宽度。修法是给内容列一个确定的 `width: 100%`（宽于 1280 时仍由 max-width
 * 截断、由 auto margin 居中）。
 *
 * 迁移自 `e2e/artifacts-empty-width.e2e.ts`：那边原来写「jsdom 量不出几何，所以
 * 落在真 Chromium 里」，而本套件就跑在真 Chromium 里 —— 同一窗口下「有列表」与
 * 「空态」的内容列 / 页头 / tab 行必须逐像素同框。两种窗口宽度都测：窄于此前
 * 的 1280 上限（按父级铺满）与宽于它（被 max-width 截断并居中）。
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { page } from "vitest/browser";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";
import "../../src/styles/globals.css";
import "../../src/styles/host-desktop.css";

const DIR_A = "/work/a";

type Vscode = ReturnType<typeof createMockVscode>;

async function openArtifacts(width: number) {
  await page.viewport(width, 900);
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  // 一条一条发：`desktopWorkdirState` 挂出 ChatApp（输入区/整页都在它里面），
  // 下一条才落得到它的监听上。
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    permissionMode: "default",
  });
  (
    document.querySelector('[data-testid="desktop-artifacts"]') as HTMLElement
  ).click();
  return vscode;
}

const lastRequestId = (vscode: Vscode, command: string) => {
  const call = [...vscode.postMessage.mock.calls]
    .reverse()
    .find(([msg]) => (msg as { command?: string }).command === command);
  return (call?.[0] as { requestId?: string } | undefined)?.requestId;
};

/** 答掉页面的列表 / 分类两个请求（requestId 取自页面刚发出的那两条）。 */
function replyList(vscode: Vscode, items: Record<string, unknown>[]) {
  const categoryRequestId = lastRequestId(
    vscode,
    "desktopArtifactCategoriesGet",
  );
  if (categoryRequestId) {
    sendCommand("desktopArtifactCategories", {
      requestId: categoryRequestId,
      categories: [],
      assignments: {},
    });
  }
  // 没有新的请求时沿用上一次的 requestId：页面对「同一个 request」的第二次回包
  // 照收（它只判断 requestId 还是不是当前那一个）——这正是空态切到有列表的路。
  sendCommand("desktopArtifactsList", {
    requestId: lastRequestId(vscode, "desktopArtifactsList"),
    items,
  });
}

const oneItem = {
  slug: "account-card",
  title: "账户卡片",
  rel: "mine",
  ownerEmail: "me@corp.com",
  publishedAt: "2026-11-12T11:00:00.000Z",
  shareScope: "enterprise",
};

const rectOf = (selector: string) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: Math.round(rect.x), width: Math.round(rect.width) };
};

const layout = () => ({
  content: rectOf(".artifacts-content"),
  header: rectOf(".artifacts-page-header"),
  tabs: rectOf(".artifacts-tabs-row"),
});

for (const width of [1440, 1600]) {
  describe(`创作集空态与列表同宽同起点（窗口 ${width}）`, () => {
    it("内容列 / 页头 / tab 行在两种状态下逐像素同框", async () => {
      const vscode = await openArtifacts(width);

      replyList(vscode, []);
      await expect
        .poll(() => !!document.querySelector('[data-testid="artifacts-empty"]'))
        .toBe(true);
      const empty = layout();

      replyList(vscode, [oneItem]);
      await expect
        .poll(() => !!document.querySelector('[data-testid="artifacts-table"]'))
        .toBe(true);
      const list = layout();

      expect(empty).toEqual(list);
      // 内容列确实铺到了父级（窄窗口）或被 1280 截断（宽窗口），不是哪段文字的宽度。
      expect(empty.content?.width).toBeGreaterThan(800);
    });
  });
}
