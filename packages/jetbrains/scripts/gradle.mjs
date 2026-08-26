#!/usr/bin/env node
/**
 * gradle — cross-platform launcher for the JetBrains Gradle wrapper.
 *
 * The previous scripts used a POSIX path (`./packages/jetbrains/gradlew`): on
 * Windows pnpm executes scripts with cmd.exe, which does not PATHEXT-append
 * commands that carry a path prefix, so the extension-less `gradlew` shell
 * script failed with `'.' 不是内部或外部命令`. This launcher resolves the
 * wrapper from its own location, runs it with cwd = packages/jetbrains (no
 * `-p` needed), and picks `gradlew.bat` on Windows — where Node refuses to
 * spawn `.bat` without a shell since the CVE-2024-27980 patch, see
 * packages/vscode/scripts/dev.mjs for the same pattern.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const jbRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const child =
  process.platform === "win32"
    ? spawn(path.join(jbRoot, "gradlew.bat"), args, {
        cwd: jbRoot,
        stdio: "inherit",
        shell: true,
      })
    : spawn(path.join(jbRoot, "gradlew"), args, {
        cwd: jbRoot,
        stdio: "inherit",
      });

child.on("exit", (code) => process.exit(code ?? 0));
