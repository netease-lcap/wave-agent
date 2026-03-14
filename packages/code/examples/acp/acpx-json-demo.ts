import { execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/**
 * Example of getting JSON output from acpx to interact with wave --acp
 */
async function runAcpxJsonExample() {
  const agentCommand = "tsx --tsconfig tsconfig.dev.json src/index.ts --acp";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acpx-json-"));
  console.log(`Using temporary directory: ${tmpDir}`);
  console.log("--- Running acpx with JSON output ---");
  try {
    const output = execSync(
      `acpx --cwd ${tmpDir} --agent "${agentCommand}" --approve-all --format json exec "hello"`,
      { encoding: "utf8" },
    );
    const lines = output.trim().split("\n");
    const jsonObjects = lines.map((line) => JSON.parse(line));
    console.log(
      "Parsed JSON output (first 3 objects):",
      JSON.stringify(jsonObjects.slice(0, 3), null, 2),
    );

    // Find the final result
    const finalResult = jsonObjects.find((obj) => obj.id === 2 && obj.result);
    console.log("Final result:", JSON.stringify(finalResult, null, 2));
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error running acpx with JSON:", error.message);
    }
  }
}

runAcpxJsonExample().catch(console.error);
