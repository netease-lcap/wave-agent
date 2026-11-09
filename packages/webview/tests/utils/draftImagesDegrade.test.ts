import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderDraftContent } from "../../src/utils/inputDraft";
import { serializeInputDraft } from "../../src/utils/messageUtils";
import { draftImageScopeKey } from "../../src/utils/draftImageStore";

/**
 * 草稿图片在「本地存储用不了」时的降级（spec ui/image-pasting.md 场景 5）：
 * 隐私模式、配额满、宿主环境没有 IndexedDB 时，粘贴与发送照常，只是图片不进
 * 持久化草稿——不能抛错、不能卡住输入。
 *
 * 真浏览器是自带 IndexedDB 的，所以这里把它摘掉来复现「存储打不开」：不引入
 * fake-indexeddb，正是因为要的就是「一个能用的存储都没有」这条路径（真实 IDB
 * 往返见 draftImages.test.ts）。必须在模块顶层摘——openDb 的句柄是模块级缓存，
 * 第一个用例打开过之后就没法再假装它不存在了。
 */
vi.stubGlobal("indexedDB", undefined);

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const imageChip = (): HTMLElement => {
  const chip = document.createElement("span");
  chip.className = "context-tag-container";
  chip.setAttribute("data-path", "pasted-image-1.png");
  chip.setAttribute("data-name", "图片 1");
  chip.setAttribute("data-is-image", "true");
  chip.setAttribute("data-image-url", PNG);
  chip.textContent = "图片 1";
  return chip;
};

describe("本地存储不可用时的草稿图片", () => {
  it("序列化照常给出图片标记，不抛出", () => {
    const input = document.createElement("div");
    document.body.appendChild(input);
    const chip = imageChip();
    input.append(chip, document.createTextNode(" 看看这个"));

    const draft = serializeInputDraft(input, draftImageScopeKey("s-1", "p"));

    expect(draft).toBe(
      `[@image:${chip.getAttribute("data-draft-image-id")}] 看看这个`,
    );
  });

  it("回填时取不到字节，只留占位文本让用户能继续改", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      renderDraftContent(container, "[@image:dimg-gone] 看看这个", {
        scopeKey: draftImageScopeKey("s-2", "p"),
      });
    });

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(
          '.context-tag-container[data-is-image="true"]',
        ),
      ).toHaveLength(0);
      expect(container.textContent).toBe("[image] 看看这个");
    });
  });
});
