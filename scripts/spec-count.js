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

let totalSpecs = 0;
let totalUS = 0;
let totalFR = 0;

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

  console.log(`${dir}  US: ${usCount}  FR: ${frCount}`);
}

console.log("---");
console.log(`Specs: ${totalSpecs}  User Stories: ${totalUS}  Functional Requirements: ${totalFR}`);
