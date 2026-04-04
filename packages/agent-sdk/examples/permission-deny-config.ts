import { Agent } from "../src/index.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

/**
 * This example demonstrates how to use the `permissions.deny` configuration in `settings.json`
 * to explicitly block specific tools.
 *
 * The Wave system loads configuration from `.wave/settings.json` and `.wave/settings.local.json`
 * in the project directory. Rules in `permissions.deny` take precedence over any `allow` rules.
 */
async function main() {
  console.log("🛡️  Permission Deny via Configuration Example\n");

  // 1. Create a temporary working directory for this example
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-deny-example-"),
  );
  const waveDir = path.join(tempDir, ".wave");
  await fs.mkdir(waveDir);

  // 2. Create a settings.json file that denies the 'Bash' tool
  const settings = {
    permissions: {
      deny: ["Bash"],
    },
  };
  await fs.writeFile(
    path.join(waveDir, "settings.json"),
    JSON.stringify(settings, null, 2),
  );

  console.log(`📂 Created temporary project at: ${tempDir}`);
  console.log(`📝 Configured permissions.deny: ["Bash"]\n`);

  // 3. Initialize the agent pointing to the temporary directory
  const agent = await Agent.create({
    model: "gemini-2.5-flash",
    workdir: tempDir,
    callbacks: {
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`🛠️  Agent attempting to use tool: ${params.name}`);
        }
        if (params.error) {
          // This is where we can see the denial message from the PermissionManager
          console.log(`❌ Tool Blocked: ${params.error}`);
        }
      },
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
    },
  });

  try {
    const prompt = "Run 'echo hello' in bash.";
    console.log(`👤 User: ${prompt}`);
    console.log("\n🤖 Assistant:");

    // 4. Send a message that triggers the denied tool
    await agent.sendMessage(prompt);
    console.log("\n");
  } catch (error) {
    console.error("\n❌ Error during execution:", error);
  } finally {
    // 5. Cleanup: destroy the agent and remove the temporary directory
    console.log("🧹 Cleaning up...");
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log("👋 Done!");
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
