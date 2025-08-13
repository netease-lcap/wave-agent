import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCli } from "./cli.js";

// Export main function for external use
export async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("workdir", {
      alias: "w",
      description: "Working directory path",
      type: "string",
      default: process.cwd(),
    })
    .option("ignore", {
      alias: "i",
      description: "Additional ignore patterns (can be used multiple times)",
      type: "array",
      string: true,
    })
    .example("$0", "Start CLI with default settings")
    .example("$0 --workdir /path/to/project", "Use custom working directory")
    .example(
      '$0 --ignore "*.log" --ignore "temp/*"',
      "Add custom ignore patterns",
    )
    .help()
    .parseAsync();

  await startCli({
    workdir: argv.workdir,
    ignore: argv.ignore as string[],
  });
}

// Export other functions that might be needed
export { startCli } from "./cli.js";

// Execute main function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Failed to start LCAP Code:", error);
    process.exit(1);
  });
}
