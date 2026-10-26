import { createElement } from "react";
import ReactDOM from "react-dom/client";
import type { IdeContextProvider } from "wave-webview-fixtures";
import { ContextTag } from "../components/ContextTag";
import { loadDraftImages } from "./draftImageStore";
import {
  IDE_CONTEXT_BLOCK_END,
  ideContextMarker,
  ideContextProviderInfo,
} from "./ideContext";
import { parseMentions } from "./messageUtils";

/**
 * 输入框草稿的「字符串 → 输入框 DOM」还原。
 *
 * 草稿以 markdown 形式存在宿主的 `inputDrafts` 里（见 `serializeInputDraft`），
 * 其中的引用标签是标记文本：`[@file:path]`、`[Selection: path|name#1-2]`、
 * `[@ide:terminal]`、`[@image:<id>]`。重挂载时在这里把标记还原成
 * `context-tag-container` 标签，否则引用会退化成纯文本，发出时不再按引用处理
 * （缺陷 3503216687855872）。图片的字节不在草稿里，按 id 从本地存储取回
 * （spec ui/image-pasting.md「草稿里的图片」）。
 */

/** 文件引用标记的前缀（`[@file:/abs/path]`，上传附件与 @ 提及文件都是它）。 */
const FILE_MARKER_PREFIX = "[@file:";

/**
 * 正文里能还原成标签的标记：IDE 上下文（`[@ide:terminal]`）与草稿图片
 * （`[@image:<id>`）。两件事都发生在文本片段里，一次扫完，按出现顺序落标签。
 */
const CHIP_MARKER_PATTERN = /\[@ide:(terminal|problems)\]|\[@image:([\w-]+)\]/g;

const appendText = (container: HTMLElement, text: string): void => {
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(document.createElement("br"));
    if (line) container.appendChild(document.createTextNode(line));
  });
};

interface ChipSpec {
  path: string;
  /** 可见名称（选区标签带 `#行号-行号`，文件标签就是文件名）。 */
  name: string;
  /** `data-name`：序列化回标记时用的名字，选区是裸文件名。 */
  markerName?: string;
  isImage?: boolean;
  isSelection?: boolean;
  startLine?: string;
  endLine?: string;
  ideContext?: IdeContextProvider;
}

/**
 * 造一个与输入框里原有标签同形的 `<span class="context-tag-container">`：
 * `convertToMarkdown` 靠 `data-*` 还原标记，ContextTag 负责可见部分。
 */
const appendChip = (container: HTMLElement, spec: ChipSpec): void => {
  const {
    path,
    name,
    markerName,
    isImage,
    isSelection,
    startLine,
    endLine,
    ideContext,
  } = spec;
  const chip = document.createElement("span");
  chip.className = "context-tag-container";
  chip.contentEditable = "false";
  chip.setAttribute("data-path", path);
  chip.setAttribute("data-name", markerName ?? name);
  chip.setAttribute("data-is-image", String(!!isImage));
  if (isSelection) {
    chip.setAttribute("data-is-selection", "true");
    chip.setAttribute("data-start-line", startLine ?? "");
    chip.setAttribute("data-end-line", endLine ?? "");
  }
  if (ideContext) {
    chip.setAttribute("data-ide-context", ideContext);
    chip.innerText = ideContextMarker(ideContext);
  }

  ReactDOM.createRoot(chip).render(
    createElement(ContextTag, { name, path, isImage }),
  );
  container.appendChild(chip);
};

/** 草稿图片占位标签：字节要异步从本地存储取，先建空标签占住位置与顺序。 */
interface PendingDraftImage {
  chip: HTMLElement;
  id: string;
}

const appendDraftImageChip = (
  container: HTMLElement,
  id: string,
  pending: PendingDraftImage[],
): void => {
  const chip = document.createElement("span");
  chip.className = "context-tag-container";
  chip.contentEditable = "false";
  chip.setAttribute("data-is-image", "true");
  chip.setAttribute("data-draft-image-id", id);
  container.appendChild(chip);
  pending.push({ chip, id });
};

export interface RenderDraftOptions {
  /** 草稿图片存在哪个会话下（见 `draftImageScopeKey`）。 */
  scopeKey?: string;
  /** 点图片标签时的预览回调，与刚粘贴时那个预览一致。 */
  onImageClick?: (dataUrl: string, name: string) => void;
}

/**
 * 把本地存储里的图片填进占位标签。取不到（存储不可用 / 记录已被淘汰 / 换了
 * 会话）就把标签换成占位文本——宁可让用户看到一行 `[image]`，也不静默吞掉
 * 他看到过的东西。
 */
const hydrateDraftImages = (
  container: HTMLElement,
  pending: PendingDraftImage[],
  options: RenderDraftOptions,
): void => {
  if (pending.length === 0) return;
  const { scopeKey, onImageClick } = options;
  if (!scopeKey) {
    pending.forEach(({ chip }) =>
      chip.replaceWith(document.createTextNode("[image]")),
    );
    return;
  }

  void loadDraftImages(scopeKey).then((stored) => {
    for (const { chip, id } of pending) {
      // 回填之后输入框可能又被改写（切会话、宿主再推一次草稿）：别往孤儿节点灌。
      if (!container.contains(chip)) continue;
      const record = stored.get(id);
      if (!record) {
        chip.replaceWith(document.createTextNode("[image]"));
        continue;
      }
      const name = record.filename || "图片";
      const path = `pasted-image-${id}.png`;
      chip.setAttribute("data-path", path);
      chip.setAttribute("data-name", name);
      chip.setAttribute("data-image-url", record.dataUrl);
      ReactDOM.createRoot(chip).render(
        createElement(ContextTag, {
          name,
          path,
          isImage: true,
          onClick: onImageClick
            ? () => onImageClick(record.dataUrl, name)
            : undefined,
        }),
      );
    }
  });
};

/** 文本片段里可能夹着 IDE 上下文标记或草稿图片标记，分别还原成标签。 */
const appendTextWithMarkers = (
  container: HTMLElement,
  text: string,
  pending: PendingDraftImage[],
): void => {
  let lastIndex = 0;
  for (const match of text.matchAll(CHIP_MARKER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) appendText(container, text.slice(lastIndex, index));
    if (match[1]) {
      const provider = match[1] as IdeContextProvider;
      appendChip(container, {
        path: `ide:${provider}`,
        name: ideContextProviderInfo(provider)?.label ?? provider,
        ideContext: provider,
      });
    } else {
      appendDraftImageChip(container, match[2], pending);
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) appendText(container, text.slice(lastIndex));
};

/**
 * 用草稿字符串重写输入框内容。调用方负责随后同步 React state 与上报。
 *
 * 认不出来的标记按纯文本插入：宁可让它以原文留在正文里，也不静默吞掉用户
 * 看到过的东西。
 */
export const renderDraftContent = (
  container: HTMLElement,
  draft: string,
  options: RenderDraftOptions = {},
): void => {
  container.replaceChildren();
  if (!draft) return;

  const pendingImages: PendingDraftImage[] = [];

  for (const part of parseMentions(draft)) {
    if (
      part.type === "mention" &&
      part.content.startsWith(FILE_MARKER_PREFIX)
    ) {
      const path = part.path ?? "";
      appendChip(container, {
        path,
        name: path.split(/[/\\]/).pop() || path,
        isImage: part.isImage,
      });
    } else if (part.type === "selection" && part.path !== undefined) {
      const fileName = part.fileName ?? part.path.split(/[/\\]/).pop() ?? "";
      appendChip(container, {
        path: part.path,
        name: `${fileName}#${part.startLine}-${part.endLine}`,
        markerName: fileName,
        isSelection: true,
        startLine: part.startLine,
        endLine: part.endLine,
      });
    } else if (part.type === "ide-context") {
      // 完整块（标记 + 内容 + 结束标记）只可能来自手打或旧草稿：按文本原样放回，
      // 发送时 `assembleIdeContextBlocks` 仍会识别并展开。
      const block = part.ideContext
        ? `${ideContextMarker(part.ideContext)}${part.content}${IDE_CONTEXT_BLOCK_END}`
        : part.content;
      appendText(container, block);
    } else {
      appendTextWithMarkers(container, part.content, pendingImages);
    }
  }

  hydrateDraftImages(container, pendingImages, options);
};
