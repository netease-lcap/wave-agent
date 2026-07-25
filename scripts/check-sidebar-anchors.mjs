// Sidebar anchor checker (no dependencies).
// Validates that every leaf link in the VitePress sidebar config resolves to an
// existing docs/*.md file, and that any anchor on the link corresponds to a
// heading in that file. Catches drift between sidebar links and doc headings.
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
      headings.push({ text, explicitId, slug: slugify(text) });
    } else {
      const idMatch = line.match(/\{#([^}]+)\}/);
      if (idMatch) headings.push({ text: line, explicitId: idMatch[1], slug: idMatch[1] });
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

function walkSidebar(node, leaves) {
  if (Array.isArray(node)) {
    for (const n of node) walkSidebar(n, leaves);
    return;
  }
  if (node && typeof node === 'object') {
    if (typeof node.link === 'string' && typeof node.text === 'string') {
      leaves.push({ text: node.text, link: node.link });
    }
    if (Array.isArray(node.items)) {
      walkSidebar(node.items, leaves);
    } else {
      for (const v of Object.values(node)) {
        if (v && typeof v === 'object') walkSidebar(v, leaves);
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
    walkSidebar(sidebar, leaves);
    if (leaves.length > 0) return { leaves, source: 'dynamic-import' };
  } catch (e) {
    // fall through to regex
  }
  // Regex fallback: extract { text, link } leaf entries from raw source.
  const src = readFileSync(configFile, 'utf8');
  const re = /\{\s*text:\s*['"]([^'"]+)['"]\s*,\s*link:\s*['"]([^'"]+)['"]\s*[^}]*\}/g;
  const leaves = [];
  let m;
  while ((m = re.exec(src)) !== null) leaves.push({ text: m[1], link: m[2] });
  return { leaves, source: 'regex' };
}

const { leaves, source } = await getSidebarLeaves();

const errors = [];
let checked = 0;

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
  if (anchor) {
    const headings = collectHeadings(readFileSync(filePath, 'utf8'));
    if (!anchorMatches(anchor, headings)) {
      errors.push(
        `sidebar link '${link}' anchor '${anchor}' not found in any heading of docs/${pageName}.md`
      );
    }
  }
}

console.log(`(sidebar parsed via ${source}: ${leaves.length} leaf items)`);

if (errors.length > 0) {
  for (const e of errors) console.log('ERROR: ' + e);
  console.log('');
  console.log(`FAIL: sidebar anchor check found ${errors.length} problem(s)`);
  process.exit(1);
}

console.log(`PASS: sidebar anchors OK (${checked} item(s) checked)`);
process.exit(0);

function splitHash(url) {
  const i = url.indexOf('#');
  if (i < 0) return [url, null];
  return [url.slice(0, i), url.slice(i + 1)];
}
