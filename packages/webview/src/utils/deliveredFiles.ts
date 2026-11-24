import {
  classifyDeliverablePath,
  type DeliverableKind,
} from "wave-agent-sdk/constants";
import type { ToolBlock } from "wave-agent-sdk/types";

/** One file a `SendUserFile` result carries, ready to render. */
export interface DeliveredFile {
  /** Absolute path, as the tool reported it. */
  path: string;
  /** Base name — the label, and what survives when the path is elided. */
  name: string;
  kind: DeliverableKind;
}

export interface DeliveredFiles {
  files: DeliveredFile[];
  caption?: string;
}

const KINDS: readonly string[] = ["text", "image", "other"];

function kindOf(value: unknown, path: string): DeliverableKind {
  return typeof value === "string" && KINDS.includes(value)
    ? (value as DeliverableKind)
    : classifyDeliverablePath(path);
}

function pushFile(files: DeliveredFile[], entry: unknown): void {
  if (!entry || typeof entry !== "object") return;
  const item = entry as Record<string, unknown>;
  const path = typeof item.path === "string" ? item.path : "";
  if (!path) return;
  const name =
    typeof item.name === "string" && item.name
      ? item.name
      : path.split(/[\\/]/).pop() || path;
  files.push({ path, name, kind: kindOf(item.kind, path) });
}

/**
 * Read the structured list a `SendUserFile` result attached.
 *
 * 阶段 2 起工具把这份列表写进 `ToolBlock.data`（`data.attachments`，形状对齐
 * Claude Code 的 `SendUserFile` outputSchema），`ToolBlock.metadata`
 * （`metadata.files`）只剩读老转录的向前兼容通道 —— 新转录里没有那个键。
 *
 * Every field is re-derived defensively: an older SDK, a hand-edited transcript or a
 * tool that changed its shape must degrade to "render what we can", never to a crash.
 *
 * `kind` falls back to {@link classifyDeliverablePath} — the same classifier the
 * tool used — so a missing/unknown value still routes the click correctly rather
 * than dumping a PDF into the text preview.
 */
export function readDeliveredFiles(toolBlock: ToolBlock): DeliveredFiles {
  const data =
    toolBlock.data && typeof toolBlock.data === "object"
      ? (toolBlock.data as Record<string, unknown>)
      : {};
  const legacy = toolBlock.metadata ?? {};
  const entries = Array.isArray(data.attachments)
    ? data.attachments
    : Array.isArray(legacy.files)
      ? legacy.files
      : [];

  const files: DeliveredFile[] = [];
  for (const entry of entries) pushFile(files, entry);

  const caption =
    typeof data.caption === "string" && data.caption
      ? data.caption
      : typeof legacy.caption === "string" && legacy.caption
        ? legacy.caption
        : undefined;

  return { files, caption };
}
