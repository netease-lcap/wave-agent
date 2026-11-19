import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import path from "node:path";
import { renderDraftContent } from "../../src/utils/inputDraft";
import { serializeInputDraft } from "../../src/utils/messageUtils";

/**
 * 输入框草稿的往返：草稿字符串（宿主的 inputDrafts）→ 输入框 DOM → 草稿字符串。
 *
 * 缺陷 3503216687855872：草稿曾以 `innerText` 上报，标签只剩可见文字
 * （`@logo.png`），返回对话窗口后引用退化成纯文本、发出去不再按引用处理。
 */
const chipPaths = (el: HTMLElement): (string | null)[] =>
  Array.from(el.querySelectorAll(".context-tag-container")).map((tag) =>
    tag.getAttribute("data-path"),
  );

/** 按输入框里真实的标签结构造一个引用标签。 */
function fileChip(filePath: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "context-tag-container";
  chip.contentEditable = "false";
  chip.setAttribute("data-path", filePath);
  chip.setAttribute("data-name", path.basename(filePath));
  chip.setAttribute("data-is-image", "false");
  chip.textContent = `[@file:${filePath}]`;
  return chip;
}

describe("输入框草稿的序列化与还原", () => {
  const uploaded = path.join("/work", "a", "assets", "logo.png");

  it("文件引用标签序列化成标记文本，不再是标签的可见文字", () => {
    const input = document.createElement("div");
    input.append(fileChip(uploaded), document.createTextNode(" 这是什么图片"));

    expect(serializeInputDraft(input)).toBe(`[@file:${uploaded}] 这是什么图片`);
  });

  it("还原后的草稿仍是引用标签，正文里不残留标记语法", async () => {
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, `[@file:${uploaded}] 这是什么图片`);
    });

    expect(chipPaths(input)).toEqual([uploaded]);
    expect(input.textContent).not.toContain("[@file:");
    // 再序列化一次仍是同一个标记（往返稳定）
    expect(serializeInputDraft(input)).toBe(`[@file:${uploaded}] 这是什么图片`);
  });

  it("多行草稿的换行与尾部空格原样保留", async () => {
    const draft = `第一行\n[@file:${uploaded}]\n第三行 `;
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, draft);
    });

    expect(serializeInputDraft(input)).toBe(draft);
  });

  it("选区引用还原成带行号的标签", async () => {
    const file = path.join("/work", "a", "src", "order.ts");
    const draft = `[Selection: ${file}|order.ts#3-9] 这段做什么`;
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, draft);
    });

    expect(chipPaths(input)).toEqual([file]);
    expect(serializeInputDraft(input)).toBe(draft);
  });

  it("IDE 上下文标记还原成标签（内容仍在发送时取）", async () => {
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, "[@ide:terminal] 看下这个报错");
    });

    expect(chipPaths(input)).toEqual(["ide:terminal"]);
    expect(input.querySelector('[data-ide-context="terminal"]')).toBeTruthy();
    expect(serializeInputDraft(input)).toBe("[@ide:terminal] 看下这个报错");
  });

  it("粘贴图片的占位按文本保留（草稿字符串里没有图片数据）", async () => {
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, "[image1] 这张图是什么");
    });

    expect(chipPaths(input)).toEqual([]);
    expect(input.textContent).toContain("[image1]");
  });

  it("空草稿清空输入框", async () => {
    const input = document.createElement("div");
    input.append(fileChip(uploaded));
    await act(async () => {
      renderDraftContent(input, "");
    });

    expect(input.childNodes).toHaveLength(0);
  });
});

/**
 * 回滚回填的图片（spec commands/rewind-command.md 场景 10、
 * ui/image-pasting.md「草稿里的图片」场景 6）：`[imageN]` 的字节从来不在草稿
 * 字符串里，回填时由调用方把**被回滚那条消息**的图片块当一次性字节表传进来。
 * 拿不到字节就还是老行为（纯文本占位）。
 */
describe("回滚回填：给了字节就是真图片标签", () => {
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const imageChips = (el: HTMLElement): HTMLElement[] =>
    Array.from(
      el.querySelectorAll<HTMLElement>(
        '.context-tag-container[data-is-image="true"]',
      ),
    );

  it("按 [imageN] 的位置还原成可点开预览的图片标签", async () => {
    const onImageClick = vi.fn();
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, "这张图是什么 [image1]", {
        onImageClick,
        images: [PNG],
      });
    });

    const chips = imageChips(input);
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute("data-image-url")).toBe(PNG);
    // 占位文本不再以纯文本残留在正文里
    expect(input.textContent).not.toContain("[image1]");

    const tag = chips[0].querySelector<HTMLElement>(".context-tag");
    expect(tag?.className).toMatch(/clickable/);
    await act(async () => {
      fireEvent.click(tag!);
    });
    expect(onImageClick).toHaveBeenCalledWith(PNG, "图片 1");
  });

  it("字节表按位置对位：没有字节的那一张仍是占位文本", async () => {
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, "[image1] 和 [image2]", { images: [PNG] });
    });

    expect(imageChips(input)).toHaveLength(1);
    expect(input.textContent).toContain("[image2]");
    expect(input.textContent).not.toContain("[image1]");
  });

  it("回填后再序列化：字节登记进本地存储，草稿写成 [@image:<id>]", async () => {
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, "看图 [image1]", { images: [PNG] });
    });

    expect(serializeInputDraft(input, "session:s1")).toMatch(
      /^看图 \[@image:dimg-/,
    );
  });

  it("没有字节表时保持现状（不在草稿字符串里塞数据）", async () => {
    const input = document.createElement("div");
    await act(async () => {
      renderDraftContent(input, "[image1] 这张图是什么", { images: [] });
    });

    expect(imageChips(input)).toEqual([]);
    expect(input.textContent).toContain("[image1]");
  });
});
