/**
 * File-panel auto-refresh helpers (spec: 文件面板自动刷新).
 *
 * The desktop file panel re-reads its open file when the agent finishes a
 * Write/Edit on it. This module keeps the detection pure so it can be unit
 * tested: which tool blocks count as completed Write/Edit calls, and whether
 * a tool's target path refers to the file currently shown in the panel.
 */

import { EDIT_TOOL_NAME, WRITE_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message, ToolBlock } from "../types";
import { normalizeFilePath } from "./messageUtils";

/** A Write/Edit tool block in a message, with the path it targets (raw). */
export interface WriteEditBlockRef {
  messageId: string;
  blockId: string;
  stage: ToolBlock["stage"];
  success: boolean | undefined;
  targetPath: string | undefined;
}

const isWriteEditTool = (b: ToolBlock): boolean =>
  b.name === WRITE_TOOL_NAME || b.name === EDIT_TOOL_NAME;

/** Extract the tool's target file path from its parameters (raw, may be relative). */
export const extractToolTargetPath = (b: ToolBlock): string | undefined => {
  if (!b.parameters) return undefined;
  try {
    const params = JSON.parse(b.parameters) as Record<string, unknown>;
    const p = params.file_path;
    return typeof p === "string" && p ? p : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 生成产物里「文档类」的扩展名（spec desktop/desktop-artifacts.md「对话中的
 * 生成文件卡片」场景 1）：应用内不能在预览面板渲染的文档，桌面端直接开文件
 * 面板查看。页面文件（`.html`/`.htm`）不在这里 —— 它们走预览面板。
 */
export const GENERATED_DOC_EXT = /\.(md|markdown|docx?|xlsx?|pptx?|pdf)$/i;

/** All Write/Edit tool blocks across the given messages (any stage). */
export const collectWriteEditBlocks = (
  messages: Message[],
): WriteEditBlockRef[] => {
  const out: WriteEditBlockRef[] = [];
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type !== "tool" || !b.id || !isWriteEditTool(b)) continue;
      out.push({
        messageId: m.id ?? "",
        blockId: b.id,
        stage: b.stage,
        success: b.success,
        targetPath: extractToolTargetPath(b),
      });
    }
  }
  return out;
};

const normalize = (p: string) => p.replace(/\\/g, "/");

/** Resolve a possibly-relative path against the session workdir (string-only;
    browser has no node path, and remote paths are not local disk paths).
    The result is normalized (`.` / `..` folded) so the panel's opened path —
    which carries a workdir-merged, normalized path — and a tool path written
    as `../x.ts` still compare equal (desktop-file-panel spec 场景 7). */
const toAbsolute = (p: string, workdir: string): string => {
  const n = normalize(p);
  if (n.startsWith("/") || /^[a-zA-Z]:\//.test(n)) return normalizeFilePath(n);
  return normalizeFilePath(`${normalize(workdir).replace(/\/+$/, "")}/${n}`);
};

/**
 * Whether a tool target path refers to the panel's open file. Matches on the
 * raw spelling first (the same session usually writes a path the same way it
 * clicked it), then falls back to resolving both against the workdir so a
 * relative tool path and an absolute panel path still line up.
 */
export const pathsMatch = (
  toolPath: string,
  panelPath: string,
  workdir?: string,
): boolean => {
  if (normalize(toolPath) === normalize(panelPath)) return true;
  if (!workdir) return false;
  return toAbsolute(toolPath, workdir) === toAbsolute(panelPath, workdir);
};
