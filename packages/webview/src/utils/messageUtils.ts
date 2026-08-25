import { AttachedImage } from "../types";

/**
 * 将 contenteditable 的内容转换为 Markdown 格式，并提取图片。
 *
 * 假设 contenteditable 中的标签使用特定的 HTML 结构，例如：
 * <span class="context-tag" data-path="..." data-name="..." data-icon="..." data-is-image="...">...</span>
 */
export const convertToMarkdown = (
  container: HTMLElement,
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
        const imageUrl = element.getAttribute("data-image-url");

        if (isImage && imageUrl) {
          const placeholder = `[image${images.length + 1}]`;
          markdown += placeholder;
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

  return { markdown: markdown.trim(), images };
};

/**
 * 解析 Markdown 中的标签语法 [@file:path], [Selection: fileName#start-end] 和 [imageN]
 */
export const parseMentions = (
  text: string,
  attachedImages?: Array<{ data: string; filename?: string }>,
): Array<{
  type: "text" | "mention" | "selection";
  content: string;
  path?: string;
  isImage?: boolean;
  fileName?: string;
  startLine?: string;
  endLine?: string;
  imageData?: string;
}> => {
  const parts: Array<{
    type: "text" | "mention" | "selection";
    content: string;
    path?: string;
    isImage?: boolean;
    fileName?: string;
    startLine?: string;
    endLine?: string;
    imageData?: string;
  }> = [];
  // Updated regex to handle [Selection: path|fileName#start-end] or [Selection: fileName#start-end]
  const regex =
    /\[@file:(.*?)\]|\[Selection: (?:(.*?)\|)?(.*?)#(\d+)-(\d+)\]|\[image(\d+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: text.substring(lastIndex, match.index),
      });
    }

    if (match[1]) {
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

/** Collapse backslashes to forward slashes for consistent display. */
const toPosixPath = (p: string): string => p.replace(/\\/g, "/");
