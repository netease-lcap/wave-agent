/**
 * Enterprise knowledge base availability.
 *
 * The knowledge base adds three retrieval tools (`kb_search` / `kb_get_doc` /
 * `kb_suggest`) whose answers come from the documents the user's enterprise has
 * uploaded. Turning it on does not merely add a function: any of those documents
 * can then be pulled into any conversation's context. That is a widening of what
 * the agent can see, so — like `REMOTE_CONTROL_DEFAULT_ENABLED` and first-party
 * telemetry, where 上线 ≠ 默认打开 — the capability ships usable while the default
 * stays off, and someone has to opt in: `enableKnowledgeBase: true` in
 * settings.json, or the same key in the managed layer
 * (`GET /api/wave/settings`). Leaving the key unset keeps it closed, which is
 * also why nothing downstream has to cope with "the enterprise has no documents
 * yet" — the model never learns the tools exist.
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";

/** Code default for knowledge-base availability. */
export const KNOWLEDGE_BASE_TOOLS_DEFAULT_ENABLED = false;

/**
 * What a settings read that throws counts as.
 *
 * Deliberately independent of the default: the verdict decides whether
 * enterprise documents become reachable from a conversation, so a broken
 * settings file must read as "off", never as "on" and never as a crash. Keeping
 * it its own constant is what lets the default flip without silently turning
 * read failures into an enable.
 */
const SETTINGS_READ_FAILURE_ENABLED = false;

/**
 * Whether the three knowledge-base tools should be registered for `workdir`.
 * Resolution order: remote managed settings (`enableKnowledgeBase` from
 * `GET /api/wave/settings`, admin override) → explicit `enableKnowledgeBase` in
 * local merged settings → code default (off).
 *
 * `workdir` is the directory the session was opened in — the project layer of
 * the merged config is read from there. Callers pass the session's own start
 * directory, never the shell's current directory: a `cd` must not move which
 * settings file decides this.
 *
 * A key that is present but not a real boolean counts as unset, never as "on"
 * (`"true"`, `1`, `null` are all junk in a settings file someone hand-edited).
 */
export function isKnowledgeBaseEnabled(workdir?: string): boolean {
  try {
    const managed = readBooleanFlag(
      getRemoteSettingsSync()?.enableKnowledgeBase,
    );
    if (managed !== undefined) {
      return managed;
    }
    if (workdir) {
      const local = readBooleanFlag(
        loadMergedWaveConfig(workdir)?.enableKnowledgeBase,
      );
      if (local !== undefined) {
        return local;
      }
    }
  } catch {
    return SETTINGS_READ_FAILURE_ENABLED;
  }
  return KNOWLEDGE_BASE_TOOLS_DEFAULT_ENABLED;
}

/** `true` / `false` when the value is a real boolean, `undefined` otherwise. */
function readBooleanFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
