#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specsDir = path.join(__dirname, "..", "docs", "specs");

// Section heading -> subdirectory mapping (physical grouping)
const sectionToDir = {
  "Agent 核心": "core",
  "交互与 UI": "ui",
  "多 Agent 与并发": "multi-agent",
  "扩展与生态": "ecosystem",
  自动化: "automation",
  企业管控: "enterprise",
};

function walkDir(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(fullPath, callback);
    else if (entry.isFile()) callback(fullPath);
  }
}

// Scan docs/specs/<group>/*.md files recursively; keys are posix relative paths
const specFiles = [];
walkDir(specsDir, (filePath) => {
  const name = path.basename(filePath);
  if (name.endsWith(".md") && name !== "index.md") {
    specFiles.push(path.relative(specsDir, filePath).split(path.sep).join("/"));
  }
});
specFiles.sort();

let totalSpecs = 0;
let totalUS = 0;
let totalFR = 0;

// Count US/FR per spec file
const counts = new Map(); // relative path -> { usCount, frCount }

let hasWarnings = false;

for (const file of specFiles) {
  const specFile = path.join(specsDir, file);
  totalSpecs++;
  const content = fs.readFileSync(specFile, "utf-8");

  const usMatches = content.match(/^### 用户故事[：:]/gm);
  const usCount = usMatches ? usMatches.length : 0;
  totalUS += usCount;

  // FR bullets: list items under the 功能需求 section (until the next heading)
  const frSection = content.match(/^### 功能需求\s*\n([\s\S]*?)(?=^#{1,3} |\s*$(?![\s\S]))/m);
  const frItems = frSection
    ? frSection[1].match(/^- /gm)
    : null;
  const frCount = frItems ? frItems.length : 0;
  totalFR += frCount;

  counts.set(file, { usCount, frCount });
  console.log(`${file}  用户故事: ${usCount}  功能需求: ${frCount}`);

  // Validate spec follows standard template
  const warnings = [];
  if (!content.match(/^## 用户场景与测试/m))
    warnings.push('缺少 "## 用户场景与测试" 章节');
  if (usCount === 0) warnings.push('未找到用户故事（期望 `### 用户故事：`）');
  if (frCount === 0) warnings.push("未找到功能需求条目");
  if (warnings.length) {
    hasWarnings = true;
    console.warn(`  ⚠ ${file}: ${warnings.join("; ")}`);
  }
}

console.log("---");
console.log(`规格: ${totalSpecs}  用户故事: ${totalUS}  功能需求: ${totalFR}`);
if (hasWarnings) console.warn("⚠ 部分规格有模板警告——见上方。");

// Count test files and test cases
const rootDir = path.join(__dirname, "..");
const pkgDirs = ["packages/agent-sdk", "packages/code"];
let totalTestFiles = 0;
let totalTestCases = 0;

for (const pkg of pkgDirs) {
  const testsDir = path.join(rootDir, pkg, "tests");
  if (!fs.existsSync(testsDir)) continue;
  walkDir(testsDir, (filePath) => {
    if (/\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/.test(path.basename(filePath))) {
      totalTestFiles++;
      const content = fs.readFileSync(filePath, "utf-8");
      const itMatches = content.match(/^\s*(it|test)\s*[\(]/gm);
      totalTestCases += itMatches ? itMatches.length : 0;
    }
  });
}

console.log(`测试文件: ${totalTestFiles}  测试用例: ${totalTestCases.toLocaleString()}`);

// Update docs/specs/index.md
const readmePath = path.join(specsDir, "index.md");
let readme = fs.readFileSync(readmePath, "utf-8");

// Update Stats table (Chinese headers)
readme = readme.replace(
  /^(\| 规格文件 \| )\d+(\s*\|)$/m,
  `$1${totalSpecs}$2`,
);
readme = readme.replace(
  /^(\| 用户故事 \| )\d+(?:,\d+)*(\s*\|)$/m,
  `$1${totalUS.toLocaleString()}$2`,
);
readme = readme.replace(
  /^(\| 功能需求 \| )\d+(?:,\d+)*(\s*\|)$/m,
  `$1${totalFR.toLocaleString()}$2`,
);
readme = readme.replace(
  /^(\| 测试用例 \| )\d+(?:,\d+)*(\s*\|)$/m,
  `$1${totalTestCases.toLocaleString()}$2`,
);

// Update Specs table: preserve existing Feature/Description, update US/FR/Links
const lines = readme.split("\n");

// Pre-collect all spec files already linked anywhere in the README, so that
// appendix rows are only added for specs missing from every group table.
const existingFiles = new Set(
  lines
    .map((l) => l.match(/\[(?:规格|spec)\]\(([^)]+\.md)\)/))
    .filter(Boolean)
    .map((m) => m[1]),
);

const newLines = [];
let inSpecsTable = false;
let headerDone = false;
let currentDir = null;

for (const line of lines) {
  const sectionMatch = line.match(/^###\s+(.+?)\s*$/);
  if (sectionMatch && sectionToDir[sectionMatch[1]]) {
    currentDir = sectionToDir[sectionMatch[1]];
  }
  if (line.startsWith("| 功能 |")) {
    inSpecsTable = true;
    headerDone = false;
    newLines.push("| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |");
    continue;
  }
  if (inSpecsTable && !headerDone && line.match(/^\|[-| ]+\|$/)) {
    headerDone = true;
    newLines.push("|------|------|----------|----------|------|");
    continue;
  }
  if (inSpecsTable && line.startsWith("|")) {
    const cells = line.split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length >= 3) {
      const feature = cells[0].trim();
      const description = cells[1].trim();
      const linksCell = cells[cells.length - 1].trim();
      // Match link format: [规格](group/name.md)
      let fileMatch = linksCell.match(/\[(?:规格|spec)\]\(([^)]+\.md)\)/);
      if (fileMatch) {
        const specFileName = fileMatch[1];
        const c = counts.get(specFileName);
        if (c) {
          newLines.push(`| ${feature} | ${description} | ${c.usCount} | ${c.frCount} | [规格](${specFileName}) |`);
          continue;
        }
      }
    }
    newLines.push(line);
    continue;
  }
  if (inSpecsTable && !line.startsWith("|")) {
    inSpecsTable = false;
    // Append specs in this section's directory not already in the README
    for (const file of specFiles) {
      const dir = file.includes("/") ? file.split("/")[0] : "";
      if (dir !== currentDir) continue;
      if (existingFiles.has(file)) continue;
      const c = counts.get(file);
      if (!c) continue;
      const content = fs.readFileSync(path.join(specsDir, file), "utf-8");
      const titleMatch = content.match(/^# 功能规格说明：(.+)/m);
      const title = titleMatch ? titleMatch[1] : file;
      newLines.push(`| ${title} |  | ${c.usCount} | ${c.frCount} | [规格](${file}) |`);
    }
  }
  newLines.push(line);
}

readme = newLines.join("\n");

fs.writeFileSync(readmePath, readme);
console.log("已更新 docs/specs/index.md");
