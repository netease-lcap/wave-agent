/**
 * Programming language of a file path, for the `language` attribute of
 * `wave.code_edit_tool.decision`.
 *
 * The attribute is a low-cardinality enum, so this is a closed table rather
 * than a dependency: the SDK must not pull a syntax highlighter (highlight.js
 * lives in the UI packages) just to name a language, and a table keeps the set
 * of exported values stable across releases. An extension the table does not
 * know yields no attribute at all — a collector never sees "unknown", and the
 * file path itself is never exported.
 */

/** File name → language, for files identified by name rather than extension. */
const FILE_NAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  rakefile: "ruby",
  gemfile: "ruby",
  brewfile: "ruby",
  procfile: "procfile",
};

/** Lowercase extension (without the dot) → language. */
const EXTENSIONS: Record<string, string> = {
  bash: "shell",
  c: "c",
  cc: "cpp",
  cfg: "ini",
  clj: "clojure",
  cljs: "clojure",
  cmake: "cmake",
  coffee: "coffeescript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  el: "lisp",
  erb: "erb",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fish: "shell",
  go: "go",
  gradle: "groovy",
  graphql: "graphql",
  groovy: "groovy",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  hs: "haskell",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  m: "objectivec",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mm: "objectivec",
  mts: "typescript",
  php: "php",
  pl: "perl",
  proto: "protobuf",
  ps1: "powershell",
  py: "python",
  pyi: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "sass",
  scala: "scala",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  tf: "terraform",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "text",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zsh: "shell",
};

/** Just the final segment of either separator — the tool input may be POSIX or Windows. */
function baseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

/**
 * The language of a file path, or undefined when it cannot be named.
 *
 * Only the extension is read: the path never leaves the process.
 */
export function languageFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;

  const name = baseName(filePath).toLowerCase();
  if (!name) return undefined;

  const byName = FILE_NAMES[name];
  if (byName) return byName;

  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return EXTENSIONS[name.slice(dot + 1)];
}
