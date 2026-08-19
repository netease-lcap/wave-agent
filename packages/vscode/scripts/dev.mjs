#!/usr/bin/env node
/**
 * dev — cross-platform launcher for `pnpm run vsce:run`.
 *
 * The previous one-liner (`LOG_LEVEL=DEBUG code --extensionDevelopmentPath=$(pwd)/...`)
 * used POSIX-only syntax: on Windows pnpm executes scripts with cmd.exe, which
 * has no `LOG_LEVEL=...` env prefix and no `$(pwd)`, so the command failed.
 * This launcher resolves the extension root from its own path and sets the
 * log level in-process.
 *
 * The `code` CLI is a `.cmd` shim on Windows. cmd only PATH-searches *unquoted*
 * command names and Node refuses to spawn `.cmd` without a shell (since the
 * CVE-2024-27980 patch), so Windows runs the whole command line through
 * cmd.exe with the path quoted; other platforms spawn the binary directly.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, LOG_LEVEL: "DEBUG" };

const child =
  process.platform === "win32"
    ? spawn(
        `code --extensionDevelopmentPath ${JSON.stringify(extRoot)} --new-window`,
        { stdio: "inherit", shell: true, env },
      )
    : spawn(
        "code",
        ["--extensionDevelopmentPath", extRoot, "--new-window"],
        { stdio: "inherit", env },
      );

child.on("exit", (code) => process.exit(code ?? 0));
