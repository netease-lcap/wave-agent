/**
 * Session-level shell snapshot — the user's shell config captured once per
 * (shell, temp dir) pair, so later commands can `. <file>` instead of paying a
 * login-shell startup each.
 *
 * Why it exists: `bashProvider` must not run `<shell> -c -l` per command (a
 * shell startup and the rc's own output per command — see
 * `docs/specs/core/bash-tools.md`「登录 shell 环境注入」), yet a plain `-c` shell
 * knows nothing about the user's functions, options or aliases. One login shell
 * therefore writes those three things to a file and every command sources it.
 * Claude Code ships the same mechanism (`shell-snapshots/`) and the generated
 * script follows its shape: functions (completion helpers skipped), shell
 * options, aliases.
 *
 * Failure is not fatal and never retried: a shell with a broken or hanging rc
 * yields `undefined` and `bashProvider` falls back to the plain `-c` command it
 * produced before this module existed. Nothing here may throw, reach a
 * command's output, or run at module scope (the SDK's side-effect ban).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileAsyncHidden } from "../execFileHidden.js";

/** A broken rc must not stall the session's first command. */
const SNAPSHOT_TIMEOUT_MS = 10_000;
/** Directory (inside the SDK scratch dir) the snapshots live in. */
const SNAPSHOT_DIR = "wave-shell-snapshots";

/** One promise per (shell, temp dir): a session never builds the same one twice. */
const snapshots = new Map<string, Promise<string | undefined>>();
/** Files to remove when the process exits. */
const generated = new Set<string>();
let cleanupRegistered = false;

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  // `exit` is the last moment synchronous cleanup is still allowed. Most
  // platforms clean their temp dirs anyway, so a missed file is not a leak.
  process.once("exit", () => {
    for (const file of generated) {
      try {
        fs.unlinkSync(file);
      } catch {
        // already gone
      }
    }
  });
}

/** `zsh`, `bash`, or `undefined` for a shell this mechanism does not cover. */
export function snapshotShellKind(
  shellPath: string,
): "bash" | "zsh" | undefined {
  const name = path.basename(shellPath).toLowerCase();
  if (name.includes("zsh")) return "zsh";
  if (name.includes("bash")) return "bash";
  return undefined;
}

/** The user's startup file, only when it exists. */
function rcFile(kind: "bash" | "zsh"): string | undefined {
  const candidate = path.join(
    os.homedir(),
    kind === "zsh" ? ".zshrc" : ".bashrc",
  );
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** A path as exactly one shell word. */
function quoteWord(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function snapshotScript(
  kind: "bash" | "zsh",
  file: string,
  rc: string | undefined,
): string {
  // zsh only reads `.zshrc` for interactive shells and this one is not one, so
  // the rc has to be sourced explicitly. A failing rc must not abort the
  // script: whatever it defined before it failed is still worth keeping.
  const lines: string[] = [`SNAPSHOT_FILE=${quoteWord(file)}`];
  if (rc) {
    lines.push(
      `[ -f ${quoteWord(rc)} ] && . ${quoteWord(rc)} >/dev/null 2>&1 || true`,
    );
  }

  // Functions. Names starting with a single underscore are completion helpers
  // (thousands of them under oh-my-zsh); double-underscore helpers such as
  // mise's `__zsh_like_cd` are real functions and stay.
  lines.push(
    `echo '# Functions' >> "$SNAPSHOT_FILE"`,
    kind === "zsh"
      ? [
          "typeset -f >/dev/null 2>&1",
          `typeset +f | grep -vE '^_[^_]' | while read -r _wave_fn; do typeset -f "$_wave_fn" >> "$SNAPSHOT_FILE"; done`,
        ].join("\n")
      : [
          "declare -f >/dev/null 2>&1",
          `declare -F | cut -d' ' -f3 | grep -vE '^_[^_]' | while read -r _wave_fn; do declare -f "$_wave_fn" >> "$SNAPSHOT_FILE"; done`,
        ].join("\n"),
  );

  // Shell options. `setopt` prints only the options that are set, and each line
  // is a valid `setopt <name>`; bash needs `shopt -p` plus `set -o`, and
  // `expand_aliases` is what makes the aliases below work at all in a
  // non-interactive shell.
  lines.push(
    `echo '# Options' >> "$SNAPSHOT_FILE"`,
    kind === "zsh"
      ? `setopt | sed 's/^/setopt /' | head -n 1000 >> "$SNAPSHOT_FILE"`
      : [
          `shopt -p | head -n 1000 >> "$SNAPSHOT_FILE"`,
          `set -o | grep 'on' | awk '{print "set -o " $1}' | head -n 1000 >> "$SNAPSHOT_FILE"`,
          `echo 'shopt -s expand_aliases' >> "$SNAPSHOT_FILE"`,
        ].join("\n"),
  );

  // Aliases. Both shells print something the shell can read back as-is (zsh:
  // `name='value'`, bash: `alias name='value'`). Git Bash auto-creates `winpty`
  // aliases that fail without a TTY, so those are dropped on msys/cygwin.
  lines.push(
    `echo '# Aliases' >> "$SNAPSHOT_FILE"`,
    `if [ "$OSTYPE" = "msys" ] || [ "$OSTYPE" = "cygwin" ]; then alias | grep -v "='winpty " | head -n 1000 >> "$SNAPSHOT_FILE"; else alias | head -n 1000 >> "$SNAPSHOT_FILE"; fi`,
  );

  return lines.join("\n");
}

async function createSnapshot(
  shellPath: string,
  kind: "bash" | "zsh",
  tempDir: string,
): Promise<string | undefined> {
  const dir = path.join(tempDir, SNAPSHOT_DIR);
  const file = path.join(
    dir,
    `snapshot-${kind}-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.sh`,
  );
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await execFileAsyncHidden(
      shellPath,
      ["-l", "-c", snapshotScript(kind, file, rcFile(kind))],
      {
        timeout: SNAPSHOT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        // Same noise guard as the host's login-shell probe: auto-update, the
        // completion audit and askpass prompts are all able to hang or slow a
        // startup file down, and none of them belong in a snapshot.
        env: {
          ...process.env,
          DISABLE_AUTO_UPDATE: "true",
          ZSH_DISABLE_COMPFIX: "true",
          SSH_ASKPASS_REQUIRE: "never",
          DBUS_SESSION_BUS_ADDRESS: "disabled:",
        },
      },
    );
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size === 0) return undefined;
  } catch {
    // Timeout, missing shell, unwritable temp dir, rc killed the shell: all
    // the same outcome here — no snapshot, commands run as before.
    try {
      await fs.promises.unlink(file);
    } catch {
      // nothing was written
    }
    return undefined;
  }
  registerCleanup();
  generated.add(file);
  return file;
}

/**
 * Path of the session's snapshot for [shellPath], or `undefined` when the shell
 * is not bash/zsh or the snapshot could not be built. The result is cached:
 * a failed snapshot is not retried, and a successful one is created once per
 * (shell, temp dir) — the sandbox's own temp dir therefore gets its own file.
 */
export function getShellSnapshot(
  shellPath: string,
  tempDir: string,
): Promise<string | undefined> {
  const kind = snapshotShellKind(shellPath);
  if (!kind) return Promise.resolve(undefined);
  const key = `${shellPath}\u0000${tempDir}`;
  const cached = snapshots.get(key);
  if (cached) return cached;
  const task = createSnapshot(shellPath, kind, tempDir).catch(() => undefined);
  snapshots.set(key, task);
  return task;
}
