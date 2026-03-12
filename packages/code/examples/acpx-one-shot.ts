import { execSync } from "node:child_process";

/**
 * One-shot command using acpx and wave --acp
 */
async function runOneShot() {
  console.log("--- Running acpx one-shot: list files ---");
  try {
    const output = execSync(
      'acpx --agent "wave --acp" --approve-all exec "list files in the current directory"',
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
