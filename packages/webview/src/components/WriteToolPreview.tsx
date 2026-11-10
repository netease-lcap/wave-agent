import React, { useRef } from "react";
import { ExternalLinkIcon, OpenPreviewArrowIcon } from "./HeaderIcons";
import { FileToolHeader } from "./FileToolHeader";
import { Tooltip } from "./Tooltip";
import type { ToolBlock } from "../types";
import { toRelativePath } from "../utils/messageUtils";
import { isDesktopHost, isRemotePageHost } from "../utils/platform";

interface WriteToolPreviewProps {
  toolBlock: ToolBlock;
  vscode: { postMessage: (message: unknown) => void };
  workdir?: string;
  /** Host-routed open (desktop opens its file panel via ChatApp.handleOpenFile);
   *  falls back to the plain openFile RPC when absent (plugin hosts). */
  onOpenFile?: (path: string) => void;
}

export const WriteToolPreview: React.FC<WriteToolPreviewProps> = ({
  toolBlock,
  vscode,
  workdir,
  onOpenFile,
}) => {
  const openBtnRef = useRef<HTMLButtonElement>(null);
  let filePath = "";
  let content: string | null = null;
  try {
    if (toolBlock.parameters) {
      const params = JSON.parse(toolBlock.parameters);
      filePath = params.file_path || "";
      content = typeof params.content === "string" ? params.content : null;
    }
  } catch {
    content = null;
  }

  // 远控页没有编辑器/文件面板可打开路径（spec remote/remote-web.md 场景 20），
  // 但它有一条别的去处：点了就地看内容（同规格「点消息里的文件路径看内容」）
  // ——由 Message 传进来一个预览 handler。所以判据是「有没有去处」，不是
  // 「是不是本机宿主」：本机宿主可以直接发 openFile RPC，远控页必须带 handler。
  const canOpenFile = !isRemotePageHost() || !!onOpenFile;

  const openFile = () => {
    if (!filePath || !canOpenFile) return;
    if (onOpenFile) {
      onOpenFile(filePath);
      return;
    }
    vscode.postMessage({ command: "openFile", path: filePath });
  };

  const header = (
    <FileToolHeader
      toolBlock={toolBlock}
      filePath={toRelativePath(filePath, workdir)}
      onOpenFile={canOpenFile ? openFile : undefined}
    />
  );

  // 悬停提示（设计师 1109 评论：「图标的操作hover上去都应该有个提示」——这颗
  // 之前一个提示都没有，只有 `aria-label`）。桌面端用自绘 `Tooltip`：锚点用
  // `anchorRef` 直接指按钮本身，包裹层靠 CSS `display: contents` 不生成盒子
  // ——按钮是 `position: absolute`（Message.css `.write-preview-open`），包裹层
  // 一旦有盒子就成了它的包含块，按钮会跑到盒子内衬里。插件端保持原样（不包裹、
  // 不加 title，零改动）。
  // 图标（设计师 2026-11-10 评论：「图标的粗细要保持一致」）——桌面端换成与复制
  // 图标同一档 1.4 描边的箭头（`OpenPreviewArrowIcon`），外框仍是 16×16、墨迹尺寸
  // 与改前那颗实心箭头一致，只把「粗细」拉齐；插件端保留原实心字形零改动。
  const openButton = (
    <button
      ref={openBtnRef}
      className="write-preview-open"
      aria-label="打开预览"
      data-testid="write-preview-open"
      onClick={openFile}
    >
      {isDesktopHost() ? (
        <OpenPreviewArrowIcon className="write-preview-open-icon" />
      ) : (
        <ExternalLinkIcon className="write-preview-open-icon" />
      )}
    </button>
  );

  if (content === null) {
    return <div className="write-tool-preview">{header}</div>;
  }

  return (
    <div className="write-tool-preview">
      {header}
      {toolBlock.shortResult && (
        <div className="write-tool-stats">{toolBlock.shortResult}</div>
      )}
      <div className="write-preview-box">
        {/* tabIndex（F-10 / WCAG 2.1.1）：max-height 120 + overflow-y:auto 是
            可滚动区域，键盘用户需能聚焦后用方向键翻看完整写入内容。
            仅桌面端注入——焦点环样式只存在于 `[data-host="desktop"]` 层。 */}
        <div
          className="write-preview-scroll"
          tabIndex={isDesktopHost() ? 0 : undefined}
        >
          <pre className="write-preview-content">{content}</pre>
        </div>
        {canOpenFile && (
          <>
            <div className="write-preview-scrim" />
            {isDesktopHost() ? (
              <Tooltip
                text="打开预览"
                position="bottom"
                className="icon-action-tooltip"
                anchorRef={openBtnRef}
              >
                {openButton}
              </Tooltip>
            ) : (
              openButton
            )}
          </>
        )}
      </div>
    </div>
  );
};
