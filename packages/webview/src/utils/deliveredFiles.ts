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

/**
 * Read the structured list a `SendUserFile` result attached (`ToolBlock.metadata`,
 * written by the tool). Every field is re-derived defensively: an older SDK, a
 * hand-edited transcript or a tool that changed its shape must degrade to
 * "render what we can", never to a crash.
 *
 * `kind` falls back to {@link classifyDeliverablePath} — the same classifier the
 * tool used — so a missing/unknown value still routes the click correctly rather
 * than dumping a PDF into the text preview.
 */
export function readDeliveredFiles(toolBlock: ToolBlock): DeliveredFiles {
  const metadata = toolBlock.metadata;
  const record =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  const entries = Array.isArray(record.files) ? record.files : [];

  const files: DeliveredFile[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const path = typeof item.path === "string" ? item.path : "";
    if (!path) continue;
    const name =
      typeof item.name === "string" && item.name
        ? item.name
        : path.split(/[\\/]/).pop() || path;
    const kind =
      typeof item.kind === "string" && KINDS.includes(item.kind)
        ? (item.kind as DeliverableKind)
        : classifyDeliverablePath(path);
    files.push({ path, name, kind });
  }

  return {
    files,
    caption:
      typeof record.caption === "string" && record.caption
        ? record.caption
        : undefined,
  };
}
