import type { IdeContextProvider } from "wave-webview-fixtures";
import { AttachedImage } from "../types";
import { ideContextMarker } from "./ideContext";
import { saveDraftImages, type DraftImageRecord } from "./draftImageStore";

/** 图片标签上记的草稿图片 id；跨多次序列化保持不变，回填时靠它找回字节。 */
const DRAFT_IMAGE_ID_ATTR = "data-draft-image-id";
/** 图片标签的首次登记时间（淘汰最旧的用）。 */
const DRAFT_IMAGE_CREATED_AT_ATTR = "data-draft-image-created-at";

const createDraftImageId = (): string =>
  `dimg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * 将 contenteditable 的内容转换为 Markdown 格式，并提取图片。
 *
 * 假设 contenteditable 中的标签使用特定的 HTML 结构，例如：
 * <span class="context-tag" data-path="..." data-name="..." data-icon="..." data-is-image="...">...</span>
 */
export const convertToMarkdown = (
  container: HTMLElement,
): { markdown: string; images: AttachedImage[] } => {
  const { markdown, images } = traverseInput(container);
  return { markdown: markdown.trim(), images };
};

/** 未 trim 的序列化结果：草稿要原样保存用户敲下的尾部空格与空行。 */
const traverseInput = (
  container: HTMLElement,
  draftScopeKey?: string,
): { markdown: string; images: AttachedImage[] } => {
  let markdown = "";
  const images: AttachedImage[] = [];

  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      markdown += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;

      // Skip the read-only "编辑队列消息" chip: it's only a state marker and must
      // not be included in the produced markdown.
      if (element.classList.contains("queued-edit-chip")) {
        return;
      }

      // Check if it's a context tag container
      if (element.classList.contains("context-tag-container")) {
        const path = element.getAttribute("data-path") || "";
        const isImage = element.getAttribute("data-is-image") === "true";
        const isSelection =
          element.getAttribute("data-is-selection") === "true";
        const ideContext = element.getAttribute("data-ide-context");
        const agentName = element.getAttribute("data-agent-name");
        const imageUrl = element.getAttribute("data-image-url");

        if (agentName) {
          // 子代理点名标签：正文里落地成 `[@agent:<名称>]`，由 SDK 在每轮首回合
          // 解析成点名提醒（spec `multi-agent/subagent.md`「显式子代理调用」）。
          markdown += `[@agent:${agentName}]`;
        } else if (ideContext === "terminal" || ideContext === "problems") {
          // IDE 上下文标签：正文里先留一个标记，发送时由
          // `assembleIdeContextBlocks` 就地展开成「标记 + 内容 + 结束标记」。
          markdown += ideContextMarker(ideContext);
        } else if (isImage && imageUrl) {
          // 草稿模式：图片字节不进草稿字符串（每次按键都上报，塞 base64 会让
          // 每次输入传 MB 级数据），只留一个指向本地存储的标记。
          const draftImageId = draftScopeKey
            ? element.getAttribute(DRAFT_IMAGE_ID_ATTR)
            : null;
          markdown += draftImageId
            ? `[@image:${draftImageId}]`
            : `[image${images.length + 1}]`;
          images.push({
            id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            data: imageUrl,
            mimeType: imageUrl.split(";")[0].split(":")[1] || "image/png",
            filename: element.getAttribute("data-name") || "pasted-image.png",
          });
        } else if (isSelection) {
          const name = element.getAttribute("data-name") || "";
          const startLine = element.getAttribute("data-start-line") || "";
          const endLine = element.getAttribute("data-end-line") || "";
          markdown += `[Selection: ${path}|${name}#${startLine}-${endLine}]`;
        } else {
          markdown += `[@file:${path}]`;
        }
        return; // Important: don't traverse children
      }

      if (element.tagName === "BR") {
        markdown += "\n";
      } else {
        // For other elements, traverse children
        Array.from(element.childNodes).forEach(traverse);

        // If it's a block element, ensure it ends with a newline
        const isBlock = [
          "DIV",
          "P",
          "H1",
          "H2",
          "H3",
          "H4",
          "H5",
          "H6",
          "LI",
          "UL",
          "OL",
        ].includes(element.tagName);
        if (isBlock) {
          if (markdown.length > 0 && !markdown.endsWith("\n")) {
            markdown += "\n";
          }
        }
      }
    }
  };

  // Use a more robust way to get content from contenteditable
  // We'll traverse the actual DOM nodes
  Array.from(container.childNodes).forEach(traverse);

  return { markdown, images };
};

/**
 * 输入框草稿的序列化：走与发送正文同一套遍历，让引用标签
 * （`[@file:path]` / `[Selection: …]` / IDE 上下文标记 / 图片）以标记形式落进
 * 宿主的草稿字符串，而不是标签的可见文字（`@logo.png`）。
 *
 * 草稿只存活在宿主的 `inputDrafts`（一段不透明字符串），重挂载时由
 * `renderDraftContent` 按标记还原成标签；用 `innerText` 上报会让引用退化成
 * 纯文本、随消息发出去时不再是引用（缺陷 3503216687855872）。
 *
 * 与发送正文不同，这里不 trim：草稿要原样保留用户敲下的尾部空格与空行。
 *
 * 传入 `scopeKey` 时顺带把输入框里的粘贴图片登记进本地存储（图片字节太大，
 * 不能进每次按键都上报的草稿字符串），标记写成 `[@image:<id>]`。
 */
export const serializeInputDraft = (
  container: HTMLElement,
  scopeKey?: string,
): string => {
  if (scopeKey) syncDraftImages(container, scopeKey);
  return traverseInput(container, scopeKey).markdown;
};

/**
 * 把输入框里当前的图片登记进本会话的本地存储，并给每张图一个稳定的 id。
 *
 * 只有带 `data-image-url` 的才是粘贴图片（图片块）；上传文件得到的图片引用
 * 没有这个属性，仍走 `[@file:path]`，不在这里。
 */
const syncDraftImages = (container: HTMLElement, scopeKey: string): void => {
  const records: DraftImageRecord[] = [];
  const keepIds: string[] = [];

  container
    .querySelectorAll<HTMLElement>(
      '.context-tag-container[data-is-image="true"]',
    )
    .forEach((chip) => {
      const knownId = chip.getAttribute(DRAFT_IMAGE_ID_ATTR);
      const dataUrl = chip.getAttribute("data-image-url");
      // 回填出来的图片先有 id、字节过一会儿才从存储里取回：这一轮序列化不能
      // 因为「暂时没有字节」就把它的记录删掉。
      if (knownId) keepIds.push(knownId);
      if (!dataUrl) return;

      let id = knownId;
      if (!id) {
        id = createDraftImageId();
        chip.setAttribute(DRAFT_IMAGE_ID_ATTR, id);
        chip.setAttribute(DRAFT_IMAGE_CREATED_AT_ATTR, String(Date.now()));
      }
      records.push({
        key: `${scopeKey}:${id}`,
        scopeKey,
        id,
        dataUrl,
        mimeType: dataUrl.slice(5).split(";")[0] || "image/png",
        filename: chip.getAttribute("data-name") || "pasted-image.png",
        createdAt:
          Number(chip.getAttribute(DRAFT_IMAGE_CREATED_AT_ATTR)) || Date.now(),
      });
    });

  void saveDraftImages(scopeKey, records, keepIds);
};

/**
 * 解析 Markdown 中的标签语法 [@file:path], [Selection: fileName#start-end],
 * [imageN]，子代理点名 [@agent:名称]，以及发送时已展开的 IDE 上下文块
 * `[@ide:terminal]` … `[/@ide]`（spec ui/ide-context-mentions.md）。
 */
export const parseMentions = (
  text: string,
  attachedImages?: Array<{ data: string; filename?: string }>,
): Array<{
  type: "text" | "mention" | "selection" | "ide-context" | "agent";
  content: string;
  path?: string;
  isImage?: boolean;
  fileName?: string;
  startLine?: string;
  endLine?: string;
  imageData?: string;
  ideContext?: IdeContextProvider;
  agentName?: string;
}> => {
  const parts: Array<{
    type: "text" | "mention" | "selection" | "ide-context" | "agent";
    content: string;
    path?: string;
    isImage?: boolean;
    fileName?: string;
    startLine?: string;
    endLine?: string;
    imageData?: string;
    ideContext?: IdeContextProvider;
    agentName?: string;
  }> = [];
  // Updated regex to handle [Selection: path|fileName#start-end] or [Selection: fileName#start-end]
  // IDE 上下文块（`[@ide:<类别>]` … `[/@ide]`，见 utils/ideContext）与子代理点名
  // （`[@agent:<名称>]`）放在最后两个分支：前六个捕获组的位置保持不变。
  const regex =
    /\[@file:(.*?)\]|\[Selection: (?:(.*?)\|)?(.*?)#(\d+)-(\d+)\]|\[image(\d+)\]|\[@ide:(terminal|problems)\]([\s\S]*?)\[\/@ide\]|\[@agent:([a-zA-Z][\w:-]*)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: text.substring(lastIndex, match.index),
      });
    }

    if (match[9]) {
      // 子代理点名：气泡里渲染成 `@<名称>` 标签，点不开（它不是文件）
      parts.push({ type: "agent", content: match[0], agentName: match[9] });
    } else if (match[1]) {
      // @file mention
      const path = match[1];
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path);
      parts.push({ type: "mention", content: match[0], path, isImage });
    } else if (match[6]) {
      // [imageN] placeholder
      const index = parseInt(match[6]) - 1;
      const attachedImage = attachedImages?.[index];
      const displayName = `图片 ${match[6]}`;
      parts.push({
        type: "mention",
        content: match[0],
        path: displayName,
        isImage: true,
        imageData: attachedImage?.data,
      });
    } else if (match[7]) {
      // IDE 上下文块：content 是块内全文（用户气泡里只渲染标签，点开看全文）
      parts.push({
        type: "ide-context",
        content: match[8] ?? "",
        ideContext: match[7] as IdeContextProvider,
      });
    } else if (match[3]) {
      // Selection
      // match[2] is path (optional), match[3] is fileName, match[4] is startLine, match[5] is endLine
      parts.push({
        type: "selection",
        content: match[0],
        path: match[2],
        fileName: match[3],
        startLine: match[4],
        endLine: match[5],
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.substring(lastIndex) });
  }

  return parts;
};

/**
 * Render a tool file path relative to the agent workdir for compact display,
 * mirroring the CLI's `getDisplayPath` (packages/agent-sdk/src/utils/path.ts):
 * paths inside the workdir are shown relative (posix separators), paths outside
 * it (or whose relative form starts with `..`) fall back to the absolute path,
 * and a path equal to the workdir shows ".". The original (absolute) path is
 * always used for open-file jumps.
 */
export const toRelativePath = (filePath: string, workdir?: string): string => {
  if (!filePath) return filePath;
  if (!workdir) return toPosixPath(filePath);
  const relativePath = pathRelative(workdir, filePath);
  if (relativePath === "") {
    return ".";
  }
  if (relativePath.length < filePath.length && !relativePath.startsWith("..")) {
    return relativePath;
  }
  return toPosixPath(filePath);
};

/**
 * Lightweight `path.relative` equivalent for the browser bundle (no Node path
 * module available). Accepts both posix (`/`) and win32 (`\`) separators and
 * win32 drive letters, so mixed separator styles still relativize correctly.
 * Returns "" when both paths are equal.
 */
const pathRelative = (from: string, to: string): string => {
  const fromParts = splitPath(from);
  const toParts = splitPath(to);
  // Different roots (e.g. different win32 drive letters) cannot be relative.
  if (fromParts.root !== toParts.root) {
    return to;
  }
  let common = 0;
  const max = Math.min(fromParts.segments.length, toParts.segments.length);
  while (
    common < max &&
    fromParts.segments[common] === toParts.segments[common]
  ) {
    common++;
  }
  const parts: string[] = [];
  for (let i = common; i < fromParts.segments.length; i++) {
    parts.push("..");
  }
  parts.push(...toParts.segments.slice(common));
  return parts.join("/");
};

/**
 * Split a path into its root ("" / "/" / "C:/") and normalized segments.
 * Treats `\` and `/` as separators and collapses `.` / `..` segments.
 */
const splitPath = (p: string): { root: string; segments: string[] } => {
  const normalized = p.replace(/\\/g, "/");
  let root = "";
  let rest = normalized;
  const driveMatch = normalized.match(/^([A-Za-z]):(\/|$)/);
  if (driveMatch) {
    root = `${driveMatch[1]}:/`;
    rest = normalized.slice(driveMatch[0].length);
  } else if (normalized.startsWith("/")) {
    root = "/";
    rest = normalized.slice(1);
  }
  const segments: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return { root, segments };
};

/**
 * Collapse `.` / `..` and empty segments into a canonical path — the lexical
 * equivalent of `path.resolve`'s normalization for the browser bundle. The
 * input's own separator style and root prefix (`/` or `C:\`) are preserved, so
 * a win32 path keeps its backslashes. Pure string work: `..` is folded
 * lexically (a symlinked directory is not re-resolved), matching what the SDK
 * tools get from `path.resolve` — which keeps "the path a click opens" and "the
 * path a tool wrote" comparable.
 *
 * Expects an already-absolute path (callers join with the workdir first); on a
 * relative input the leading `..` is dropped, since the browser has no cwd.
 */
export const normalizeFilePath = (filePath: string): string => {
  const rootMatch = filePath.match(/^([A-Za-z]:[\\/]|\/)/);
  const root = rootMatch ? rootMatch[1] : "";
  const sep = root.endsWith("\\") ? "\\" : "/";
  const segments: string[] = [];
  for (const part of filePath.slice(root.length).split(/[\\/]+/)) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return `${root}${segments.join(sep)}`;
};

/** Does the path name its own root (`/…`, `C:\…`)? Mirrors normalizeFilePath. */
const HAS_ROOT = /^([A-Za-z]:[\\/]|\/)/;

/**
 * Resolve a path that may be relative to the session workdir into the absolute,
 * normalized path a host can act on. Used at the click boundary: a mention chip
 * is written as `[@file:<relativePath>]` by the file picker, and the host
 * resolves `openFile` against its own cwd, not the session workdir.
 *
 * Returns null when the path is relative and no workdir is known — the caller
 * keeps the raw string (same contract as resolveFilePathMatch).
 */
export const toAbsoluteFilePath = (
  filePath: string,
  workdir?: string,
): string | null => {
  if (!filePath) return null;
  if (HAS_ROOT.test(filePath)) return normalizeFilePath(filePath);
  if (!workdir) return null;
  return normalizeFilePath(`${workdir.replace(/[\\/]+$/, "")}/${filePath}`);
};

/** Collapse backslashes to forward slashes for consistent display. */
const toPosixPath = (p: string): string => p.replace(/\\/g, "/");
