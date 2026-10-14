/**
 * The webview's highlight.js instance, with only the languages it can be asked
 * for.
 *
 * `highlight.js/lib/common` ships ~35 languages; `EXT_LANGUAGE` (FilePane.tsx)
 * plus the fence info strings a message can carry name far fewer, and the
 * difference is 43 KB minified (158 KB → 115 KB, 52 KB → 29 KB gzipped) that a
 * page load pays for before anything renders. `lib/core` plus the set below
 * keeps every language the app declares support for; a fence in any other
 * language is not an error — FilePane guards with `hljs.getLanguage()` and
 * renders the block as plain text, which is already what an unknown fence does.
 *
 * Two things to keep true when touching this file:
 *
 * 1. **Stay in step with `EXT_LANGUAGE`.** A language named there but missing
 *    here silently loses its highlighting in the file pane — the failure looks
 *    like a styling bug, not a missing registration. `tests/utils/highlight.test.ts`
 *    pins that.
 * 2. **Aliases come from the modules.** `registerLanguage` also registers each
 *    module's own aliases (`ts`/`tsx`, `html`/`svg`, `sh`, `yml`, …), so fenced
 *    blocks keep resolving; the extension table maps to the canonical names.
 *    Languages deliberately dropped from `lib/common` (lua, perl, r, shell,
 *    graphql, wasm, …) come back with one import and one call.
 */

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/** Canonical names — the values `EXT_LANGUAGE` maps extensions onto. */
export const REGISTERED_LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "less",
  "makefile",
  "markdown",
  "php",
  "protobuf",
  "python",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "typescript",
  "xml",
  "yaml",
] as const;

const MODULES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  makefile,
  markdown,
  php,
  protobuf,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const name of REGISTERED_LANGUAGES) {
  hljs.registerLanguage(name, MODULES[name]);
}

export default hljs;
