// Sidebar anchor checker (no dependencies).
// 1. Forward: every leaf link in the VitePress sidebar config resolves to an
//    existing docs/*.md file, and any anchor on the link corresponds to a
//    heading in that file.
// 2. Reverse: every `###` heading (and non-group `##` headings) in a page that
//    appears in the sidebar must be reachable from some sidebar leaf link.
//    Group headings (##) are exempt when a sidebar group with matching text
//    exists. Catches drift between sidebar links and doc headings in both
//    directions.
//
// Run: node scripts/check-sidebar-anchors.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docsDir = join(root, 'docs');
const configFile = join(docsDir, '.vitepress', 'config.js');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '');
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, '');
}

function stripCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, '');
}

function collectHeadings(content) {
  const headings = [];
  for (const line of stripCodeBlocks(content).split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      let text = m[2];
      let explicitId = null;
      const idMatch = text.match(/\{#([^}]+)\}/);
      if (idMatch) {
        explicitId = idMatch[1];
        text = text.replace(/\s*\{#[^}]+\}\s*$/, '').trim();
      }
      headings.push({ level: m[1].length, text, explicitId, slug: slugify(text) });
    } else {
      const idMatch = line.match(/\{#([^}]+)\}/);
      if (idMatch) headings.push({ level: 0, text: line, explicitId: idMatch[1], slug: idMatch[1] });
    }
  }
  return headings;
}

function anchorMatches(anchor, headings) {
  const a = normalize(anchor);
  const aSlug = slugify(anchor);
  if (!a) return true;
  for (const h of headings) {
    if (h.explicitId && normalize(h.explicitId) === a) return true;
    if (h.slug && (h.slug === aSlug || h.slug === a)) return true;
    if (h.slug && (h.slug.includes(a) || h.slug.includes(aSlug))) return true;
    const ht = normalize(h.text);
    if (ht && ht.includes(a)) return true;
  }
  return false;
}

function walkSidebar(node, leaves, groups) {
  if (Array.isArray(node)) {
    for (const n of node) walkSidebar(n, leaves, groups);
    return;
  }
  if (node && typeof node === 'object') {
    const isGroup = Array.isArray(node.items);
    if (typeof node.text === 'string') {
      if (isGroup) groups.push(node.text);
      else if (typeof node.link === 'string') leaves.push({ text: node.text, link: node.link });
    }
    if (isGroup) {
      walkSidebar(node.items, leaves, groups);
    } else {
      for (const v of Object.values(node)) {
        if (v && typeof v === 'object') walkSidebar(v, leaves, groups);
      }
    }
  }
}

async function getSidebarLeaves() {
  // Try dynamic import first (config has no defineConfig import, so this works).
  try {
    const mod = await import(pathToFileURL(configFile).href);
    const cfg = mod.default || mod;
    const sidebar = cfg && cfg.themeConfig && cfg.themeConfig.sidebar;
    const leaves = [];
    const groups = [];
    walkSidebar(sidebar, leaves, groups);
    if (leaves.length > 0) return { leaves, groups, source: 'dynamic-import' };
  } catch (e) {
    // fall through to regex
  }
  // Regex fallback: extract { text, link } leaf entries from raw source.
  const src = readFileSync(configFile, 'utf8');
  const re = /\{\s*text:\s*['"]([^'"]+)['"]\s*,\s*link:\s*['"]([^'"]+)['"]\s*[^}]*\}/g;
  const leaves = [];
  let m;
  while ((m = re.exec(src)) !== null) leaves.push({ text: m[1], link: m[2] });
  return { leaves, groups: [], source: 'regex' };
}

const { leaves, groups, source } = await getSidebarLeaves();

const errors = [];
let checked = 0;

function splitHash(url) {
  const i = url.indexOf('#');
  if (i < 0) return [url, null];
  return [url.slice(0, i), url.slice(i + 1)];
}

// Forward check: each sidebar leaf link must point at an existing file + heading.
const pageLeaves = new Map(); // pageName -> [anchor, ...]
for (const { text, link } of leaves) {
  const [page, anchor] = splitHash(link);
  if (!page) {
    errors.push(`sidebar item '${text}' has no page in link '${link}'`);
    continue;
  }
  const pageName = page.replace(/^\//, '');
  const filePath = join(docsDir, `${pageName}.md`);
  if (!existsSync(filePath)) {
    errors.push(`sidebar link '${link}' -> file not found: docs/${pageName}.md`);
    continue;
  }
  checked++;
  if (!pageLeaves.has(pageName)) pageLeaves.set(pageName, []);
  if (anchor) pageLeaves.get(pageName).push(anchor);
  if (anchor) {
    const headings = collectHeadings(readFileSync(filePath, 'utf8'));
    if (!anchorMatches(anchor, headings)) {
      errors.push(
        `sidebar link '${link}' anchor '${anchor}' not found in any heading of docs/${pageName}.md`
      );
    }
  }
}

// Reverse check: every heading in a sidebar-referenced page must be covered by
// a sidebar leaf link (or by a matching sidebar group for ## headings).
const groupTexts = groups.map(normalize);
for (const [pageName, anchors] of pageLeaves) {
  if (anchors.length === 0) continue; // page referenced without anchors — nothing to verify
  if (pageName.startsWith('specs/')) continue; // specs sidebar is auto-generated
  const filePath = join(docsDir, `${pageName}.md`);
  const headings = collectHeadings(readFileSync(filePath, 'utf8'));
  for (const h of headings) {
    if (h.level === 0) continue; // anchor-only line, not a real heading
    if (h.level === 1 || h.level > 3) continue; // page title / 4th-level subsections are not sidebar entries
    // Group headings (##) are covered by a sidebar group with matching text.
    if (h.level === 2 && groupTexts.includes(normalize(h.text))) continue;
    const covered = anchors.some((a) => anchorMatches(a, [h]));
    if (!covered) {
      const label = h.explicitId ? `{#${h.explicitId}}` : `#${h.slug}`;
      errors.push(
        `docs/${pageName}.md heading '${h.text}' (${label}) has no sidebar entry — add a leaf link to it`
      );
    }
  }
}

console.log(`(sidebar parsed via ${source}: ${leaves.length} leaf items, ${groups.length} groups)`);

if (errors.length > 0) {
  for (const e of errors) console.log('ERROR: ' + e);
  console.log('');
  console.log(`FAIL: sidebar anchor check found ${errors.length} problem(s)`);
  process.exit(1);
}

console.log(`PASS: sidebar anchors OK (${checked} link(s) checked forward, ${pageLeaves.size} page(s) checked reverse)`);
process.exit(0);
