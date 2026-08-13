#!/usr/bin/env node
/**
 * dev — cross-platform launcher for `pnpm run dev`.
 *
 * The previous one-liner (`env -u ELECTRON_RUN_AS_NODE electron .`) used
 * POSIX-only syntax: on Windows pnpm executes scripts with cmd.exe, which has
 * no `env`, so the command failed. Unsetting the variable in-process works
 * everywhere — with ELECTRON_RUN_AS_NODE=1 (set whenever Electron runs a node
 * script, e.g. via the binary resolver) Electron would start in Node mode
 * instead of showing the app window.
 */
import { spawn } from "node:child_process";
import electron from "electron";

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [".", "--no-sandbox"], { stdio: "inherit" });

child.on("exit", (code) => process.exit(code ?? 0));
