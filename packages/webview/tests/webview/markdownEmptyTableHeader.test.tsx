import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { MockDataGenerator } from "../fixtures/mockData";

// Mermaid 与这些断言无关，按 markdownSanitize / desktopTabStopGating 的同一手法挡掉。
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

// 用户 2026-11-12 反馈「表格有时会出现没有表头，但是背景被渲染出来的情况」：
// `| | |` 是合法 GFM（键值对两列表格），marked 照样输出 <thead><tr><th></th>；
// 桌面端 th 带 --cc-fill 底色 + 8/12 内衬 ⇒ 表格顶部多一条 17px 的空高亮带。
// 修法见 Message.tsx isEmptyTableHeader：表头单元格纯文本全空且无可见元素时，
// 整段 thead 丢掉。下面把四条边界钉住。
const renderMarkdown = (markdown: string) =>
  render(
    <Message
      message={MockDataGenerator.createAssistantMessage(markdown)}
      vscode={{ postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() }}
    />,
  );

describe("Markdown 表格：空表头不渲染 thead", () => {
  it("表头单元格全部为空：整段 thead 丢掉，表格与滚动包裹层仍在", () => {
    const { container } = renderMarkdown(
      [
        "| | |",
        "| --- | --- |",
        "| 分支 | `main` |",
        "| HEAD | `abc1234` |",
      ].join("\n"),
    );

    expect(container.querySelector(".md-table-scroll")).not.toBeNull();
    expect(container.querySelector(".md-table-scroll table")).not.toBeNull();
    expect(container.querySelector("thead")).toBeNull();
    // 数据行照常渲染，不能连带把内容丢掉
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("分支");
  });

  it("有表头：thead 与列头文字原样保留", () => {
    const { container } = renderMarkdown(
      ["| 组件 | 说明 |", "| --- | --- |", "| FilePane | 目录树 |"].join("\n"),
    );

    const thead = container.querySelector("thead");
    expect(thead).not.toBeNull();
    // marked 输出里带换行，比文本前先归一空白
    expect(thead?.textContent?.replace(/\s+/g, "")).toBe("组件说明");
  });

  it("部分列头为空：保留 thead（有内容的列头不能丢）", () => {
    const { container } = renderMarkdown(
      ["| 项 | |", "| --- | --- |", "| 类型 | warning |"].join("\n"),
    );

    expect(container.querySelector("thead")).not.toBeNull();
    expect(container.querySelector("thead")?.textContent).toContain("项");
  });

  it("表头写 &nbsp;（想留白）：同样丢掉 thead，不再把字面 &nbsp; 当列名", () => {
    const { container } = renderMarkdown(
      ["| &nbsp; | &nbsp; |", "| --- | --- |", "| 分支 | `main` |"].join("\n"),
    );

    // marked 把 & 再转义一次（&amp;nbsp;），只解一轮会剩下字面 "&nbsp;" 被当列名
    expect(container.querySelector("thead")).toBeNull();
    expect(container.textContent).not.toContain("nbsp");
  });

  it("列头是图片（纯文本为空但有可见元素）：保留 thead", () => {
    const { container } = renderMarkdown(
      ["| ![badge](badge.svg) | 说明 |", "| --- | --- |", "| A | x |"].join(
        "\n",
      ),
    );

    // 判定发生在 renderer 阶段（清洗之前），此时 th 里是 <img>；清洗层会不会
    // 留下 img 不归这条断言管，要钉的是「有可见元素的列头不被当成空表头」。
    const thead = container.querySelector("thead");
    expect(thead).not.toBeNull();
    expect(thead?.textContent?.replace(/\s+/g, "")).toContain("说明");
  });
});
