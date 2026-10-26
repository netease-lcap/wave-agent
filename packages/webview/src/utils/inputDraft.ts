import { createElement } from "react";
import ReactDOM from "react-dom/client";
import type { IdeContextProvider } from "wave-webview-fixtures";
import { ContextTag } from "../components/ContextTag";
import {
  IDE_CONTEXT_BLOCK_END,
  IDE_MARKER_PATTERN,
  ideContextMarker,
  ideContextProviderInfo,
} from "./ideContext";
import { parseMentions } from "./messageUtils";

/**
 * 输入框草稿的「字符串 → 输入框 DOM」还原。
 *
 * 草稿以 markdown 形式存在宿主的 `inputDrafts` 里（见 `serializeInputDraft`），
 * 其中的引用标签是标记文本：`[@file:path]`、`[Selection: path|name#1-2]`、
 * `[@ide:terminal]`。重挂载时在这里把标记还原成 `context-tag-container` 标签，
 * 否则引用会退化成纯文本，发出时不再按引用处理（缺陷 3503216687855872）。
 */

/** 文件引用标记的前缀（`[@file:/abs/path]`，上传附件与 @ 提及文件都是它）。 */
const FILE_MARKER_PREFIX = "[@file:";

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

/** 文本片段里可能夹着 IDE 上下文标记（`[@ide:terminal]`），单独还原成标签。 */
const appendTextWithIdeMarkers = (
  container: HTMLElement,
  text: string,
): void => {
  let lastIndex = 0;
  for (const match of text.matchAll(IDE_MARKER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) appendText(container, text.slice(lastIndex, index));
    const provider = match[1] as IdeContextProvider;
    const info = ideContextProviderInfo(provider);
    appendChip(container, {
      path: `ide:${provider}`,
      name: info?.label ?? provider,
      ideContext: provider,
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) appendText(container, text.slice(lastIndex));
};

/**
 * 用草稿字符串重写输入框内容。调用方负责随后同步 React state 与上报。
 *
 * `[imageN]` 与无法识别的标记按纯文本插入：草稿字符串里没有图片数据，宁可让它
 * 以占位文本留在正文里，也不静默吞掉用户看到过的东西。
 */
export const renderDraftContent = (
  container: HTMLElement,
  draft: string,
): void => {
  container.replaceChildren();
  if (!draft) return;

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
      // 纯文本：`[imageN]`（粘贴图片占位，图片数据不在草稿字符串里）与用户手打的
      // 标记都按文本保留，只把夹在其中的 IDE 上下文标记还原成标签。
      appendTextWithIdeMarkers(container, part.content);
    }
  }
};
