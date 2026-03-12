import { execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/**
 * Simple hello world using acpx and wave --acp
 */
async function runHello() {
  const agentCommand = "tsx --tsconfig tsconfig.dev.json src/acp-cli.ts";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acpx-hello-"));
  console.log(`Using temporary directory: ${tmpDir}`);
  console.log("--- Running acpx hello ---");
  try {
    const output = execSync(
      `acpx --cwd ${tmpDir} --agent "${agentCommand}" --approve-all exec "hello"`,
      { encoding: "utf8" },
    );
    console.log(output);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error running acpx hello:", error.message);
    }
  }
}

runHello().catch(console.error);
