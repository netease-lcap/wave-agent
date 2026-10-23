/**
 * Shared rendering for the knowledge-base tools.
 *
 * Two rules shape everything here:
 * - The output is read by a model and skimmed by a person, so a hit is a couple
 *   of short lines: where it came from, then the snippet.
 * - Nothing in a server reply is trusted to be well-formed. A missing title, a
 *   `page` that arrives as a string, a `degraded` that is not an array — each is
 *   rendered as "absent", never as `undefined` leaking into the text.
 */

import type { KbDoc, KbHit } from "../../services/knowledgeBaseApi.js";

/** Stands in for a title the server did not send. */
export const UNTITLED_DOC = "未命名文档";

/**
 * The one answer for 401/403, shared by all three tools. The server decides
 * membership from the login alone (spec 企业知识库·租户与权限隔离), so the client
 * never guesses why a request was refused — it tells the model whose account
 * this is and what to do about it.
 */
export const KB_UNAUTHORIZED = "需要企业登录且是企业成员才能检索知识库";

/** A string field, trimmed; `fallback` when it is missing or blank. */
export function readText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

/** Snippets and titles land in a one-line-per-hit list, so newlines collapse. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** `（第 3 页）`, or "" when the source had no paging (docx, most Markdown). */
function formatPage(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `（第 ${value} 页）`
    : "";
}

/** Comparison form: NFKC (full-width → half-width) plus case folding. */
function normalizeForCompare(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/**
 * The "where this chunk came from" parts, never repeating the document name.
 *
 * The parser builds `sectionPath` out of the document's heading levels, and the
 * first heading of a real document IS its title — so a hit for 员工手册 arrives
 * as `title=员工手册`, `sectionPath=员工手册 > 假期制度 > 婚假`. Prepending the
 * title would print the document name twice (`员工手册 · 员工手册 > 假期制度`),
 * so a first level that matches the title replaces the title entirely and the
 * path keeps its own hierarchy. Any other shape keeps `title · sectionPath`.
 *
 * The level comparison is NFKC- and case-insensitive: the two values come from
 * different places in the ingestion pipeline (the file name vs. the parsed
 * heading), so full-width characters or casing can legitimately differ.
 */
function locationParts(title: string, sectionPath: string): string[] {
  const levels = sectionPath
    .split(">")
    .map((level) => level.trim())
    .filter(Boolean);
  // No usable heading structure: the title is all we know.
  if (levels.length === 0) return [title];
  if (normalizeForCompare(levels[0]) === normalizeForCompare(title)) {
    return [levels.join(" > ")];
  }
  return [title, levels.join(" > ")];
}

/**
 * Where a chunk came from: `员工手册 > 假期制度 > 婚假（第 3 页）`, or
 * `员工手册 · 假期制度 > 婚假（第 3 页）` when the section path does not already
 * start with the document title (see `locationParts`).
 *
 * A `sectionPath` that carries no heading at all — a docx without heading styles
 * parses to a flat list and the server then sends an empty `sectionPath` — leaves
 * the title alone rather than trailing a dangling separator.
 */
export function formatLocation(parts: {
  title?: unknown;
  sectionPath?: unknown;
  page?: unknown;
}): string {
  const title = readText(parts.title, UNTITLED_DOC);
  const section = readText(parts.sectionPath);
  return `${locationParts(title, section).join(" · ")}${formatPage(parts.page)}`;
}

/**
 * `解析降级：emf_or_chart` — the parser gap the server flagged on this chunk, or
 * "" when the document parsed cleanly. Surfaced on every hit so the model can
 * say "这份文档有未解析的图表" instead of implying it read everything.
 */
export function formatDegraded(value: unknown): string {
  const labels = Array.isArray(value)
    ? value.filter((label): label is string => readText(label) !== "")
    : [];
  return labels.length > 0 ? `解析降级：${labels.join("、")}` : "";
}

/** Image descriptions the parser produced for this chunk, if any. */
export function readCaptions(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((caption): caption is string => readText(caption) !== "")
    : [];
}

/**
 * How many distinct documents a hit list covers — the "2 个文档" half of
 * `命中 3 条 · 2 个文档`. Falls back to the hit count when the server sent
 * neither `docId` nor `chunkId`.
 */
export function countDocuments(hits: KbHit[]): number {
  const keys = hits.map((hit) => readText(hit.docId) || readText(hit.chunkId));
  return new Set(keys.filter(Boolean)).size || hits.length;
}

/**
 * `<title> · <sectionPath> · 132 字` — one line for a collapsed tool row, with
 * the same document-name de-duplication `formatLocation` applies (`员工手册 >
 * 假期制度 > 婚假 · 77 字` when the path already starts with the title).
 */
export function formatDocSummary(doc: KbDoc, body: string): string {
  return [
    ...locationParts(
      readText(doc.title, UNTITLED_DOC),
      readText(doc.sectionPath),
    ),
    `${body.length} 字`,
  ].join(" · ");
}
