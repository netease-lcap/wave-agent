import { execSync } from "node:child_process";

/**
 * Simple hello world using acpx and wave --acp
 */
async function runHello() {
  console.log("--- Running acpx hello ---");
  try {
    const output = execSync(
      'acpx --agent "wave --acp" --approve-all exec "hello"',
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
