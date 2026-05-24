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
}

console.log("---");
console.log(`Specs: ${totalSpecs}  User Stories: ${totalUS}  Functional Requirements: ${totalFR}`);

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
        // Fallback: match by numeric prefix if dir name differs
        if (!c) {
          const prefix = linkDir.match(/^\d+/)?.[0];
          if (prefix) {
            const match = [...counts.keys()].find((d) => d.startsWith(prefix));
            if (match) c = counts.get(match);
          }
        }
        if (c) {
          newLines.push(`| ${feature} | ${description} | ${c.usCount} | ${c.frCount} | ${linksCell} |`);
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
  }
  newLines.push(line);
}

readme = newLines.join("\n");

fs.writeFileSync(readmePath, readme);
console.log("Updated specs/README.md");
