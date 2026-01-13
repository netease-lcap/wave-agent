import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

async function main() {
  // 1. Create a temporary directory for our plugin
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-plugin-example-"),
  );
  const pluginDir = path.join(tempDir, "my-plugin");
  const wavePluginDir = path.join(pluginDir, ".wave-plugin");
  const commandsDir = path.join(pluginDir, "commands");

  await fs.mkdir(pluginDir, { recursive: true });
  await fs.mkdir(wavePluginDir, { recursive: true });
  await fs.mkdir(commandsDir, { recursive: true });

  // 2. Create the plugin manifest
  const manifest = {
    name: "example-plugin",
    description: "An example plugin for demonstration",
    version: "1.0.0",
    author: {
      name: "Wave Developer",
    },
  };
  await fs.writeFile(
    path.join(wavePluginDir, "plugin.json"),
    JSON.stringify(manifest, null, 2),
  );

  // 3. Create a slash command
  const helloCommand = `---
description: A friendly greeting from the plugin
---

# Hello from Plugin

Hello! I am a command from the example plugin. How can I help you today?
`;
  await fs.writeFile(path.join(commandsDir, "hello.md"), helloCommand);

  console.log(`Created example plugin at: ${pluginDir}`);

  try {
    // 4. Initialize the agent with the local plugin
    const agent = await Agent.create({
      plugins: [{ type: "local", path: pluginDir }],
      // Use a mock or real API key/baseURL if needed,
      // but for slash commands that don't call AI it might not be strictly necessary
      // depending on how the command is handled.
      // In this case, the command content is sent to AI, so we need a valid config if we want it to respond.
      // However, we can just verify it's registered.
    });

    console.log("Agent initialized with plugins.");

    // 5. List available slash commands
    const commands = agent.getSlashCommands();
    console.log("Available commands:");
    commands.forEach((cmd) => {
      console.log(` - /${cmd.name}: ${cmd.description}`);
    });

    // 6. Execute the plugin command
    console.log("\nExecuting /example-plugin:hello...");
    // Note: This will attempt to send a message to AI.
    // If you don't have WAVE_API_KEY set, it might fail here.
    // But the registration is what we're demonstrating.

    if (process.env.WAVE_API_KEY) {
      await agent.sendMessage("/example-plugin:hello");
      const messages = agent.messages;
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks.find((b) => b.type === "text");
      console.log("\nAgent Response:");
      console.log(
        textBlock?.type === "text" ? textBlock.content : "No text response",
      );
    } else {
      console.log("\nSkipping execution because WAVE_API_KEY is not set.");
      console.log(
        "You can run this example with a valid API key to see the full flow.",
      );
    }

    await agent.destroy();
  } finally {
    // 7. Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\nCleaned up temporary directory: ${tempDir}`);
  }
}

main().catch(console.error);
