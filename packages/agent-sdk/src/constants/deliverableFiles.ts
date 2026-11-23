/**
 * Classification shared by three consumers that must never disagree: the
 * `SendUserFile` tool (what `kind` a delivered file gets), the hosts' open
 * gates (desktop `handleOpenPath`, VS Code `openFile`), and the webview's click
 * routing (spec core/send-user-file-tool.md).
 *
 * Everything here is pure string work on purpose: the webview imports this
 * module through the node-free `wave-agent-sdk/constants` entry, so no `path`
 * import may creep in.
 */

import { isImageFileExtension } from "./images.js";

/** How a delivered file should be opened when the user clicks its path. */
export type DeliverableKind =
  /** Text-shaped files: docs, code, config, logs. Opened by the editor/preview. */
  | "text"
  /** Images: the existing image preview path. */
  | "image"
  /**
   * Anything else (pdf, docx, zip, video…): the OS default app, local hosts only.
   * Executables live here too — the classification does not single them out;
   * the host refuses to launch them at open time (`isBlockedExecutablePath`),
   * so the judgement stays in one place and the UI never has to guess.
   */
  | "other";

/**
 * Extensions (without the dot) this product treats as text.
 *
 * Deliberately a whitelist, not "everything that is not binary": an unknown
 * extension is safer routed to the OS (a real app opens it correctly or fails
 * visibly) than dumped into a text preview as mojibake.
 */
export const TEXT_FILE_EXTENSIONS = [
  // documents
  "md",
  "markdown",
  "mdx",
  "txt",
  "text",
  "log",
  "rst",
  "adoc",
  "org",
  "tex",
  "csv",
  "tsv",
  // data & configuration
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "env",
  "xml",
  "plist",
  "lock",
  // markup & styling
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "styl",
  "svg",
  // scripting
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "psm1",
  "bat",
  "cmd",
  "py",
  "rb",
  "php",
  "pl",
  "lua",
  "r",
  "jl",
  "dart",
  "ex",
  "exs",
  "erl",
  "hs",
  "clj",
  "zig",
  "nim",
  // compiled languages
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hh",
  "cs",
  "fs",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "m",
  "mm",
  "groovy",
  // web
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "astro",
  // query & schema
  "sql",
  "graphql",
  "gql",
  "proto",
  "diff",
  "patch",
] as const;

/**
 * Extension-less text files (dotfiles too). `Dockerfile` / `Makefile` have no
 * dots at all, so an extension test alone would route them to the OS opener.
 */
export const TEXT_FILE_NAMES = [
  "dockerfile",
  "makefile",
  "cmakelists.txt",
  "gemfile",
  "rakefile",
  "procfile",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".npmrc",
  ".prettierrc",
] as const;

/**
 * Extensions whose OS handler *runs* something (or installs it). A delivered
 * path carrying one of these is shown but never opened — see spec
 * core/send-user-file-tool.md 用户故事「可执行文件不让打开」.
 *
 * `sh` / `bat` / `ps1` / `js` are deliberately absent: they are in the text
 * whitelist above, so they open in the editor (which does not execute them) and
 * never reach the OS opener. Listing them here would only turn "look at this
 * script" into a refusal.
 */
export const BLOCKED_EXECUTABLE_EXTENSIONS = [
  "exe",
  "msi",
  "msp",
  "msc",
  "com",
  "scr",
  "cpl",
  "vbs",
  "vbe",
  "jse",
  "wsf",
  "wsh",
  "hta",
  "lnk",
  "url",
  "reg",
  "inf",
  "app",
  "command",
  "workflow",
  "scpt",
  "pkg",
  "dmg",
  "run",
  "bin",
  "appimage",
  "desktop",
  "deb",
  "rpm",
  "apk",
] as const;

/**
 * Lowercased extension without the dot, or `""` when the name has none.
 *
 * `dot <= 0` treats a leading dot as "no extension": `.gitignore` is a name,
 * not a file of type "gitignore" — those are covered by {@link TEXT_FILE_NAMES}.
 */
export function extensionOfPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Base file name of a path written with either separator. */
export function fileNameOfPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** True when the OS handler for this file would execute or install something. */
export function isBlockedExecutablePath(filePath: string): boolean {
  const ext = extensionOfPath(filePath);
  return (BLOCKED_EXECUTABLE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Which click behaviour a delivered file gets.
 *
 * Order matters: text first. A `.sh` is text (opened in the editor, never
 * executed); a `.exe` falls into `other` like any pdf or zip, and the host's
 * opener is what refuses to launch it. Images are checked here rather than at
 * the call site so all consumers agree on the `kind` string.
 */
export function classifyDeliverablePath(filePath: string): DeliverableKind {
  const ext = extensionOfPath(filePath);
  const base = fileNameOfPath(filePath).toLowerCase();
  // Imported lazily-shaped: keep the image dictionary itself in images.ts.
  if (isTextLike(ext, base)) return "text";
  if (isImageFileExtension(ext)) return "image";
  return "other";
}

function isTextLike(ext: string, base: string): boolean {
  if ((TEXT_FILE_EXTENSIONS as readonly string[]).includes(ext)) return true;
  return (TEXT_FILE_NAMES as readonly string[]).includes(base);
}
