import { execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/**
 * One-shot command using acpx and wave --acp
 */
async function runOneShot() {
  const agentCommand = `tsx --tsconfig ${path.join(process.cwd(), "tsconfig.dev.json")} ${path.join(process.cwd(), "src/index.ts")} --acp`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acpx-one-shot-"));
  console.log(`Using temporary directory: ${tmpDir}`);
  console.log("--- Running acpx one-shot: list files ---");
  try {
    const output = execSync(
      `acpx --cwd ${tmpDir} --agent "${agentCommand}" --approve-all exec "list files in the current directory"`,
      { encoding: "utf8" },
    );
    console.log(output);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error running acpx one-shot:", error.message);
    }
  }
}

runOneShot().catch(console.error);
