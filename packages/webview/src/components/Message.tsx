import React from "react";
import { ContextTag } from "./ContextTag";
import { parseMentions, toRelativePath } from "../utils/messageUtils";
import { isLocalhostUrl } from "../utils/isLocalhostUrl";
import {
  linkifyPlainText,
  stripTrailingUrlPunct,
} from "../utils/linkifyPlainText";
import { marked } from "marked";
import { Tooltip } from "./Tooltip";

// ... (existing imports)
import DOMPurify from "dompurify";
import {
  BASH_TOOL_NAME,
  LSP_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  READ_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
} from "wave-agent-sdk/dist/constants/tools.js";
import type {
  Message as MessageType,
  MessageProps,
  ToolBlock,
  ImageBlock,
  ReasoningBlock,
  CompactBlock,
  MessageBlock,
} from "../types";
import { DiffViewer } from "./DiffViewer";
import { MermaidRenderer } from "./MermaidRenderer";
import { ReasoningBlockView } from "./ReasoningBlockView";
import { CompactBlockView } from "./CompactBlockView";
import { WriteToolPreview } from "./WriteToolPreview";
import { FileToolHeader } from "./FileToolHeader";
import "../styles/Message.css";

// Configure marked for VS Code webview context
const renderTaskListitem = (text: string, task: boolean, checked: boolean) => {
  if (task) {
    return `<li class="task-list-item${checked ? " checked" : ""}">${text}</li>`;
  }
  return `<li>${text}</li>`;
};

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    listitem: renderTaskListitem,
  },
});

// 在默认 url tokenizer 之上剥离尾部中文标点；返回 false 时 marked.use 会
// 回退到默认实现（url tokenizer 被 marked.use 包装，实例共享默认 rules）。
// ASCII 标点已由默认实现的 _backpedal 剔除，剥离函数对 ASCII 是 no-op。
const baseUrlTokenizer = new marked.Tokenizer();

marked.use({
  tokenizer: {
    url(src: string) {
      const token = baseUrlTokenizer.url.call(this, src);
      if (!token) return false;
      const raw = stripTrailingUrlPunct(token.raw);
      if (raw === token.raw) return token;
      // href 可能是 raw 加前缀的形式（www. → "http://" + raw）；token.text
      // 是 raw 的转义形式（默认实现 escape(cap[0])），中文标点在转义中
      // 保持不变，同样剥离即可。
      const prefix = token.href.endsWith(token.raw)
        ? token.href.slice(0, -token.raw.length)
        : "";
      token.raw = raw;
      token.href = prefix + raw;
      token.text = stripTrailingUrlPunct(token.text);
      token.tokens = [{ type: "text", raw: token.text, text: token.text }];
      return token;
    },
  },
});

// 行内代码（反引号）中的裸 http(s) URL 提升为可点击链接：仅当剥离首尾
// 常见标点后整个内容是一个无空白的 URL 时才提升；多 URL、markdown 链接
// 语法原文、非 http(s) 协议一律保持代码原文（见 specs/ui/markdown-links.md）。
const extractClickableUrl = (codeText: string): string | null => {
  const trimmed = codeText.trim();
  if (!trimmed) return null;
  const punct = /[\s.,;:!?()[\]{}'"<>，。、；：！？（）「」『』【】]/;
  let start = 0;
  let end = trimmed.length;
  while (start < end && punct.test(trimmed[start]!)) start++;
  while (end > start && punct.test(trimmed[end - 1]!)) end--;
  const url = trimmed.slice(start, end);
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
};

// 局部 renderer：marked 9 的 parse 传 renderer 会整体替换全局 use 的配置，
// 因此从完整 Renderer 派生并带上任务列表渲染，避免影响其它 marked 使用点。
// codespan 收到的 text 已被 marked 的 tokenizer 转义（escape(text, true)），
// 直接复用即可，URL 提升时 href 与显示文本同为已转义形式（如查询参数中的
// `&` → `&amp;`，浏览器解析后还原）。
const messageMarkdownRenderer = (() => {
  const renderer = new marked.Renderer();
  renderer.listitem = renderTaskListitem;
  renderer.codespan = (text: string) => {
    const url = extractClickableUrl(text);
    if (url) {
      return `<code><a href="${url}">${url}</a></code>`;
    }
    return `<code>${text}</code>`;
  };
  return renderer;
})();

// Interface for parsed markdown content that may contain mermaid diagrams
interface ParsedMarkdownContent {
  elements: Array<{
    type: "html" | "mermaid";
    content: string;
    id?: string;
  }>;
}

// Parse markdown content and extract mermaid blocks
const parseMarkdownWithMermaid = (content: string): ParsedMarkdownContent => {
  if (!content || content.trim() === "") {
    return { elements: [] };
  }

  const elements: Array<{
    type: "html" | "mermaid";
    content: string;
    id?: string;
  }> = [];

  // Split content by mermaid blocks
  const parts = content.split(/(```mermaid\n[\s\S]*?\n```)/g);

  let mermaidIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.match(/^```mermaid\n[\s\S]*?\n```$/)) {
      // This is a mermaid block
      const mermaidContent = part
        .replace(/^```mermaid\n/, "")
        .replace(/\n```$/, "")
        .trim();
      elements.push({
        type: "mermaid",
        content: mermaidContent,
        id: `mermaid-${mermaidIndex++}`,
      });
    } else if (part.trim()) {
      // This is regular markdown content
      const html = marked.parse(part, { renderer: messageMarkdownRenderer });
      const sanitizedHtml = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          "p",
          "br",
          "strong",
          "b",
          "em",
          "i",
          "code",
          "pre",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "ul",
          "ol",
          "li",
          "a",
          "blockquote",
          "hr",
          "img",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "del",
          "input",
        ],
        ALLOWED_ATTR: [
          "href",
          "title",
          "align",
          "type",
          "checked",
          "disabled",
          "class",
          "src",
          "alt",
        ],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: [],
        FORBID_TAGS: [],
      });

      if (typeof sanitizedHtml === "string" && sanitizedHtml.trim()) {
        elements.push({
          type: "html",
          content: sanitizedHtml,
        });
      }
    }
  }

  return { elements };
};

// 与 CLI /rewind 检查点判定（isUserCheckpointMessage）保持一致：后台任务
// 通知与 hook 注入的系统生成消息不作为回滚目标。bash 模式命令消息（`!ls`）
// 是用户真实输入，与 fork skill 命令一致，可显示回滚按钮。
const isRewindTargetMessage = (message: MessageType): boolean =>
  message.role === "user" &&
  !message.isMeta &&
  !!message.id &&
  !message.blocks.some((b) => b.type === "task_notification") &&
  !message.blocks.some((b) => b.type === "text" && b.source === "hook");

export const Message: React.FC<MessageProps> = React.memo(
  (props: MessageProps) => {
    const { message, isQueued = false, onRewindToMessage, workdir } = props;

    // Desktop routes file opens to its file panel (the host resolves the path,
    // pushing content back); IDE hosts keep the plain openFile RPC. The message
    // chain reaches here via onOpenFile so the outbound message carries the
    // originating paneId (postToHost in ChatApp) — a direct vscode.postMessage
    // from a split-view pane would broadcast without it and misroute.
    const openFile = (path: string, startLine?: number, endLine?: number) => {
      if (props.onOpenFile) {
        props.onOpenFile(path, startLine, endLine);
      } else {
        props.vscode.postMessage({
          command: "openFile",
          path,
          startLine,
          endLine,
        });
      }
    };

    const getMessageClassName = () => {
      const classes = ["message"];

      if (message.role === "user") {
        classes.push("user");
        if (isQueued) {
          classes.push("queued");
        }
      } else if (message.role === "assistant") {
        classes.push("assistant");
      }

      return classes.join(" ");
    };

    const handleImagePreview = (url: string, name: string) => {
      const modal = document.createElement("div");
      modal.className = "image-preview-modal";
      modal.onclick = () => document.body.removeChild(modal);

      const img = document.createElement("img");
      img.src = url;
      img.alt = name;
      img.onclick = (e) => e.stopPropagation();

      const closeBtn = document.createElement("div");
      closeBtn.className = "image-preview-close";
      closeBtn.innerHTML = '<i class="codicon codicon-close"></i>';

      modal.appendChild(img);
      modal.appendChild(closeBtn);
      document.body.appendChild(modal);
    };

    const getAttachedImages = () => {
      const images: Array<{ data: string; filename?: string }> = [];
      message.blocks?.forEach((block) => {
        if (block.type === "image" && block.imageUrls) {
          block.imageUrls.forEach((url) => {
            images.push({ data: url, filename: `图片 ${images.length + 1}` });
          });
        } else if (block.type === "tool" && block.images) {
          block.images.forEach((img) => {
            images.push({
              data: img.data,
              filename: `图片 ${images.length + 1}`,
            });
          });
        }
      });
      return images;
    };

    // Link routing is a desktop-host feature: localhost links open in
    // the preview pane, everything else goes to the system browser. IDE hosts
    // keep their native link handling, so bail BEFORE any preventDefault.
    const handleContentClick = (e: React.MouseEvent) => {
      if (window.waveHostType !== "desktop") return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      if (isLocalhostUrl(href) && props.onOpenPreview) {
        props.onOpenPreview(href);
      } else {
        props.vscode.postMessage({ command: "openExternal", url: href });
      }
    };

    const renderMarkdownContent = (content: string, index: number) => {
      const parsed = parseMarkdownWithMermaid(content);
      return (
        <div
          key={index}
          className="message-content-container"
          onClick={handleContentClick}
        >
          {parsed.elements.map((element, elIndex) =>
            element.type === "mermaid" ? (
              <MermaidRenderer
                key={element.id || `mermaid-${index}-${elIndex}`}
                content={element.content}
              />
            ) : (
              <div
                key={`html-${index}-${elIndex}`}
                className="message-content markdown-content"
                dangerouslySetInnerHTML={{
                  __html: element.content,
                }}
              />
            ),
          )}
        </div>
      );
    };

    const renderBashIO = (toolBlock: ToolBlock) => {
      const stage = toolBlock.stage;

      // Parse the command from parameters. AI-invoked bash calls carry JSON
      // (`{"command": "..."}`); bash-mode blocks carry the bare command string.
      let command = "";
      let hasValidCommand = false;
      try {
        if (toolBlock.parameters) {
          const params = JSON.parse(toolBlock.parameters);
          if (params && typeof params === "object") {
            command = params.command || "";
            hasValidCommand = !!command;
          }
        }
      } catch {
        // Not JSON — fall through to the raw parameters below.
      }
      if (!hasValidCommand) {
        command = toolBlock.compactParams || toolBlock.parameters || "";
        hasValidCommand = !!command;
      }

      // Only render bash-specific content if we have a valid command and appropriate stage
      if ((stage === "running" || stage === "end") && hasValidCommand) {
        const result = (toolBlock.result || toolBlock.shortResult || "").trim();

        if (result) {
          // Show both input and output if result is present (even if running)
          return (
            <div className="bash-command-unified" onClick={handleContentClick}>
              <div className="bash-command-input">
                <span className="bash-command">{command}</span>
              </div>
              {/* 输出中的裸 http(s) URL 链接化（见 specs/ui/markdown-links.md），
                  点击路由复用 handleContentClick：desktop 上 localhost → 预览
                  面板、其余 → 系统浏览器；IDE 保持原生链接处理。 */}
              <div
                className="bash-command-output"
                dangerouslySetInnerHTML={{
                  __html: linkifyPlainText(result),
                }}
              />
            </div>
          );
        } else {
          // Show only input if no result yet
          return (
            <div className="bash-command-input">
              <span className="bash-command">{command}</span>
            </div>
          );
        }
      }

      // For all other cases, return null (no additional content)
      return null;
    };

    // Running/streaming dots are neutral gray (prototype: running = gray,
    // red/green reserved for outcome states).
    const getToolStatusColor = (toolBlock: ToolBlock) =>
      toolBlock.stage === "running" || toolBlock.stage === "streaming"
        ? "var(--vscode-descriptionForeground, #888)"
        : toolBlock.success === true
          ? "var(--vscode-testing-iconPassed, #73c991)"
          : toolBlock.error || toolBlock.success === false
            ? "var(--vscode-testing-iconFailed, #f14c4c)"
            : "var(--vscode-descriptionForeground, #888)";

    // Dot color for text/reasoning blocks: gray while streaming, green once done.
    const getStageColor = (stage?: "streaming" | "end") =>
      stage === "streaming"
        ? "var(--vscode-descriptionForeground, #888)"
        : "var(--vscode-testing-iconPassed, #73c991)";

    const renderToolBlock = (toolBlock: ToolBlock, index: number) => {
      // Default tool rendering for all tools (including Bash)
      const compactInfo =
        toolBlock.stage === "streaming"
          ? toolBlock.parameters
            ? String(toolBlock.parameters).slice(-30)
            : ""
          : toolBlock.compactParams || "";
      const toolStatusColor = getToolStatusColor(toolBlock);
      const toolHeader = (
        <div key={index} className="tool-block">
          <span className="tool-status-dot" style={{ color: toolStatusColor }}>
            ●
          </span>{" "}
          {toolBlock.name || "Tool"}
          {compactInfo ? (
            <span className="compact-params"> {compactInfo}</span>
          ) : (
            ""
          )}
        </div>
      );

      // Render tool error if it exists (with same style as error blocks)
      const errorContent = (toolBlock as unknown as Record<string, unknown>)
        .error ? (
        <div className="tool-error">
          <pre>
            {String((toolBlock as unknown as Record<string, unknown>).error)}
          </pre>
        </div>
      ) : null;

      // For Bash tools, add the bash-specific content below the header
      if (toolBlock.name === BASH_TOOL_NAME) {
        const bashContent = renderBashIO(toolBlock);
        if (bashContent || errorContent) {
          return (
            <div key={index} className="tool-container">
              {toolHeader}
              {bashContent}
              {errorContent}
            </div>
          );
        }
      }

      // For LSP tools, show output with max height and no scrolling
      if (toolBlock.name === LSP_TOOL_NAME) {
        return (
          <div key={index} className="tool-container">
            {toolHeader}
            {!errorContent && (
              <div className="lsp-output">
                {(toolBlock.shortResult || toolBlock.result || "").trim()}
              </div>
            )}
            {errorContent}
          </div>
        );
      }

      // For file editing tools, show diff below the header only when stage is 'end'
      if (toolBlock.name === WRITE_TOOL_NAME) {
        // During streaming the parameters JSON is incomplete; fall back to the
        // default header which shows the last 30 chars of the raw parameters.
        if (toolBlock.stage === "streaming") {
          return toolHeader;
        }
        return (
          <div key={index} className="tool-container">
            {!errorContent && (
              <WriteToolPreview
                toolBlock={toolBlock}
                vscode={props.vscode}
                workdir={workdir}
                onOpenFile={openFile}
              />
            )}
            {errorContent && toolHeader}
            {errorContent}
          </div>
        );
      }
      if (toolBlock.name === EDIT_TOOL_NAME) {
        if (toolBlock.stage === "streaming") {
          return toolHeader;
        }
        let editFilePath = "";
        try {
          if (toolBlock.parameters) {
            editFilePath = JSON.parse(toolBlock.parameters).file_path || "";
          }
        } catch {
          editFilePath = "";
        }
        const openEditFile = () => {
          if (editFilePath) {
            openFile(editFilePath);
          }
        };
        return (
          <div key={index} className="tool-container">
            <FileToolHeader
              toolBlock={toolBlock}
              filePath={toRelativePath(editFilePath, workdir)}
              onOpenFile={openEditFile}
            />
            {!errorContent && <DiffViewer toolBlock={toolBlock} />}
            {errorContent}
          </div>
        );
      }

      // For Read tools, show clickable path with offset/limit suffix (aligned with Write header style)
      if (toolBlock.name === READ_TOOL_NAME) {
        if (toolBlock.stage === "streaming") {
          return toolHeader;
        }
        let filePath = "";
        let displayPath = "";
        let offset: number | undefined;
        let limit: number | undefined;
        try {
          if (toolBlock.parameters) {
            const params = JSON.parse(toolBlock.parameters);
            filePath = params.file_path || "";
            offset =
              typeof params.offset === "number" ? params.offset : undefined;
            limit = typeof params.limit === "number" ? params.limit : undefined;
            const relPath = toRelativePath(filePath, workdir);
            displayPath =
              relPath && (offset !== undefined || limit !== undefined)
                ? `${relPath}:${offset !== undefined ? offset : 1}:${limit !== undefined ? limit : 2000}`
                : relPath;
          }
        } catch {
          filePath = "";
        }
        const openReadFile = () => {
          if (filePath) {
            // offset/limit describe the read slice (1-based); jump to it so the
            // panel lands on the same lines the tool actually read.
            openFile(
              filePath,
              offset,
              offset && limit ? offset + limit - 1 : undefined,
            );
          }
        };
        return (
          <div key={index} className="tool-container">
            <FileToolHeader
              toolBlock={toolBlock}
              filePath={displayPath}
              onOpenFile={openReadFile}
            />
            {!errorContent && toolBlock.shortResult && (
              <div className="write-tool-stats">{toolBlock.shortResult}</div>
            )}
            {errorContent}
          </div>
        );
      }

      // For AskUserQuestion tools, show the user's answers
      if (toolBlock.name === ASK_USER_QUESTION_TOOL_NAME) {
        let answers: Record<string, unknown> = {};
        let isParsed = false;
        try {
          const result = toolBlock.shortResult || toolBlock.result;
          if (typeof result === "string") {
            const trimmed = result.trim();
            if (trimmed.startsWith("{")) {
              try {
                let parsed = JSON.parse(trimmed);
                // Handle nested "answers" key if it's the only key
                if (
                  parsed &&
                  typeof parsed === "object" &&
                  Object.keys(parsed).length === 1 &&
                  parsed.answers &&
                  typeof parsed.answers === "object"
                ) {
                  parsed = parsed.answers;
                }
                answers = parsed;
                isParsed = true;
              } catch {
                // Try to find the first { and last }
                const start = trimmed.indexOf("{");
                const end = trimmed.lastIndexOf("}");
                if (start !== -1 && end !== -1 && end > start) {
                  let parsed = JSON.parse(trimmed.substring(start, end + 1));
                  if (
                    parsed &&
                    typeof parsed === "object" &&
                    Object.keys(parsed).length === 1 &&
                    parsed.answers &&
                    typeof parsed.answers === "object"
                  ) {
                    parsed = parsed.answers;
                  }
                  answers = parsed;
                  isParsed = true;
                }
              }
            }
          } else if (typeof result === "object" && result !== null) {
            let parsed: Record<string, unknown> = result as Record<
              string,
              unknown
            >;
            if (
              Object.keys(parsed).length === 1 &&
              parsed.answers &&
              typeof parsed.answers === "object"
            ) {
              parsed = parsed.answers as Record<string, unknown>;
            }
            answers = parsed;
            isParsed = true;
          }
        } catch {
          // Fallback to raw result
        }

        const result = toolBlock.shortResult || toolBlock.result;
        return (
          <div key={index} className="tool-container">
            {toolHeader}
            {!errorContent && result && (
              <div className="tool-result-block">
                {isParsed ? (
                  Object.entries(answers).map(([question, answer], aIndex) => (
                    <div key={aIndex} className="ask-user-result-item">
                      <span
                        className="ask-user-result-q"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {question}
                      </span>
                      <span
                        className="ask-user-result-a"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {Array.isArray(answer)
                          ? answer.join(", ")
                          : typeof answer === "object" && answer !== null
                            ? JSON.stringify(answer)
                            : String(answer)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="result-raw">{String(result)}</div>
                )}
              </div>
            )}
            {errorContent}
          </div>
        );
      }

      // For ExitPlanMode tools, show the decision
      if (toolBlock.name === EXIT_PLAN_MODE_TOOL_NAME) {
        const result = toolBlock.shortResult || toolBlock.result;
        const resultText =
          typeof result === "string"
            ? result
            : result
              ? JSON.stringify(result)
              : "";

        return (
          <div key={index} className="tool-container">
            {toolHeader}
            {!errorContent && resultText && (
              <div className="tool-result-block">
                <div className="result-item">
                  <div className="result-answer">{resultText}</div>
                </div>
              </div>
            )}
            {errorContent}
          </div>
        );
      }

      // For other tools, show result or shortResult if present
      if ((toolBlock.result || toolBlock.shortResult) && !errorContent) {
        const rawText = (
          toolBlock.shortResult ||
          toolBlock.result ||
          ""
        ).trim();
        const lines = rawText.split("\n");
        return (
          <div key={index} className="tool-container">
            {toolHeader}
            <div className="tool-result-block">
              <div className="result-raw">
                {lines.map((line, i) => (
                  <div key={i} className="result-raw-line">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }

      // For other tools, show error if present
      if (errorContent) {
        return (
          <div key={index} className="tool-container">
            {toolHeader}
            {errorContent}
          </div>
        );
      }

      // For other tools without special content, just return the header
      return toolHeader;
    };

    const renderImageBlock = (imageBlock: ImageBlock, index: number) => {
      if (
        !imageBlock.imageUrls ||
        imageBlock.imageUrls.length === 0 ||
        message.role === "user"
      ) {
        return null;
      }

      const getImageTypeFromUrl = (url: string): string => {
        // Try to determine type from URL extension or default to IMG
        const extension = url.split(".").pop()?.toLowerCase();
        switch (extension) {
          case "png":
            return "PNG";
          case "jpg":
          case "jpeg":
            return "JPG";
          case "gif":
            return "GIF";
          case "webp":
            return "WEBP";
          case "svg":
            return "SVG";
          default:
            return "IMG";
        }
      };

      return (
        <div key={`image-${index}`} className="image-block">
          {imageBlock.imageUrls.map((imageUrl, imgIndex) => (
            <div
              key={`img-${index}-${imgIndex}`}
              className="image-item-message"
            >
              <div className="image-icon">
                <span className="image-type">
                  {getImageTypeFromUrl(imageUrl)}
                </span>
              </div>
              <div className="image-info">
                <span className="image-name">{`Image ${imgIndex + 1}`}</span>
              </div>
            </div>
          ))}
        </div>
      );
    };

    const renderReasoningBlock = (
      reasoningBlock: ReasoningBlock,
      index: number,
    ) => {
      return (
        <ReasoningBlockView
          key={`reasoning-${index}`}
          block={reasoningBlock}
          renderContent={(content) => renderMarkdownContent(content, index)}
        />
      );
    };

    const renderCompactBlock = (compactBlock: CompactBlock, index: number) => (
      <CompactBlockView
        block={compactBlock}
        renderContent={(content) => renderMarkdownContent(content, index)}
      />
    );

    const renderBlock = (block: MessageBlock, index: number) => {
      let rendered: React.ReactNode = null;
      let wrap = false;
      let dotColor: string | undefined;

      switch (block.type) {
        case "compact":
          // Same color as .compact-dot so the timeline dot matches the in-block dot.
          rendered = renderCompactBlock(block, index);
          wrap = true;
          dotColor =
            "var(--vscode-textLink-foreground, var(--vscode-descriptionForeground))";
          break;
        case "text": {
          const content = block.content || "";
          if (!content.trim()) return null;

          if (message.role === "user") {
            const attachedImages = getAttachedImages();
            const parts = parseMentions(content, attachedImages);

            return (
              <div key={index} className="user-text-block">
                <div className="message-content user-content">
                  {parts.map((part, pIndex) => {
                    if (part.type === "mention") {
                      const onClick = part.isImage
                        ? () => {
                            if (part.imageData) {
                              handleImagePreview(
                                part.imageData,
                                part.path || "image",
                              );
                            } else {
                              openFile(part.path || "");
                            }
                          }
                        : undefined;

                      return (
                        <ContextTag
                          key={pIndex}
                          name={
                            part.path
                              ?.replace(/[/\\]$/, "")
                              .split(/[/\\]/)
                              .pop() || ""
                          }
                          path={part.path || ""}
                          isImage={part.isImage}
                          onClick={onClick}
                        />
                      );
                    } else if (part.type === "selection") {
                      const displayName = `${part.fileName}#${part.startLine}-${part.endLine}`;
                      const filePath = part.path || part.fileName || "";
                      return (
                        <ContextTag
                          key={pIndex}
                          name={displayName}
                          path={filePath}
                          onClick={() => {
                            openFile(
                              filePath,
                              part.startLine
                                ? parseInt(part.startLine)
                                : undefined,
                              part.endLine ? parseInt(part.endLine) : undefined,
                            );
                          }}
                        />
                      );
                    } else {
                      return <span key={pIndex}>{part.content}</span>;
                    }
                  })}
                </div>
              </div>
            );
          }

          rendered = renderMarkdownContent(content, index);
          wrap = true;
          dotColor = getStageColor(block.stage);
          break;
        }
        case "error":
          return (
            <div key={index} className="message-content error">
              <pre>{block.content || ""}</pre>
            </div>
          );
        case "tool": {
          const toolBlock = block as ToolBlock;
          rendered = renderToolBlock(toolBlock, index);
          wrap = true;
          dotColor = getToolStatusColor(block as ToolBlock);
          break;
        }
        case "image":
          return renderImageBlock(block as ImageBlock, index);
        case "reasoning":
          rendered = renderReasoningBlock(block, index);
          wrap = true;
          dotColor = getStageColor(block.stage);
          break;
        default:
          return null;
      }

      if (!wrap || rendered === null) return rendered;

      // The running pulse animation (prototype .design-activity.is-running)
      // only applies while a block is actively streaming/running; outcome
      // states keep the static dot.
      const isRunning =
        block.type === "tool"
          ? block.stage === "running" || block.stage === "streaming"
          : (block.type === "reasoning" || block.type === "text") &&
            block.stage === "streaming";

      return (
        <div
          key={index}
          className={`timeline-row${isRunning ? " timeline-row--running" : ""}`}
          style={
            dotColor
              ? ({ ["--dot-color"]: dotColor } as React.CSSProperties)
              : undefined
          }
        >
          {rendered}
        </div>
      );
    };

    return (
      <div
        className={getMessageClassName()}
        data-message-id={message.id}
        data-role={message.role}
      >
        {message.blocks?.map((block, index) => renderBlock(block, index))}
        {isRewindTargetMessage(message) && !isQueued && (
          <div className="message-actions">
            <Tooltip text="回滚到此消息" position="bottom">
              <button
                className="message-action-btn"
                onClick={() => onRewindToMessage?.(message.id!)}
              >
                <i className="codicon codicon-history"></i>
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison for React.memo
    return (
      prev.message === next.message &&
      prev.isQueued === next.isQueued &&
      prev.onRewindToMessage === next.onRewindToMessage
    );
  },
);
Message.displayName = "Message";
