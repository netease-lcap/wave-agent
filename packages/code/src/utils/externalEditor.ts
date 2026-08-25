import { spawn, spawnSync } from "node:child_process";
import { logger } from "./logger.js";

/**
 * External editor support for `/plan open` (aligned with Claude Code):
 * - GUI editors (code, cursor, subl, ...) open in a separate window — spawned
 *   detached, the CLI stays interactive.
 * - Terminal editors (vim, nano, ...) take over the terminal — handed off via
 *   Ink's suspendTerminal (raw mode off, rendering paused) and restored on exit.
 */

// Ink render() instance (registered by cli.tsx). Used for the terminal-editor
// handoff. Null in stdio/daemon contexts where there is no Ink UI.
type InkInstanceLike = {
  suspendTerminal(callback: () => void | Promise<void>): Promise<void>;
};

let inkInstance: InkInstanceLike | null = null;

export function registerInkInstance(instance: InkInstanceLike | null): void {
  inkInstance = instance;
}

// Editors that open in a separate window and can be spawned detached without
// fighting the TUI for stdin. Matched on the basename so an absolute path like
// /usr/bin/code still classifies as GUI.
const GUI_EDITORS = [
  "code",
  "cursor",
  "windsurf",
  "codium",
  "subl",
  "atom",
  "gedit",
  "notepad++",
  "notepad",
];

export function getExternalEditor(): string | undefined {
  return process.env.VISUAL || process.env.EDITOR || undefined;
}

function isGuiEditor(editor: string): boolean {
  const base = editor.split(" ")[0]?.split(/[\\/]/).pop() ?? "";
  return GUI_EDITORS.some((g) => base.includes(g));
}

export type OpenInEditorResult = { ok: true } | { ok: false; error: string };

/**
 * Open a file in the user's external editor. Resolves when the editor exits
 * (terminal editors) or immediately after launch (GUI editors).
 */
export async function openInExternalEditor(
  filePath: string,
): Promise<OpenInEditorResult> {
  const editor = getExternalEditor();
  if (!editor) {
    return {
      ok: false,
      error: "No external editor found. Set $EDITOR or $VISUAL.",
    };
  }

  const parts = editor.split(" ");
  const bin = parts[0];
  const editorArgs = parts.slice(1);
  if (!bin) {
    return { ok: false, error: `Invalid editor configuration: "${editor}"` };
  }

  try {
    if (isGuiEditor(editor)) {
      // GUI editor: detached, keep the CLI interactive.
      const child = spawn(bin, [...editorArgs, filePath], {
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      child.on("error", (error) => {
        // ENOENT on $EDITOR is a user-config error, not an internal bug.
        logger.warn(`Editor spawn failed: ${error.message}`);
      });
      child.unref();
      return { ok: true };
    }

    // Terminal editor: block until it exits, handing the terminal over via
    // Ink's suspendTerminal so raw mode / rendering are restored afterwards.
    const run = (): void => {
      const result = spawnSync(bin, [...editorArgs, filePath], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (result.error) throw result.error;
    };
    if (inkInstance) {
      await inkInstance.suspendTerminal(run);
    } else {
      run();
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
