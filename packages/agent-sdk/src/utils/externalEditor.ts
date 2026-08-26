import { spawn, spawnSync } from "node:child_process";
import { logger } from "./globalLogger.js";

/**
 * External editor support for `/plan open` (aligned with Claude Code):
 * - GUI editors (code, cursor, subl, ...) open in a separate window — spawned
 *   detached so the calling process stays interactive.
 * - Terminal editors (vim, nano, ...) take over the terminal — spawned
 *   synchronously with inherited stdio.
 * - Without $EDITOR/$VISUAL, fall back to the platform default opener
 *   (win32: `start`, darwin: `open`, linux: `xdg-open`) so GUI hosts without
 *   an editor configured can still open the plan file.
 */

// Editors that open in a separate window and can be spawned detached without
// fighting the TTY for stdin. Matched on the basename so an absolute path like
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
 * Open a file in the user's external editor (or the platform default opener
 * when no editor is configured). Resolves when the editor exits (terminal
 * editors) or immediately after launch (GUI editors / platform opener).
 */
export async function openInExternalEditor(
  filePath: string,
): Promise<OpenInEditorResult> {
  const editor = getExternalEditor();

  // No editor configured: use the platform default opener.
  if (!editor) {
    try {
      const platformOpener =
        process.platform === "win32"
          ? { bin: "cmd", args: ["/c", "start", "", filePath] }
          : process.platform === "darwin"
            ? { bin: "open", args: [filePath] }
            : { bin: "xdg-open", args: [filePath] };
      const child = spawn(platformOpener.bin, platformOpener.args, {
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      child.on("error", (error) => {
        logger?.warn(`Default opener spawn failed: ${error.message}`);
      });
      child.unref();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const parts = editor.split(" ");
  const bin = parts[0];
  const editorArgs = parts.slice(1);
  if (!bin) {
    return { ok: false, error: `Invalid editor configuration: "${editor}"` };
  }

  try {
    if (isGuiEditor(editor)) {
      // GUI editor: detached, keep the calling process interactive.
      const child = spawn(bin, [...editorArgs, filePath], {
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      child.on("error", (error) => {
        // ENOENT on $EDITOR is a user-config error, not an internal bug.
        logger?.warn(`Editor spawn failed: ${error.message}`);
      });
      child.unref();
      return { ok: true };
    }

    // Terminal editor: block until it exits (takes over the terminal).
    const result = spawnSync(bin, [...editorArgs, filePath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.error) throw result.error;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
