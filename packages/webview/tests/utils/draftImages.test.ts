import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderDraftContent } from "../../src/utils/inputDraft";
import { serializeInputDraft } from "../../src/utils/messageUtils";
import {
  MAX_DRAFT_IMAGES_PER_SCOPE,
  clearDraftImages,
  draftImageScopeKey,
  loadDraftImages,
  saveDraftImages,
  type DraftImageRecord,
} from "../../src/utils/draftImageStore";

/**
 * 草稿里的粘贴图片（spec ui/image-pasting.md「用户故事：草稿里的图片」）。
 *
 * 图片字节不在宿主保存的草稿字符串里（那段文本每次按键上报一次），而是按会话
 * 存在 webview 侧的 IndexedDB，草稿里只留 `[@image:<id>]` 标记。这组用例覆盖：
 * 标记形态、按会话隔离、从存储取回、取不到时降级、单会话上限。
 *
 * jsdom 没有 IndexedDB，这里用 fake-indexeddb 提供真实 IDB 语义（另一个文件
 * draftImagesDegrade.test.ts 覆盖「拿不到 IndexedDB」的降级路径）。
 */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const OTHER_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==AAAA";

const makeInput = (): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
};

/** 按输入框里真实的图片标签结构造一个标签（粘贴图片就是这个形态）。 */
function imageChip(name = "图片 1", dataUrl = PNG): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "context-tag-container";
  chip.contentEditable = "false";
  chip.setAttribute("data-path", "pasted-image-1.png");
  chip.setAttribute("data-name", name);
  chip.setAttribute("data-is-image", "true");
  chip.setAttribute("data-image-url", dataUrl);
  chip.textContent = name;
  return chip;
}

const imageChips = (el: HTMLElement): HTMLElement[] =>
  Array.from(
    el.querySelectorAll<HTMLElement>(
      '.context-tag-container[data-is-image="true"]',
    ),
  );

const record = (scopeKey: string, index: number): DraftImageRecord => ({
  key: `${scopeKey}:dimg-${index}`,
  scopeKey,
  id: `dimg-${index}`,
  dataUrl: PNG,
  mimeType: "image/png",
  filename: `图片 ${index + 1}`,
  createdAt: 1_700_000_000_000 + index,
});

/**
 * 等这一次序列化真落进存储。真机里图片字节在按键时就开始写、到视图切换后
 * 才回填，中间隔着一次页面卸载；这组用例不等就会读到半路（空）状态。
 */
const waitStored = (scopeKey: string, count: number): Promise<unknown> =>
  vi.waitFor(async () => {
    expect((await loadDraftImages(scopeKey)).size).toBe(count);
  });

describe("草稿里的粘贴图片", () => {
  it("草稿里留 [@image:id] 标记，而不是会退化成文本的 [image1]", () => {
    const input = makeInput();
    const chip = imageChip();
    input.append(chip, document.createTextNode(" 这是什么"));

    const scope = draftImageScopeKey("s-image", "pane-1");
    const draft = serializeInputDraft(input, scope);

    const id = chip.getAttribute("data-draft-image-id");
    expect(id).toBeTruthy();
    expect(draft).toBe(`[@image:${id}] 这是什么`);
  });

  it("重新挂载时按 id 从本地存储取回图片，标签可点开预览", async () => {
    const scope = draftImageScopeKey("s-roundtrip", "pane-1");
    const input = makeInput();
    input.append(imageChip("这是截图"));
    const draft = serializeInputDraft(input, scope);
    await waitStored(scope, 1);

    const onImageClick = vi.fn();
    const restored = makeInput();
    await act(async () => {
      renderDraftContent(restored, draft, { scopeKey: scope, onImageClick });
    });

    const chip = await vi.waitFor(() => {
      const [el] = imageChips(restored);
      expect(el?.getAttribute("data-image-url")).toBe(PNG);
      return el;
    });
    expect(chip.getAttribute("data-name")).toBe("这是截图");

    const tag = await vi.waitFor(() => {
      const el = chip.querySelector<HTMLElement>(".context-tag");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await act(async () => {
      tag.click();
    });
    expect(onImageClick).toHaveBeenCalledWith(PNG, "这是截图");
  });

  it("按会话隔离：别的会话回填不出本会话的图片", async () => {
    const scope = draftImageScopeKey("s-owner", "pane-1");
    const input = makeInput();
    input.append(imageChip());
    const draft = serializeInputDraft(input, scope);
    await waitStored(scope, 1);

    const otherScope = draftImageScopeKey("s-other", "pane-1");
    const restored = makeInput();
    await act(async () => {
      renderDraftContent(restored, draft, { scopeKey: otherScope });
    });

    await vi.waitFor(() => {
      expect(imageChips(restored)).toHaveLength(0);
      expect(restored.textContent).toBe("[image]");
    });
  });

  it("存储里找不到这份图片时只留占位文本，不阻塞发送", async () => {
    const scope = draftImageScopeKey("s-missing", "pane-1");
    const restored = makeInput();
    await act(async () => {
      renderDraftContent(restored, "[@image:dimg-ghost]", { scopeKey: scope });
    });

    await vi.waitFor(() => {
      expect(imageChips(restored)).toHaveLength(0);
      expect(restored.textContent).toBe("[image]");
    });
  });

  it("单会话图片数有上限，超出按最旧淘汰", async () => {
    const scope = draftImageScopeKey("s-cap", "pane-1");
    const records = Array.from(
      { length: MAX_DRAFT_IMAGES_PER_SCOPE + 3 },
      (_, index) => record(scope, index),
    );

    await saveDraftImages(scope, records);
    const stored = await loadDraftImages(scope);

    expect(stored.size).toBe(MAX_DRAFT_IMAGES_PER_SCOPE);
    expect(stored.has("dimg-0")).toBe(false);
    expect(stored.has("dimg-2")).toBe(false);
    expect(stored.has(`dimg-${MAX_DRAFT_IMAGES_PER_SCOPE + 2}`)).toBe(true);
  });

  it("再次保存时只保留这次草稿里的图片：删掉的图不再回填", async () => {
    const scope = draftImageScopeKey("s-prune", "pane-1");
    await saveDraftImages(scope, [record(scope, 0), record(scope, 1)]);

    await saveDraftImages(scope, [record(scope, 1)]);
    const stored = await loadDraftImages(scope);

    expect([...stored.keys()]).toEqual(["dimg-1"]);
  });

  it("清空草稿时把该会话的图片一起清掉", async () => {
    const scope = draftImageScopeKey("s-clear", "pane-1");
    await saveDraftImages(scope, [record(scope, 0)]);

    await clearDraftImages(scope);

    expect((await loadDraftImages(scope)).size).toBe(0);
  });

  it("多张图片按出现顺序各自拿到 id，回填顺序不变", async () => {
    const scope = draftImageScopeKey("s-multi", "pane-1");
    const input = makeInput();
    input.append(
      imageChip("图片 1", PNG),
      document.createTextNode(" 中间"),
      imageChip("图片 2", OTHER_PNG),
    );
    const draft = serializeInputDraft(input, scope);
    await waitStored(scope, 2);

    const ids = [...draft.matchAll(/\[@image:([\w-]+)\]/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    const restored = makeInput();
    await act(async () => {
      renderDraftContent(restored, draft, { scopeKey: scope });
    });

    await vi.waitFor(() => {
      const chips = imageChips(restored);
      expect(chips.map((el) => el.getAttribute("data-image-url"))).toEqual([
        PNG,
        OTHER_PNG,
      ]);
    });
    expect(serializeInputDraft(restored, scope)).toBe(draft);
  });
});
