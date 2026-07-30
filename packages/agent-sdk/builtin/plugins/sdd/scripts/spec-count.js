#!/usr/bin/env node
// Generic, self-contained spec validator. Counts user stories and acceptance
// scenarios under the project's specs directory and warns on missing sections.
// Detects the specs dir: prefers docs/specs/, else specs/, else exits gracefully.
// No dependency on any project's VitePress/docs-site modules.
import fs from "node:fs";
import path from "node:path";

function detectSpecsDir() {
  for (const dir of ["docs/specs", "specs"]) {
    const resolved = path.resolve(process.cwd(), dir);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(fullPath);
  }
  return out;
}

function countUserStories(content) {
  const m = content.match(/^### 用户故事[：:]/gm);
  return m ? m.length : 0;
}

function countAcceptanceScenarios(content) {
  const m = content.match(/^\d+\.\s+\*\*假设\*\*/gm);
  return m ? m.length : 0;
}

const specsDir = detectSpecsDir();
if (!specsDir) {
  console.log("未找到规格目录（docs/specs/ 或 specs/），跳过校验。");
  process.exit(0);
}

const files = walk(specsDir).sort();
const totals = { specs: 0, us: 0, ac: 0 };
const warnings = [];

// index.md is conventionally a directory listing page, not a spec — skip it.
const specFiles = files.filter(
  (fp) => path.basename(fp).toLowerCase() !== "index.md",
);

for (const fp of specFiles) {
  const content = fs.readFileSync(fp, "utf-8");
  const usCount = countUserStories(content);
  const acCount = countAcceptanceScenarios(content);
  const rel = path.relative(process.cwd(), fp);
  totals.specs++;
  totals.us += usCount;
  totals.ac += acCount;
  if (!content.match(/^## 用户场景与测试/m))
    warnings.push(`${rel}: 缺少 "## 用户场景与测试" 章节`);
  if (usCount === 0)
    warnings.push(`${rel}: 未找到用户故事（期望 \`### 用户故事：\`）`);
  if (acCount === 0)
    warnings.push(
      `${rel}: 未找到验收场景（期望 \`N. **假设** … **当** … **则** …\`）`,
    );
  console.log(`${rel}  用户故事: ${usCount}  验收场景: ${acCount}`);
}

console.log("---");
console.log(
  `规格: ${totals.specs}  用户故事: ${totals.us}  验收场景: ${totals.ac}`,
);
if (warnings.length) {
  for (const w of warnings) console.warn(`⚠ ${w}`);
  console.warn(`⚠ ${warnings.length} 条模板警告——见上方。`);
}
