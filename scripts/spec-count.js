#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specsDir = path.join(__dirname, "..", "specs");

const specDirs = fs
  .readdirSync(specsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

function walkDir(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(fullPath, callback);
    else callback(fullPath);
  }
}

let totalSpecs = 0;
let totalUS = 0;
let totalFR = 0;

// Count US/FR per spec dir
const counts = new Map(); // dir -> { usCount, frCount }

let hasWarnings = false;

for (const dir of specDirs) {
  const specFile = path.join(specsDir, dir, "spec.md");
  if (!fs.existsSync(specFile)) continue;

  totalSpecs++;
  const content = fs.readFileSync(specFile, "utf-8");

  const usMatches = content.match(/^### User Story \d+/gm);
  const usCount = usMatches ? usMatches.length : 0;
  totalUS += usCount;

  const frMatches = content.match(/^- \*\*FR-\d+\*\*/gm);
  const frCount = frMatches ? frMatches.length : 0;
  totalFR += frCount;

  counts.set(dir, { usCount, frCount });
  console.log(`${dir}  US: ${usCount}  FR: ${frCount}`);

  // Validate spec follows standard template
  const warnings = [];
  if (!content.match(/^## User Scenarios & Testing/m))
    warnings.push('missing "## User Scenarios & Testing" section');
  if (usCount === 0) warnings.push("no User Stories found (expected `### User Story N`)");
  if (frCount === 0) warnings.push("no Functional Requirements found (expected `- **FR-N**`)");
  for (let i = 1; i <= usCount; i++) {
    if (!content.includes(`### User Story ${i}`))
      warnings.push(`User Story ${i} heading skipped (non-sequential numbering)`);
  }
  if (!content.match(/\*\*FR-001\*\*/)) warnings.push("FR numbering doesn't start from FR-001");
  if (warnings.length) {
    hasWarnings = true;
    console.warn(`  ⚠ ${dir}: ${warnings.join("; ")}`);
  }
}

console.log("---");
console.log(`Specs: ${totalSpecs}  User Stories: ${totalUS}  Functional Requirements: ${totalFR}`);
if (hasWarnings) console.warn("⚠ Some specs have template warnings — see above.");

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

console.log(`Test Files: ${totalTestFiles}  Test Cases: ${totalTestCases.toLocaleString()}`);

// Update specs/README.md
const readmePath = path.join(specsDir, "README.md");
let readme = fs.readFileSync(readmePath, "utf-8");

// Update Stats table
readme = readme.replace(
  /^(\| Specs \| )\d+(\s*\|)$/m,
  `$1${totalSpecs}$2`,
);
readme = readme.replace(
  /^(\| User Stories \| )\d+(?:,\d+)*(\s*\|)$/m,
  `$1${totalUS.toLocaleString()}$2`,
);
readme = readme.replace(
  /^(\| Functional Requirements \| )\d+(?:,\d+)*(\s*\|)$/m,
  `$1${totalFR.toLocaleString()}$2`,
);
readme = readme.replace(
  /^(\| Test Files \| )\d+(?:,\d+)*(\s*\|)$/m,
  `$1${totalTestFiles.toLocaleString()}$2`,
);
readme = readme.replace(
  /^(\| Test Cases \| )\d+(?:,\d+)*(\s*\|)$/m,
  `$1${totalTestCases.toLocaleString()}$2`,
);

// Update Specs table: preserve existing Feature/Description/Links, add US/FR columns
// Parse existing table rows, match by spec dir in links column
const lines = readme.split("\n");
const newLines = [];
let inSpecsTable = false;
let headerDone = false;

for (const line of lines) {
  if (line.startsWith("| Feature |")) {
    inSpecsTable = true;
    headerDone = false;
    // Replace header to add US and FR columns
    newLines.push("| Feature | Description | US | FR | Links |");
    continue;
  }
  if (inSpecsTable && !headerDone && line.match(/^\|[-| ]+\|$/)) {
    headerDone = true;
    newLines.push("|---------|-------------|----|----|-------|");
    continue;
  }
  if (inSpecsTable && line.startsWith("|")) {
    // Parse row: | Feature | Description | [US | FR |] Links |
    // Split preserving structure — Feature and Description are first two cells, Links is last
    const cells = line.split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length >= 3) {
      const feature = cells[0].trim();
      const description = cells[1].trim();
      const linksCell = cells[cells.length - 1].trim();
      // Extract dir from first [spec](XXX/spec.md) link
      const dirMatch = linksCell.match(/\[spec\]\(([^/]+)\/spec\.md\)/);
      if (dirMatch) {
        const linkDir = dirMatch[1];
        let c = counts.get(linkDir);
        let actualDir = linkDir;
        // Fallback: match by numeric prefix if dir name differs
        if (!c) {
          const prefix = linkDir.match(/^\d+/)?.[0];
          if (prefix) {
            const match = [...counts.keys()].find((d) => d.startsWith(prefix));
            if (match) {
              c = counts.get(match);
              actualDir = match;
            }
          }
        }
        if (c) {
          // Fix stale links to point to actual dir name
          const fixedLinks = linksCell.replace(new RegExp(`\\b${linkDir}\\b`, "g"), actualDir);
          newLines.push(`| ${feature} | ${description} | ${c.usCount} | ${c.frCount} | ${fixedLinks} |`);
          continue;
        }
      }
    }
    // Fallback: keep line as-is if we can't parse
    newLines.push(line);
    continue;
  }
  if (inSpecsTable && !line.startsWith("|")) {
    inSpecsTable = false;
    // Append any spec dirs not already in the table
    const existingPrefixes = new Set(
      newLines
        .filter((l) => l.startsWith("|"))
        .map((l) => {
          const m = l.match(/\[spec\]\(([^/]+)\/spec\.md\)/);
          return m ? m[1].match(/^\d+/)?.[0] : null;
        })
        .filter(Boolean),
    );
    for (const dir of specDirs) {
      const specFile = path.join(specsDir, dir, "spec.md");
      if (!fs.existsSync(specFile)) continue;
      const prefix = dir.match(/^\d+/)?.[0];
      if (prefix && existingPrefixes.has(prefix)) continue;
      const c = counts.get(dir);
      if (!c) continue;
      const content = fs.readFileSync(specFile, "utf-8");
      const titleMatch = content.match(/^# Feature Specification: (.+)/m);
      const title = titleMatch ? titleMatch[1] : dir;
      const hasPlan = fs.existsSync(path.join(specsDir, dir, "plan.md"));
      const links = hasPlan
        ? `[spec](${dir}/spec.md) · [plan](${dir}/plan.md)`
        : `[spec](${dir}/spec.md)`;
      newLines.push(`| ${title} |  | ${c.usCount} | ${c.frCount} | ${links} |`);
    }
  }
  newLines.push(line);
}

readme = newLines.join("\n");

fs.writeFileSync(readmePath, readme);
console.log("Updated specs/README.md");
