import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SPECS_DIR = path.join(__dirname, "..", "specs");
export const ROOT_DIR = path.join(__dirname, "..", "..");

export const SPEC_GROUPS = [
  { dir: "core", text: "Agent 核心" },
  { dir: "ui", text: "交互与 UI" },
  { dir: "multi-agent", text: "多 Agent 与并发" },
  { dir: "ecosystem", text: "扩展与生态" },
  { dir: "automation", text: "自动化" },
  { dir: "enterprise", text: "企业管控" },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, out);
    else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

export function specTitle(content, fallback) {
  const m = content.match(/^#\s+功能规格说明：(.+)$/m);
  if (m) return m[1].trim();
  const h1 = content.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : fallback;
}

// Minimal frontmatter parser for simple `key: value` / `key: "value"` lines.
// Covers what the spec files use (name/description/order); not a full YAML parser.
export function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end === -1) return {};
  const data = {};
  for (const line of content.slice(4, end).split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1).replace(/\\\\/g, "\\").replace(/\\"/g, '"');
    }
    data[m[1]] = v;
  }
  return data;
}

export function countUserStories(content) {
  const m = content.match(/^### 用户故事[：:]/gm);
  return m ? m.length : 0;
}

export function countAcceptanceScenarios(content) {
  const m = content.match(/^\d+\.\s+\*\*假设\*\*/gm);
  return m ? m.length : 0;
}

// Scan docs/specs/<group>/*.md. Returns groups (rows sorted by frontmatter
// `order`, then path), totals, and template warnings.
export function collectSpecs() {
  const groups = [];
  const warnings = [];
  const totals = { specs: 0, us: 0, ac: 0 };

  for (const { dir, text } of SPEC_GROUPS) {
    const dirPath = path.join(SPECS_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;
    const specs = [];
    for (const f of fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"))
      .sort()) {
      const rel = `${dir}/${f}`;
      const content = fs.readFileSync(path.join(dirPath, f), "utf-8");
      const fm = parseFrontmatter(content);
      const usCount = countUserStories(content);
      const acCount = countAcceptanceScenarios(content);
      totals.specs++;
      totals.us += usCount;
      totals.ac += acCount;
      if (!content.match(/^## 用户场景与测试/m))
        warnings.push(`${rel}: 缺少 "## 用户场景与测试" 章节`);
      if (usCount === 0)
        warnings.push(`${rel}: 未找到用户故事（期望 \`### 用户故事：\`）`);
      if (acCount === 0)
        warnings.push(`${rel}: 未找到验收场景（期望 \`N. **假设** … **当** … **则** …\`）`);
      specs.push({
        path: rel,
        name: fm.name || specTitle(content, f.replace(/\.md$/, "")),
        description: fm.description || "",
        order: fm.order !== undefined ? Number(fm.order) : null,
        usCount,
        acCount,
      });
    }
    specs.sort(
      (a, b) =>
        (a.order ?? Infinity) - (b.order ?? Infinity) ||
        a.path.localeCompare(b.path),
    );
    groups.push({ dir, text, specs });
  }

  return { groups, totals, warnings };
}

// Count test files and test cases in packages/agent-sdk + packages/code.
export function collectTests() {
  let files = 0;
  let cases = 0;
  for (const pkg of ["packages/agent-sdk", "packages/code"]) {
    const testsDir = path.join(ROOT_DIR, pkg, "tests");
    if (!fs.existsSync(testsDir)) continue;
    for (const fp of walk(testsDir)) {
      if (
        !/\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/.test(
          path.basename(fp),
        )
      )
        continue;
      files++;
      const m = fs.readFileSync(fp, "utf-8").match(/^\s*(it|test)\s*[\(]/gm);
      cases += m ? m.length : 0;
    }
  }
  return { files, cases };
}
