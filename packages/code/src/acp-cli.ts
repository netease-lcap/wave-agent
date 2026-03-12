import { startAcpCli } from "./acp/index.js";

export async function runAcp() {
  await startAcpCli();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAcp().catch((error) => {
    console.error("Failed to start WAVE ACP:", error);
    process.exit(1);
  });
}
