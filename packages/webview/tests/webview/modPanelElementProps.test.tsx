import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ModPanelRenderer } from "../../src/components/ModPanelRenderer";
import type { ModPanelTree, ModTreeNode } from "wave-agent-sdk/types";

/**
 * 元素 prop 落到 CSS 上的口径（spec `ecosystem/plugin-mods.md`「元素」）。
 *
 * 这里断言的是**换算结果**（主题键 → 宿主变量、`paddingX` → 左右内边距、
 * `weight` → 字重、悬停作用域 → 指针进出），不是「元素存在」：这些 prop 的
 * 全部意义就在于算出来的那个值，元素本身一直都在。
 */

function renderTree(tree: ModPanelTree, onEvent = vi.fn()) {
  return {
    ...render(<ModPanelRenderer tree={tree} onEvent={onEvent} />),
    onEvent,
  };
}

/**
 * `hover` 是**节点的独立字段**（`h()` 会把它从 props 里提出来，校验器按这个
 * 形状规范化），所以这里也从 props 里摘出来放上去 —— 照着 props 里塞一个
 * `hover` 对象写测试，测的就不是线上那条路了。
 */
function box(
  props: ModTreeNode["props"],
  children: Array<ModTreeNode | string> = [],
  hover?: Record<string, string | number | boolean>,
): ModTreeNode {
  return { type: "Box", props, ...(hover ? { hover } : {}), children };
}

describe("mod 元素的视觉与布局 prop", () => {
  it("主题色名换成宿主的 CSS 变量，写死的颜色原样保留", () => {
    const { container } = renderTree(
      box({ flexDirection: "column" }, [
        { type: "Text", props: { color: "error" }, children: ["错了"] },
        { type: "Text", props: { color: "#ff0000" }, children: ["红"] },
      ]),
    );
    const [tokenText, rawText] = Array.from(container.querySelectorAll("span"));

    // 主题色名不是 CSS 颜色，直接塞进样式会被浏览器整条丢掉。
    expect(tokenText?.style.color).toBe("var(--cc-color-danger, #c62828)");
    expect(rawText?.style.color).toBe("rgb(255, 0, 0)");
  });

  it("Box 的轴间距展开成左右 / 上下，单边后写覆盖", () => {
    const { container } = renderTree(
      box({
        paddingX: "sm",
        paddingY: 2,
        marginX: 4,
        paddingTop: 9,
        minHeight: 24,
        backgroundColor: "success",
        borderStyle: "round",
        borderColor: "promptBorder",
      }),
    );
    const style = (
      container.querySelector(".mod-panel-root > div") as HTMLElement
    ).style;

    expect(style.paddingLeft).toBe("8px");
    expect(style.paddingRight).toBe("8px");
    expect(style.paddingTop).toBe("9px");
    expect(style.paddingBottom).toBe("2px");
    expect(style.marginLeft).toBe("4px");
    expect(style.minHeight).toBe("24px");
    expect(style.background).toContain("--cc-color-success");
    expect(style.border).toContain("--cc-border");
  });

  it("Text 的字重 / 字号 / 删除线 / 反显", () => {
    const { container } = renderTree(
      box({}, [
        {
          type: "Text",
          props: {
            weight: "semibold",
            size: "footnote",
            strikethrough: true,
            underline: true,
          },
          children: ["x"],
        },
        {
          type: "Text",
          props: { inverse: true, color: "claude" },
          children: ["y"],
        },
      ]),
    );
    const [first, second] = Array.from(container.querySelectorAll("span"));

    expect(first?.style.fontWeight).toBe("600");
    expect(first?.style.fontSize).toBe("12px");
    expect(first?.style.textDecoration).toContain("line-through");
    expect(first?.style.textDecoration).toContain("underline");
    // 反显：字色与底色对调。
    expect(second?.style.background).toContain("--cc-action-primary");
    expect(second?.style.color).toContain("--cc-bg-panel");
  });

  it("Button 的 plain / autoFocus", () => {
    const { container } = renderTree(
      box({}, [
        {
          type: "Button",
          props: { key: "b1", label: "开", plain: true, autoFocus: true },
          children: [],
        },
      ]),
    );
    const button = container.querySelector("button");

    expect(button?.className).toContain("mod-button-plain");
    expect(button?.querySelector("span")?.textContent).toBe("开");
    expect(document.activeElement).toBe(button);
  });

  it("Input 的 rows 换成多行输入框，回车照样提交、Shift+Enter 换行", async () => {
    const user = userEvent.setup();
    const { container, onEvent } = renderTree(
      box({}, [{ type: "Input", props: { key: "i1", rows: 3 }, children: [] }]),
    );
    const textarea = container.querySelector("textarea");

    expect(textarea).not.toBeNull();
    expect(textarea?.rows).toBe(3);

    await user.click(textarea as HTMLTextAreaElement);
    await user.keyboard("第一行");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("第二行");
    // Shift+Enter 是换行，不该提交。
    expect(onEvent).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onEvent).toHaveBeenCalledWith("input", "i1", "第一行\n第二行");
  });

  it("Code 的 wrap 与 truncate-end", () => {
    const { container } = renderTree(
      box({ flexDirection: "column" }, [
        { type: "Code", props: { source: "a\nb", wrap: "wrap" }, children: [] },
        {
          type: "Code",
          props: { source: "c", wrap: "truncate-end" },
          children: [],
        },
      ]),
    );
    const [wrapped, truncated] = Array.from(
      container.querySelectorAll(".mod-panel-code"),
    );

    expect((wrapped as HTMLElement).style.whiteSpace).toBe("pre-wrap");
    expect((truncated as HTMLElement).style.whiteSpace).toBe("nowrap");
    expect((truncated as HTMLElement).style.textOverflow).toBe("ellipsis");
  });

  it("hover 跟着最近的带 key 的 Box 走：指针进去变色，出来还原", async () => {
    const user = userEvent.setup();
    const { container } = renderTree(
      box({ key: "row" }, [
        {
          type: "Text",
          props: { color: "text" },
          hover: { color: "success", bold: true },
          children: ["已完成"],
        },
      ]),
    );
    const row = container.querySelector(".mod-panel-root > div") as HTMLElement;
    const label = row.querySelector("span") as HTMLElement;
    const base = label.style.color;

    await user.hover(row);
    expect(label.style.color).toBe("var(--cc-color-success, #2e7d32)");
    expect(label.style.fontWeight).toBe("600");

    await user.unhover(row);
    expect(label.style.color).toBe(base);
    expect(label.style.fontWeight).toBe("");
  });

  it("同一个作用域里各元素用各自的 hover，键不会串到别人身上", async () => {
    const user = userEvent.setup();
    const { container } = renderTree(
      box(
        { key: "row", columnGap: 8 },
        [
          {
            type: "Button",
            props: { key: "b1", label: "开", dimColor: true },
            hover: { color: "error" },
            children: [],
          },
        ],
        { backgroundColor: "suggestion" },
      ),
    );
    const row = container.querySelector(".mod-panel-root > div") as HTMLElement;
    const label = row.querySelector("button span") as HTMLElement;

    // 静止时 `dimColor` 调暗。
    expect(label.style.opacity).toBe("0.65");

    // 指针在这行里：`Box` 的 hover 染底，`Button` 的 hover 只染它自己的字，
    // 同时 `dimColor` 恢复全强度（悬停上去还半透明就看不出被指着）。
    // 作用域模型是「最近的带 key 的 Box」（spec「元素」），所以按钮的悬停态
    // 跟着整行走 —— 想只跟按钮走得给它自己写 `hover.scope`。
    await user.hover(row);
    expect(row.style.background).toContain("--cc-text-link");
    expect(label.style.color).toBe("var(--cc-color-danger, #c62828)");
    expect(label.style.opacity).toBe("");
    // Box 的 `backgroundColor` 不该贴到按钮的字上。
    expect(label.style.background).toBe("");
  });

  it("hover.scope 能指到行外的作用域（卡片跟着行内元素一起亮）", async () => {
    const user = userEvent.setup();
    const { container } = renderTree(
      box(
        { key: "card", borderStyle: "round" },
        [
          box({}, [
            {
              type: "Text",
              props: {},
              hover: { scope: "card", color: "error" },
              children: ["行里的字"],
            },
          ]),
        ],
        { borderColor: "success" },
      ),
    );
    const card = container.querySelector(
      ".mod-panel-root > div",
    ) as HTMLElement;
    const label = card.querySelector("span") as HTMLElement;

    // 指到 card 的边框上：显式命名的 scope 也亮。
    await user.hover(card);
    expect(label.style.color).toBe("var(--cc-color-danger, #c62828)");
    expect(card.style.border).toContain("--cc-color-success");
  });

  it("文本节点与未知元素照旧", () => {
    renderTree(box({}, ["纯文本"]));

    expect(screen.getByTestId("mod-panel-root").textContent).toBe("纯文本");
  });
});
