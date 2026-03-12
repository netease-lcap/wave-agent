import { execSync } from "node:child_process";

/**
 * Example of getting JSON output from acpx to interact with wave --acp
 */
async function runAcpxJsonExample() {
  console.log("--- Running acpx with JSON output ---");
  try {
    const output = execSync(
      'acpx --agent "wave --acp" --approve-all --format json exec "hello"',
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
