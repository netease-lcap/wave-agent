import { Agent } from "../../src/agent.js";
import * as path from "path";

const SUPERPOWERS_PATH = path.join(process.env.HOME!, "github/superpowers");

async function main() {
  console.log(
    `Verifying superpowers SessionStart hook at: ${SUPERPOWERS_PATH}\n`,
  );

  const agent = await Agent.create({
    plugins: [{ type: "local", path: SUPERPOWERS_PATH }],
    model: process.env.WAVE_FAST_MODEL,
    systemPromptOverride: "You are a helpful assistant. Keep responses brief.",
  });

  try {
    // The SessionStart hook fires during Agent.create and injects the
    // "using-superpowers" skill content as additional context.
    // We verify by asking the AI about superpowers.

    console.log(
      "Sending message to check if SessionStart hook injected context...\n",
    );

    await agent.sendMessage(
      "Do you have superpowers? Answer yes or no. If yes, quote the first line of the 'using-superpowers' skill you received.",
    );

    const messages = agent.messages;
    const lastMessage = messages[messages.length - 1];
    const textBlock = lastMessage.blocks.find((b) => b.type === "text");
    const responseText =
      textBlock?.type === "text" ? textBlock.content : "No text response";

    console.log("Agent response:");
    console.log(responseText);

    if (/yes/i.test(responseText) && /superpowers/i.test(responseText)) {
      console.log(
        "\n✅ SessionStart hook executed — superpowers context was injected via CLAUDE_PLUGIN_ROOT!",
      );
    } else {
      console.log(
        "\n⚠️  SessionStart hook may not have fired or context not injected.",
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
