import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { USER_MEMORY_FILE, DATA_DIRECTORY } from "../utils/constants.js";
import { logger } from "../utils/globalLogger.js";
import { serializeError } from "../utils/errorUtils.js";
import { atomicWriteFile } from "../utils/atomicWrite.js";
import { Container } from "../utils/container.js";
import { getGitCommonDir } from "../utils/gitUtils.js";
import { pathEncoder } from "../utils/pathEncoder.js";
import { MEMORY_ENTRYPOINT_NAME } from "../constants/memory.js";
import { truncateEntrypointContent } from "../utils/memoryEntrypoint.js";
import {
  buildMemoryEntrypoint,
  scanMemoryFiles,
} from "../utils/memoryIndex.js";

/**
 * Trust tier of the memory file whose `@include` references are being
 * expanded. Only the project tier is scoped — see `isOutsideWorkdir`.
 */
export type MemoryIncludeTier = "user" | "project" | "local";

/** Hard cap on `@include` recursion; the memory file itself is depth 0. */
export const MAX_MEMORY_INCLUDE_DEPTH = 5;

/** A single `@include` target larger than this is skipped, not injected. */
export const MAX_MEMORY_INCLUDE_BYTES = 64 * 1024;

/**
 * Total `@include` content one memory load may inject. The per-file cap alone
 * still lets a memory file point at a dozen 60 KB files; this bounds the whole
 * expansion instead. Everything past it is skipped with a note.
 */
export const MAX_MEMORY_INCLUDE_TOTAL_BYTES = 512 * 1024;

/**
 * Extensions an `@include` may point at (the same set Claude Code accepts as
 * `TEXT_FILE_EXTENSIONS`). Anything else — images, PDFs, binaries, and paths
 * without an extension — is skipped so memory cannot be used to slurp bytes
 * into the context window.
 */
const TEXT_FILE_EXTENSIONS = new Set([
  // Markdown and text
  ".md",
  ".txt",
  ".text",
  // Data formats
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  // Web
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  // JavaScript/TypeScript
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  // Python
  ".py",
  ".pyi",
  ".pyw",
  // Ruby
  ".rb",
  ".erb",
  ".rake",
  // Go
  ".go",
  // Rust
  ".rs",
  // Java/Kotlin/Scala
  ".java",
  ".kt",
  ".kts",
  ".scala",
  // C/C++
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".hxx",
  // C#
  ".cs",
  // Swift
  ".swift",
  // Shell
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  // Config
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".config",
  ".properties",
  // Database
  ".sql",
  ".graphql",
  ".gql",
  // Protocol
  ".proto",
  // Frontend frameworks
  ".vue",
  ".svelte",
  ".astro",
  // Templating
  ".ejs",
  ".hbs",
  ".pug",
  ".jade",
  // Other languages
  ".php",
  ".pl",
  ".pm",
  ".lua",
  ".r",
  ".R",
  ".dart",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".cljc",
  ".edn",
  ".hs",
  ".lhs",
  ".elm",
  ".ml",
  ".mli",
  ".f",
  ".f90",
  ".f95",
  ".for",
  // Build files
  ".cmake",
  ".make",
  ".makefile",
  ".gradle",
  ".sbt",
  // Documentation
  ".rst",
  ".adoc",
  ".asciidoc",
  ".org",
  ".tex",
  ".latex",
  // Lock files (often text-based)
  ".lock",
  // Misc
  ".log",
  ".diff",
  ".patch",
]);

/** One `@path` occurrence: the span in the content plus the raw path text. */
type IncludeReference = { start: number; end: number; rawPath: string };

/**
 * Scope shared by every memory file expanded in one memory load (the project,
 * user and personal layers of one combined read). Sharing it is what makes
 * "each file expands at most once" and the total byte budget hold across the
 * whole load instead of per layer.
 */
type MemoryIncludeLoad = {
  /** Real paths that already expanded in this load. */
  seen: Set<string>;
  /** Bytes of included file content injected so far in this load. */
  expandedBytes: number;
};

/** One memory file's expansion context: the shared load scope plus its tier. */
type MemoryIncludeState = {
  tier: MemoryIncludeTier;
  /**
   * Boundary for the `project` tier, and a fallback base for the source marker.
   * `null` for the user-level file, which belongs to no project.
   */
  workdir: string | null;
  load: MemoryIncludeLoad;
  /** Memoized `realpath(workdir)` — the trust check runs on real paths. */
  workdirRealPath?: string;
};

/**
 * Outcome of reading one memory layer off disk, before any `@include`
 * expansion. `missing` is a layer that simply has no file; `error` is a read
 * that failed (already logged) and must not be cached, so the next read
 * retries instead of pinning an empty memory.
 */
type MemorySource =
  | { kind: "content"; content: string; filePath: string }
  | { kind: "missing" }
  | { kind: "error" };

function createMemoryIncludeLoad(): MemoryIncludeLoad {
  return { seen: new Set<string>(), expandedBytes: 0 };
}

function createMemoryIncludeState(
  tier: MemoryIncludeTier,
  workdir: string | null,
  load: MemoryIncludeLoad,
): MemoryIncludeState {
  return { tier, workdir, load };
}

/** `fs.realpath`, or `null` when the path cannot be canonicalized. */
async function canonicalPathOrNull(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

/** A line of the memory file, with its blockquote markers counted out. */
type MarkdownLine = {
  /** Offset of the line's first character. */
  start: number;
  /** Offset just past the line's last character (before the newline). */
  end: number;
  /** The line with leading `>` markers stripped, for block-level lookahead. */
  prose: string;
};

/** A line opening or continuing an indented code block (≥4 spaces or a tab). */
const INDENTED_CODE_LINE = /^(?: {4}|\t)/;

function splitMarkdownLines(content: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  for (;;) {
    const newlineIndex = content.indexOf("\n", start);
    const end = newlineIndex === -1 ? content.length : newlineIndex;
    lines.push({
      start,
      end,
      prose: stripBlockquoteMarkers(content.slice(start, end)),
    });
    if (newlineIndex === -1) return lines;
    start = newlineIndex + 1;
  }
}

/**
 * Remove blockquote markers (`>` plus one optional space), repeating so a
 * nested `> > ` quote unwraps too. Once stripped, a fence inside a quote looks
 * exactly like a top-level one — a quoted `> ``` ` block is still code.
 */
function stripBlockquoteMarkers(line: string): string {
  let rest = line;
  for (;;) {
    const marker = /^ {0,3}> ?/.exec(rest);
    if (!marker) return rest;
    rest = rest.slice(marker[0].length);
  }
}

/**
 * Mark the character spans an `@` reference must not be read from: fenced code
 * blocks, indented code blocks, HTML comments, and inline code spans.
 *
 * This is the dependency-free stand-in for Claude Code's `marked` lexer — our
 * memory files are plain markdown, so masking the span kinds the spec names is
 * enough. Unclosed `<!--` is deliberately left alone (a typo must not swallow
 * the rest of the file).
 */
function maskNonProseRegions(content: string): Uint8Array {
  const excluded = new Uint8Array(content.length);
  const lines = splitMarkdownLines(content);

  // Fenced code blocks: an opening line starts with ``` or ~~~ (optionally
  // indented, optionally with an info string); it closes on a line holding
  // nothing but the same character and at least as long a run.
  let fenceChar: string | null = null;
  let fenceLength = 0;

  // Indented code blocks: a run of lines indented by ≥4 spaces or a tab. Per
  // CommonMark such a block cannot interrupt a paragraph, so it opens only
  // after a blank line (or at the start of the file). That condition is also
  // what keeps a list item's 4-space continuation line — a `@path` somebody
  // really wants expanded — out of the mask.
  let inIndentedCode = false;
  let previousLineBlank = true;

  for (const line of lines) {
    const { prose } = line;
    const blank = prose.trim().length === 0;

    if (fenceChar !== null) {
      excluded.fill(1, line.start, line.end);
      const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(prose);
      if (
        close &&
        close[1][0] === fenceChar &&
        close[1].length >= fenceLength
      ) {
        fenceChar = null;
      }
      continue;
    }

    if (inIndentedCode && (blank || INDENTED_CODE_LINE.test(prose))) {
      excluded.fill(1, line.start, line.end);
      previousLineBlank = blank;
      continue;
    }
    inIndentedCode = false;

    if (!blank && previousLineBlank && INDENTED_CODE_LINE.test(prose)) {
      inIndentedCode = true;
      excluded.fill(1, line.start, line.end);
      previousLineBlank = false;
      continue;
    }

    const open = /^[ \t]*(`{3,}|~{3,})/.exec(prose);
    if (open) {
      fenceChar = open[1][0];
      fenceLength = open[1].length;
      excluded.fill(1, line.start, line.end);
      previousLineBlank = false;
      continue;
    }

    previousLineBlank = blank;
  }

  const commentPattern = /<!--[\s\S]*?-->/g;
  let comment: RegExpExecArray | null;
  while ((comment = commentPattern.exec(content)) !== null) {
    excluded.fill(1, comment.index, comment.index + comment[0].length);
  }

  for (const line of lines) {
    maskInlineCodeSpans(content, line.start, line.end, excluded);
  }

  return excluded;
}

/** Mask `` `…` `` spans within one line (a run closes on an equally long run). */
function maskInlineCodeSpans(
  content: string,
  start: number,
  end: number,
  excluded: Uint8Array,
): void {
  let index = start;
  while (index < end) {
    if (excluded[index] !== 0 || content[index] !== "`") {
      index += 1;
      continue;
    }
    let openingLength = 0;
    while (
      index + openingLength < end &&
      content[index + openingLength] === "`"
    ) {
      openingLength += 1;
    }
    let closingIndex = -1;
    let cursor = index + openingLength;
    while (cursor < end) {
      if (excluded[cursor] !== 0 || content[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let closingLength = 0;
      while (
        cursor + closingLength < end &&
        content[cursor + closingLength] === "`"
      ) {
        closingLength += 1;
      }
      if (closingLength === openingLength) {
        closingIndex = cursor;
        break;
      }
      cursor += closingLength;
    }
    if (closingIndex === -1) {
      index += openingLength;
      continue;
    }
    const spanEnd = closingIndex + openingLength;
    excluded.fill(1, index, spanEnd);
    index = spanEnd;
  }
}

/**
 * Collect every `@path` reference that sits in prose. `@` must start the line
 * or follow whitespace, so `foo@bar.com` never triggers.
 */
function findIncludeReferences(content: string): IncludeReference[] {
  const excluded = maskNonProseRegions(content);
  const references: IncludeReference[] = [];
  const pattern = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const start = match.index + match[0].length - match[1].length - 1;
    const end = match.index + match[0].length;
    let masked = false;
    for (let i = start; i < end; i += 1) {
      if (excluded[i] !== 0) {
        masked = true;
        break;
      }
    }
    if (masked) continue;
    references.push({ start, end, rawPath: match[1] });
  }
  return references;
}

/** What a raw `@…` token turned out to be. */
type IncludeTargetResolution =
  /** A path worth resolving (`@path`, `@./path`, `@~/path`, `@/abs`). */
  | { kind: "path"; targetPath: string }
  /** Only an anchor was left once `#fragment` was dropped (`@#setup`). */
  | { kind: "empty" }
  /** Not a path at all (`@%TEMP%`, `@*`, …) — the token stays prose. */
  | { kind: "prose" };

/**
 * Turn the raw text after `@` into an absolute path, or report why it is not
 * one. `#heading` is an anchor (dropped), `\ ` is an escaped space, and a bare
 * `@path` is relative to the memory file like `@./path`.
 */
function resolveIncludePath(
  rawPath: string,
  filePath: string,
): IncludeTargetResolution {
  const anchorIndex = rawPath.indexOf("#");
  let target = anchorIndex === -1 ? rawPath : rawPath.slice(0, anchorIndex);
  target = target.replace(/\\ /g, " ");
  if (target.length === 0) return { kind: "empty" };

  if (target === "~") return { kind: "path", targetPath: homedir() };
  if (target.startsWith("~/")) {
    return { kind: "path", targetPath: path.join(homedir(), target.slice(2)) };
  }

  const baseDir = path.dirname(filePath);
  if (path.isAbsolute(target)) {
    return { kind: "path", targetPath: path.resolve(target) };
  }
  if (target.startsWith("./") || target.startsWith("../")) {
    return { kind: "path", targetPath: path.resolve(baseDir, target) };
  }
  // Anything else starting with a path-ish character is a bare relative path;
  // `@#`, `@%`, `@*` and friends stay prose.
  if (/^[a-zA-Z0-9._-]/.test(target)) {
    return { kind: "path", targetPath: path.resolve(baseDir, target) };
  }
  return { kind: "prose" };
}

function isInsideDirectory(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Whether `targetPath` is outside the trusted area for this memory file.
 *
 * Only the project tier is scoped: `<workdir>/AGENTS.md` is committed to the
 * repository and may have been written by somebody else, so it must not be
 * able to point the agent at this machine's private files. User memory
 * (`~/.wave/AGENTS.md`) and the personal `AGENTS.local.md` are private to this
 * user and may reference anything.
 */
async function isOutsideWorkdir(
  targetPath: string,
  state: MemoryIncludeState,
): Promise<boolean> {
  if (state.tier !== "project" || state.workdir === null) return false;
  if (state.workdirRealPath === undefined) {
    // A workdir that cannot be canonicalized (deleted, unreadable) falls back
    // to the lexical path so the confinement check still runs — it must not be
    // skipped just because the boundary itself became unresolvable.
    state.workdirRealPath =
      (await canonicalPathOrNull(state.workdir)) ?? path.resolve(state.workdir);
  }
  return !isInsideDirectory(state.workdirRealPath, targetPath);
}

/**
 * Render an include target for the source marker: relative to the including
 * file's directory when possible, then to the workdir, then to `~`, and
 * absolute as the last resort. Forward slashes keep the marker identical
 * across platforms.
 */
function toIncludeDisplayPath(
  targetPath: string,
  filePath: string,
  state: MemoryIncludeState,
): string {
  const bases: { base: string; prefix: string }[] = [
    { base: path.dirname(filePath), prefix: "" },
  ];
  if (state.workdir !== null) bases.push({ base: state.workdir, prefix: "" });
  bases.push({ base: homedir(), prefix: "~/" });

  for (const { base, prefix } of bases) {
    const relative = path.relative(base, targetPath);
    if (relative.length === 0) continue;
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    return prefix + relative.split(path.sep).join("/");
  }
  return targetPath;
}

type IncludeTargetResult =
  | { kind: "included"; content: string }
  | { kind: "skipped"; reason: string }
  | { kind: "duplicate" };

/**
 * Check, read and recursively expand one `@include` target. Every rejection
 * carries a reason so the caller can leave a visible note; a failure here can
 * never drop the rest of the memory file.
 */
async function expandIncludeTarget(
  targetPath: string,
  state: MemoryIncludeState,
  depth: number,
): Promise<IncludeTargetResult> {
  if (depth > MAX_MEMORY_INCLUDE_DEPTH) {
    return { kind: "skipped", reason: "max depth reached" };
  }

  // Checked before touching the disk (so `@~/x` reports `outside workdir` even
  // when the target does not exist) and again on the real path below (so a
  // symlink cannot smuggle the project tier out of the workdir).
  if (await isOutsideWorkdir(path.resolve(targetPath), state)) {
    return { kind: "skipped", reason: "outside workdir" };
  }

  let realPath: string;
  try {
    realPath = await fs.realpath(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      kind: "skipped",
      reason:
        code === "ENOENT" || code === "ENOTDIR" ? "not found" : "read failed",
    };
  }

  if (await isOutsideWorkdir(realPath, state)) {
    return { kind: "skipped", reason: "outside workdir" };
  }

  // Only a target that actually expanded counts as seen: a reference that
  // failed has to leave its own note every time it appears, not go silent on
  // the second occurrence.
  if (state.load.seen.has(realPath)) return { kind: "duplicate" };

  if (!TEXT_FILE_EXTENSIONS.has(path.extname(realPath).toLowerCase())) {
    return { kind: "skipped", reason: "not a text file" };
  }

  let size: number;
  let isDirectory: boolean;
  try {
    const stats = await fs.stat(realPath);
    size = stats.size;
    isDirectory = stats.isDirectory();
  } catch {
    return { kind: "skipped", reason: "read failed" };
  }
  if (isDirectory) return { kind: "skipped", reason: "not a file" };
  if (size > MAX_MEMORY_INCLUDE_BYTES) {
    return { kind: "skipped", reason: "too large" };
  }
  if (state.load.expandedBytes + size > MAX_MEMORY_INCLUDE_TOTAL_BYTES) {
    return { kind: "skipped", reason: "total size limit reached" };
  }

  let raw: string;
  try {
    raw = await fs.readFile(realPath, "utf-8");
  } catch {
    return { kind: "skipped", reason: "read failed" };
  }

  // Marked before recursing, so a file that (directly or through a chain)
  // includes itself stops instead of looping.
  state.load.seen.add(realPath);
  state.load.expandedBytes += size;

  return {
    kind: "included",
    content: await expandMemoryIncludes(raw, realPath, state, depth),
  };
}

/**
 * Expand the `@include` references of one memory file.
 *
 * Every successfully resolved reference is appended as its own block after the
 * including file's content (never substituted in place — the prose stays
 * readable), with a `<!-- @include: path -->` marker naming its source. A
 * reference that cannot be expanded is replaced *in place* by a one-line
 * `<!-- @include skipped: path — reason -->` note.
 *
 * `depth` is the depth of `filePath` itself: the memory file is 0, a file it
 * includes is 1, and so on up to `MAX_MEMORY_INCLUDE_DEPTH`.
 */
async function expandMemoryIncludes(
  content: string,
  filePath: string,
  state: MemoryIncludeState,
  depth = 0,
): Promise<string> {
  const references = findIncludeReferences(content);
  if (references.length === 0) return content;

  if (depth === 0) {
    // The memory file itself counts as processed, so a file that (directly or
    // through a chain) includes itself stops instead of looping.
    const selfPath = await canonicalPathOrNull(filePath);
    if (selfPath !== null) state.load.seen.add(selfPath);
  }

  const notes: { start: number; end: number; text: string }[] = [];
  let blocks = "";
  let included = 0;
  let skipped = 0;

  for (const reference of references) {
    const resolution = resolveIncludePath(reference.rawPath, filePath);
    if (resolution.kind === "prose") continue;
    if (resolution.kind === "empty") {
      // An anchor-only reference (`@#setup`) points nowhere: say so instead of
      // dropping it silently, then leave the rest of the file alone.
      skipped += 1;
      notes.push({
        start: reference.start,
        end: reference.end,
        text: `<!-- @include skipped: @${reference.rawPath} — empty path -->`,
      });
      continue;
    }

    const targetPath = resolution.targetPath;
    const result = await expandIncludeTarget(targetPath, state, depth + 1);
    if (result.kind === "included") {
      included += 1;
      const displayPath = toIncludeDisplayPath(targetPath, filePath, state);
      blocks += `\n\n<!-- @include: ${displayPath} -->\n\n${result.content.trim()}`;
      continue;
    }
    if (result.kind === "duplicate") continue;

    skipped += 1;
    const displayPath = toIncludeDisplayPath(targetPath, filePath, state);
    notes.push({
      start: reference.start,
      end: reference.end,
      text: `<!-- @include skipped: ${displayPath} — ${result.reason} -->`,
    });
  }

  // Apply the in-place notes back to front so earlier offsets stay valid.
  let expanded = content;
  for (let i = notes.length - 1; i >= 0; i -= 1) {
    const note = notes[i];
    expanded =
      expanded.slice(0, note.start) + note.text + expanded.slice(note.end);
  }

  if (included > 0) {
    logger.debug("Expanded memory @include references", {
      filePath,
      tier: state.tier,
      included,
      skipped,
    });
    return expanded + blocks;
  }
  return expanded;
}

export class MemoryService {
  private _cachedProjectMemory: string | null = null;
  private _cachedUserMemory: string | null = null;
  private _cachedLocalMemory: string | null = null;
  private _cachedCombinedMemory: string | null = null;
  private _cachedAutoMemoryContent: string | null = null;

  constructor(private container: Container) {}

  public get cachedProjectMemory(): string {
    return this._cachedProjectMemory ?? "";
  }

  public get cachedUserMemory(): string {
    return this._cachedUserMemory ?? "";
  }

  public clearCache(): void {
    this._cachedProjectMemory = null;
    this._cachedUserMemory = null;
    this._cachedLocalMemory = null;
    this._cachedCombinedMemory = null;
    this._cachedAutoMemoryContent = null;
  }

  /**
   * Get the project-specific auto-memory directory.
   * Uses the git common directory to ensure worktrees share the same memory.
   */
  getAutoMemoryDirectory(workdir: string): string {
    const commonDir = getGitCommonDir(workdir);
    // If the common directory is a .git directory, use its parent as the project root
    // for a cleaner encoded name while maintaining stability across worktrees.
    const projectRoot =
      path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
    const encodedName = pathEncoder.encodeSync(projectRoot);
    return path.join(homedir(), ".wave", "projects", encodedName, "memory");
  }

  /**
   * Ensure the auto-memory directory exists, and rebuild `MEMORY.md` from the
   * topic files when the index is missing but those files are not.
   *
   * The index is deliberately never created empty. An initial template is
   * indistinguishable from "no memories yet" to a reader, and — because the
   * backfill only runs while the index is absent — writing one would also mean
   * a memory directory copied in from elsewhere never gets an index at all,
   * leaving every topic file in it undiscoverable. Claude Code behaves the same
   * way: its memory directory is created bare, and the index appears only once
   * there is something to point at (or the model writes it).
   */
  async ensureAutoMemoryDirectory(workdir: string): Promise<void> {
    const memoryDir = this.getAutoMemoryDirectory(workdir);
    const memoryFile = path.join(memoryDir, MEMORY_ENTRYPOINT_NAME);

    try {
      await fs.mkdir(memoryDir, { recursive: true });

      if (await this.fileExists(memoryFile)) return;

      const entrypoint = buildMemoryEntrypoint(
        await scanMemoryFiles(memoryDir),
      );
      if (!entrypoint) return;

      await atomicWriteFile(memoryFile, entrypoint);
      logger.debug(`Backfilled auto-memory index: ${memoryFile}`);
    } catch (error) {
      logger.error("Failed to ensure auto-memory directory:", error);
      throw new Error(
        `Failed to ensure auto-memory directory: ${(error as Error).message}`,
      );
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the auto-memory entrypoint (`MEMORY.md`), bounded by both the line and
   * the character cap. Truncation appends a warning naming the cap that fired,
   * so the model can tell the index it is reading is incomplete.
   */
  async getAutoMemoryContent(workdir: string): Promise<string> {
    if (this._cachedAutoMemoryContent !== null) {
      return this._cachedAutoMemoryContent;
    }
    const memoryDir = this.getAutoMemoryDirectory(workdir);
    const memoryFile = path.join(memoryDir, MEMORY_ENTRYPOINT_NAME);

    try {
      const raw = await fs.readFile(memoryFile, "utf-8");
      this._cachedAutoMemoryContent = truncateEntrypointContent(raw).content;
      return this._cachedAutoMemoryContent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this._cachedAutoMemoryContent = "";
        return "";
      }
      logger.error("Failed to read auto-memory content:", error);
      return "";
    }
  }

  async ensureUserMemoryFile(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(DATA_DIRECTORY, { recursive: true });

      // Check if user memory file exists
      try {
        await fs.access(USER_MEMORY_FILE);
      } catch (error) {
        // File does not exist, create new file
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          logger.info("Creating new user memory file", {
            userMemoryFile: USER_MEMORY_FILE,
          });
          const initialContent =
            "# User Memory\n\nThis is the user-level memory file, recording important information and context across projects.\n\n";
          await atomicWriteFile(USER_MEMORY_FILE, initialContent);
          logger.debug(`Created user memory file: ${USER_MEMORY_FILE}`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error("Failed to ensure user memory file:", error);
      throw new Error(
        `Failed to ensure user memory file: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Read the user-level memory file off disk, without expanding anything.
   *
   * The empty template counts as "nothing written yet", in which case
   * `~/.claude/AGENTS.md` is used when it exists.
   */
  private async readUserMemorySource(): Promise<MemorySource> {
    try {
      await this.ensureUserMemoryFile();
      let memoryFilePath = USER_MEMORY_FILE;
      let content = await fs.readFile(memoryFilePath, "utf-8");
      logger.debug("User memory content read successfully", {
        userMemoryFile: USER_MEMORY_FILE,
        contentLength: content.length,
      });

      // If the file is still the default empty template, fallback to ~/.claude/AGENTS.md
      const defaultTemplate =
        "# User Memory\n\nThis is the user-level memory file, recording important information and context across projects.\n\n";
      if (content === defaultTemplate) {
        const claudeMemoryPath = path.join(homedir(), ".claude", "AGENTS.md");
        try {
          const claudeContent = await fs.readFile(claudeMemoryPath, "utf-8");
          logger.debug(
            "User memory content read from ~/.claude/AGENTS.md fallback",
            {
              claudeMemoryPath,
              contentLength: claudeContent.length,
            },
          );
          memoryFilePath = claudeMemoryPath;
          content = claudeContent;
        } catch {
          // CLAUDE.md doesn't exist or can't be read, return the default template
        }
      }

      return { kind: "content", content, filePath: memoryFilePath };
    } catch (error) {
      logger.error("Failed to read user memory:", error);
      return { kind: "error" };
    }
  }

  /** Read `<workdir>/AGENTS.md` (or `CLAUDE.md`) off disk, unexpanded. */
  private async readProjectMemorySource(
    workdir: string,
  ): Promise<MemorySource> {
    const memoryFilePath = path.join(workdir, "AGENTS.md");
    try {
      const content = await fs.readFile(memoryFilePath, "utf-8");
      logger.debug("Memory file read successfully via direct file access", {
        memoryFilePath,
        contentLength: content.length,
      });
      return { kind: "content", content, filePath: memoryFilePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error("Failed to read memory file", {
          memoryFilePath,
          error: serializeError(error),
        });
        return { kind: "error" };
      }
    }

    const claudeMemoryPath = path.join(workdir, "CLAUDE.md");
    try {
      const content = await fs.readFile(claudeMemoryPath, "utf-8");
      logger.debug("Memory file read from CLAUDE.md fallback", {
        memoryFilePath: claudeMemoryPath,
        contentLength: content.length,
      });
      return { kind: "content", content, filePath: claudeMemoryPath };
    } catch (claudeError) {
      if ((claudeError as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug("Neither AGENTS.md nor CLAUDE.md found", {
          memoryFilePath,
        });
        return { kind: "missing" };
      }
      logger.error("Failed to read CLAUDE.md fallback", {
        memoryFilePath: claudeMemoryPath,
        error: serializeError(claudeError),
      });
      return { kind: "error" };
    }
  }

  /** Read `<workdir>/AGENTS.local.md` (or `CLAUDE.local.md`), unexpanded. */
  private async readLocalMemorySource(workdir: string): Promise<MemorySource> {
    let readFailed = false;
    for (const fileName of ["AGENTS.local.md", "CLAUDE.local.md"]) {
      const memoryFilePath = path.join(workdir, fileName);
      try {
        const content = await fs.readFile(memoryFilePath, "utf-8");
        logger.debug("Local memory file read successfully", {
          memoryFilePath,
          contentLength: content.length,
        });
        return { kind: "content", content, filePath: memoryFilePath };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.error("Failed to read local memory file", {
            memoryFilePath,
            error: serializeError(error),
          });
          readFailed = true;
        }
      }
    }

    logger.debug("Neither AGENTS.local.md nor CLAUDE.local.md found", {
      workdir,
    });
    return readFailed ? { kind: "error" } : { kind: "missing" };
  }

  /**
   * Expand one memory layer's `@include` references. `null` means the layer
   * could not be read at all (as opposed to not existing), so the caller
   * leaves its cache cold and the next read retries.
   */
  private async expandMemoryLayer(
    source: MemorySource,
    tier: MemoryIncludeTier,
    workdir: string | null,
    load: MemoryIncludeLoad,
  ): Promise<string | null> {
    if (source.kind === "error") return null;
    if (source.kind === "missing") return "";
    return expandMemoryIncludes(
      source.content,
      source.filePath,
      createMemoryIncludeState(tier, workdir, load),
    );
  }

  private async loadProjectMemory(
    workdir: string,
    load: MemoryIncludeLoad,
  ): Promise<string> {
    if (this._cachedProjectMemory !== null) return this._cachedProjectMemory;
    // Project memory travels with the repository, so its `@` references are
    // confined to the workdir.
    const expanded = await this.expandMemoryLayer(
      await this.readProjectMemorySource(workdir),
      "project",
      workdir,
      load,
    );
    if (expanded === null) return "";
    this._cachedProjectMemory = expanded;
    return expanded;
  }

  private async loadUserMemory(load: MemoryIncludeLoad): Promise<string> {
    if (this._cachedUserMemory !== null) return this._cachedUserMemory;
    // User memory is private to this machine, so its `@` references may point
    // anywhere (no workdir boundary).
    const expanded = await this.expandMemoryLayer(
      await this.readUserMemorySource(),
      "user",
      null,
      load,
    );
    if (expanded === null) return "";
    this._cachedUserMemory = expanded;
    return expanded;
  }

  private async loadLocalMemory(
    workdir: string,
    load: MemoryIncludeLoad,
  ): Promise<string> {
    if (this._cachedLocalMemory !== null) return this._cachedLocalMemory;
    // Personal memory is private to this user, so — unlike the project file —
    // its `@` references may point outside the workdir.
    const expanded = await this.expandMemoryLayer(
      await this.readLocalMemorySource(workdir),
      "local",
      workdir,
      load,
    );
    if (expanded === null) return "";
    this._cachedLocalMemory = expanded;
    return expanded;
  }

  async getUserMemoryContent(): Promise<string> {
    return this.loadUserMemory(createMemoryIncludeLoad());
  }

  async readMemoryFile(workdir: string): Promise<string> {
    return this.loadProjectMemory(workdir, createMemoryIncludeLoad());
  }

  /**
   * Read the project-level *personal* memory file (`<workdir>/AGENTS.local.md`,
   * falling back to `CLAUDE.local.md`), with `@include` references expanded.
   *
   * This is the layer between the shared project memory and the user-level
   * memory: private to this user (gitignored, never committed) but specific to
   * this repository — the counterpart of CC's `CLAUDE.local.md`. Like the
   * project layer it is read from the workdir only, with no upward walk, so a
   * worktree needs its own copy.
   */
  async readLocalMemoryFile(workdir: string): Promise<string> {
    return this.loadLocalMemory(workdir, createMemoryIncludeLoad());
  }

  /**
   * The project memory file exactly as it sits on disk: `@include` references
   * stay unexpanded and nothing is served from the expansion cache.
   *
   * This is what the settings-page editor reads. Handing it an expanded body
   * would mean one save writes the referenced content into `AGENTS.md`.
   */
  async readRawProjectMemory(workdir: string): Promise<string> {
    const source = await this.readProjectMemorySource(workdir);
    return source.kind === "content" ? source.content : "";
  }

  /** `~/.wave/AGENTS.md` as it sits on disk, unexpanded (settings editor). */
  async readRawUserMemory(): Promise<string> {
    const source = await this.readUserMemorySource();
    return source.kind === "content" ? source.content : "";
  }

  /**
   * `<workdir>/AGENTS.local.md` as it sits on disk, unexpanded (settings
   * editor). Never creates the file: a missing personal layer reads as empty.
   */
  async readRawLocalMemory(workdir: string): Promise<string> {
    const source = await this.readLocalMemorySource(workdir);
    return source.kind === "content" ? source.content : "";
  }

  async getCombinedMemoryContent(workdir: string): Promise<string> {
    if (this._cachedCombinedMemory !== null) {
      return this._cachedCombinedMemory;
    }
    // One load scope for all three layers: a file referenced by more than one
    // of them expands once for the whole combined read, not once per layer.
    const load = createMemoryIncludeLoad();
    const projectMemory = await this.loadProjectMemory(workdir, load);
    const userMemory = await this.loadUserMemory(load);
    const localMemory = await this.loadLocalMemory(workdir, load);

    let combined = "";
    if (projectMemory.trim()) combined += projectMemory;
    if (userMemory.trim()) {
      if (combined) combined += "\n\n";
      combined += userMemory;
    }
    // Personal project memory is loaded last, so it outranks both the shared
    // project file and the cross-project user file.
    if (localMemory.trim()) {
      if (combined) combined += "\n\n";
      combined += localMemory;
    }
    this._cachedCombinedMemory = combined;
    return combined;
  }

  /**
   * Persist the user-level memory file (~/.wave/AGENTS.md), creating it if
   * missing. Clears the user-memory cache so subsequent reads see the new
   * content (the default-template fallback to ~/.claude/AGENTS.md is also
   * bypassed once the user writes real content).
   */
  async writeUserMemoryContent(content: string): Promise<void> {
    await this.ensureUserMemoryFile();
    await atomicWriteFile(USER_MEMORY_FILE, content);
    this._cachedUserMemory = null;
    this._cachedCombinedMemory = null;
    logger.debug("User memory content written", {
      userMemoryFile: USER_MEMORY_FILE,
      contentLength: content.length,
    });
  }

  /**
   * Persist the project-level memory file (<workdir>/AGENTS.md), creating it
   * if missing. Reads fall back to CLAUDE.md but writes always target
   * AGENTS.md (the canonical project memory file). Clears the project-memory
   * cache so subsequent reads see the new content.
   */
  async writeProjectMemoryContent(
    workdir: string,
    content: string,
  ): Promise<void> {
    const memoryFilePath = path.join(workdir, "AGENTS.md");
    await fs.mkdir(workdir, { recursive: true });
    await atomicWriteFile(memoryFilePath, content);
    this._cachedProjectMemory = null;
    this._cachedCombinedMemory = null;
    logger.debug("Project memory content written", {
      memoryFilePath,
      contentLength: content.length,
    });
  }

  /**
   * Persist the project-level *personal* memory file
   * (`<workdir>/AGENTS.local.md`), creating its parent directory if needed.
   *
   * Reads fall back to `CLAUDE.local.md` but writes always target
   * `AGENTS.local.md` (the canonical personal file), mirroring
   * `writeProjectMemoryContent`. Clears the local and combined caches so the
   * next read sees the new content.
   */
  async writeLocalMemoryContent(
    workdir: string,
    content: string,
  ): Promise<void> {
    const memoryFilePath = path.join(workdir, "AGENTS.local.md");
    await fs.mkdir(workdir, { recursive: true });
    await atomicWriteFile(memoryFilePath, content);
    this._cachedLocalMemory = null;
    this._cachedCombinedMemory = null;
    logger.debug("Local memory content written", {
      memoryFilePath,
      contentLength: content.length,
    });
  }
}
