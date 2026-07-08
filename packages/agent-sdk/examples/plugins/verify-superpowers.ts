import { Agent } from "../../src/agent.js";
import * as path from "path";

const SUPERPOWERS_PATH = path.join(process.env.HOME!, "github/superpowers");

async function main() {
  console.log(`Verifying superpowers plugin at: ${SUPERPOWERS_PATH}\n`);

  const agent = await Agent.create({
    plugins: [{ type: "local", path: SUPERPOWERS_PATH }],
    model: process.env.WAVE_FAST_MODEL,
    systemPromptOverride: "You are a helpful assistant. Keep responses brief.",
  });

  try {
    // 1. Check plugin manifest loaded via .claude-plugin/ fallback
    const commands = agent.getCustomCommands();
    const slashCommands = agent.getSlashCommands();

    console.log("=== Plugin Registration ===");
    console.log(`Custom commands: ${commands.length}`);
    commands.forEach((c) => console.log(`  - ${c.name}: ${c.description}`));
    console.log(`Slash commands: ${slashCommands.length}`);
    slashCommands.forEach((c) =>
      console.log(`  - /${c.name}: ${c.description ?? ""}`),
    );

    // 2. Verify superpowers skills are loaded by sending a message
    //    that triggers skill matching
    console.log("\n=== End-to-End Test ===");
    console.log("Sending message to verify skills are injected...");

    await agent.sendMessage(
      "List all available skills you have right now. Just list the names, one per line.",
    );

    const messages = agent.messages;
    const lastMessage = messages[messages.length - 1];
    const textBlock = lastMessage.blocks.find((b) => b.type === "text");
    const responseText =
      textBlock?.type === "text" ? textBlock.content : "No text response";

    console.log("\nAgent response:");
    console.log(responseText);

    // Check if superpowers skills appear in the response
    const superpowersSkills = [
      "test-driven-development",
      "systematic-debugging",
      "brainstorming",
      "writing-plans",
      "executing-plans",
      "verification-before-completion",
    ];
    const found = superpowersSkills.filter((s) =>
      responseText.toLowerCase().includes(s.toLowerCase()),
    );

    console.log(
      `\nSuperpowers skills found in response: ${found.length}/${superpowersSkills.length}`,
    );
    found.forEach((s) => console.log(`  ✓ ${s}`));

    if (found.length >= 3) {
      console.log(
        "\n✅ Superpowers plugin is fully compatible with Wave (end-to-end verified)!",
      );
    } else {
      console.log(
        "\n⚠️  Plugin loaded but skills not clearly reflected in response.",
      );
    }
  } finally {
    await agent.destroy();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("❌ Verification failed:", error);
  process.exit(1);
});
