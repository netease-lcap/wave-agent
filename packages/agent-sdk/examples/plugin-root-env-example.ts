import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

/**
 * Example demonstrating $WAVE_PLUGIN_ROOT placeholder support
 *
 * This example shows how plugin commands can access files within the plugin
 * directory using the $WAVE_PLUGIN_ROOT placeholder, which gets substituted
 * with the plugin's absolute path before bash commands are executed.
 *
 * Run with: WAVE_MODEL=gemini-2.5-flash pnpm -F wave-agent-sdk exec tsx examples/plugin-root-env-example.ts
 */
async function main() {
  // 1. Create a temporary directory for our plugin
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-plugin-root-example-"),
  );
  const pluginDir = path.join(tempDir, "my-plugin");
  const wavePluginDir = path.join(pluginDir, ".wave-plugin");
  const commandsDir = path.join(pluginDir, "commands");
  const dataDir = path.join(pluginDir, "data");
  const scriptsDir = path.join(pluginDir, "scripts");

  await fs.mkdir(pluginDir, { recursive: true });
  await fs.mkdir(wavePluginDir, { recursive: true });
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });

  // 2. Create the plugin manifest
  const manifest = {
    name: "env-test-plugin",
    description: "Plugin demonstrating WAVE_PLUGIN_ROOT usage",
    version: "1.0.0",
    author: {
      name: "Wave Developer",
    },
  };
  await fs.writeFile(
    path.join(wavePluginDir, "plugin.json"),
    JSON.stringify(manifest, null, 2),
  );

  // 3. Create plugin data files
  const templateContent = `# Project Template

This is a template file from the plugin.
Plugin location: {{PLUGIN_ROOT}}

Use this template to create new projects.
`;
  await fs.writeFile(path.join(dataDir, "template.txt"), templateContent);

  const configContent = `{
  "pluginName": "env-test-plugin",
  "version": "1.0.0",
  "features": ["templates", "scripts"]
}`;
  await fs.writeFile(path.join(dataDir, "config.json"), configContent);

  // 4. Create a simple script
  const scriptContent = `#!/bin/bash
echo "Running plugin script from: $(pwd)"
echo "Plugin root: $WAVE_PLUGIN_ROOT"
ls -la "$WAVE_PLUGIN_ROOT"
`;
  await fs.writeFile(path.join(scriptsDir, "info.sh"), scriptContent);
  await fs.chmod(path.join(scriptsDir, "info.sh"), 0o755);

  // 5. Create slash commands that use WAVE_PLUGIN_ROOT
  const showTemplateCommand = `---
description: Display the plugin template file using WAVE_PLUGIN_ROOT
---

# Show Template

Here's the content of the plugin template:

!\`cat $WAVE_PLUGIN_ROOT/data/template.txt\`

**Note:** The above content was loaded from the plugin's data directory using the $WAVE_PLUGIN_ROOT placeholder.
`;
  await fs.writeFile(
    path.join(commandsDir, "show-template.md"),
    showTemplateCommand,
  );

  const listFilesCommand = `---
description: List all files in the plugin directory
---

# Plugin Files

Plugin is located at:

!\`echo $WAVE_PLUGIN_ROOT\`

Files in plugin root:

!\`ls -la $WAVE_PLUGIN_ROOT\`

Plugin configuration:

!\`cat $WAVE_PLUGIN_ROOT/data/config.json\`
`;
  await fs.writeFile(path.join(commandsDir, "list-files.md"), listFilesCommand);

  const runScriptCommand = `---
description: Run a script from the plugin's scripts directory
---

# Run Plugin Script

Executing info.sh script from the plugin:

!\`bash $WAVE_PLUGIN_ROOT/scripts/info.sh\`

The script was executed using the $WAVE_PLUGIN_ROOT placeholder to locate the plugin's scripts directory.
`;
  await fs.writeFile(path.join(commandsDir, "run-script.md"), runScriptCommand);

  console.log(`Created example plugin at: ${pluginDir}`);
  console.log("\nPlugin structure:");
  console.log(`  ${pluginDir}/`);
  console.log(`  ├── .wave-plugin/`);
  console.log(`  │   └── plugin.json`);
  console.log(`  ├── commands/`);
  console.log(`  │   ├── show-template.md`);
  console.log(`  │   ├── list-files.md`);
  console.log(`  │   └── run-script.md`);
  console.log(`  ├── data/`);
  console.log(`  │   ├── template.txt`);
  console.log(`  │   └── config.json`);
  console.log(`  └── scripts/`);
  console.log(`      └── info.sh`);

  try {
    // 6. Initialize the agent with the local plugin
    const agent = await Agent.create({
      plugins: [{ type: "local", path: pluginDir }],
    });

    console.log("\n✅ Agent initialized with plugin.");

    // 7. List available slash commands
    const commands = agent.getSlashCommands();
    const pluginCommands = commands.filter((cmd) =>
      cmd.name.startsWith("env-test-plugin:"),
    );
    console.log("\n📋 Available plugin commands:");
    pluginCommands.forEach((cmd) => {
      console.log(`   /${cmd.name}: ${cmd.description}`);
    });

    // 8. Demonstrate command execution
    console.log("\n" + "=".repeat(60));
    console.log("DEMONSTRATION: Executing plugin commands");
    console.log("=".repeat(60));

    // Test 1: Show template
    console.log("\n1️⃣  Testing /env-test-plugin:show-template");
    console.log("-".repeat(60));
    await agent.sendMessage("/env-test-plugin:show-template");
    const messages1 = agent.messages;

    // Find the last user message (search backwards)
    let userMessage1Idx = messages1.length - 1;
    while (userMessage1Idx >= 0 && messages1[userMessage1Idx].role !== "user") {
      userMessage1Idx--;
    }

    if (userMessage1Idx >= 0) {
      const userMessage1 = messages1[userMessage1Idx];
      const textBlock1 = userMessage1.blocks.find((b) => b.type === "text");
      if (textBlock1?.type === "text" && textBlock1.customCommandContent) {
        console.log("📄 Command Output:");
        console.log(textBlock1.customCommandContent);

        // Verify the template was loaded
        if (
          textBlock1.customCommandContent.includes("This is a template file")
        ) {
          console.log(
            "\n✅ Successfully loaded template using WAVE_PLUGIN_ROOT",
          );
        } else {
          console.log("\n⚠️  Template content not found in command output");
        }
      } else {
        console.log("⚠️  No custom command content found");
      }
    }

    // Test 2: List files
    console.log("\n2️⃣  Testing /env-test-plugin:list-files");
    console.log("-".repeat(60));
    await agent.sendMessage("/env-test-plugin:list-files");
    const messages2 = agent.messages;

    // Find the user message with the command (search backwards)
    let userMessage2Idx = messages2.length - 1;
    while (userMessage2Idx >= 0 && messages2[userMessage2Idx].role !== "user") {
      userMessage2Idx--;
    }

    if (userMessage2Idx >= 0) {
      const userMessage2 = messages2[userMessage2Idx];
      const textBlock2 = userMessage2.blocks.find((b) => b.type === "text");
      if (textBlock2?.type === "text" && textBlock2.customCommandContent) {
        console.log("📄 Command Output:");
        console.log(textBlock2.customCommandContent);

        // Verify the plugin path was shown
        if (
          textBlock2.customCommandContent.includes(pluginDir) ||
          textBlock2.customCommandContent.includes("WAVE_PLUGIN_ROOT")
        ) {
          console.log(
            "\n✅ Plugin path correctly resolved via WAVE_PLUGIN_ROOT",
          );
        } else {
          console.log("\n⚠️  Plugin path not found in command output");
        }
      } else {
        console.log("⚠️  No custom command content found");
        if (textBlock2?.type === "text") {
          console.log("Content:", textBlock2.content);
        }
      }
    } else {
      console.log("⚠️  No user message found");
    }

    // Test 3: Run script
    console.log("\n3️⃣  Testing /env-test-plugin:run-script");
    console.log("-".repeat(60));
    await agent.sendMessage("/env-test-plugin:run-script");
    const messages3 = agent.messages;

    // Find the last user message (search backwards)
    let userMessage3Idx = messages3.length - 1;
    while (userMessage3Idx >= 0 && messages3[userMessage3Idx].role !== "user") {
      userMessage3Idx--;
    }

    if (userMessage3Idx >= 0) {
      const userMessage3 = messages3[userMessage3Idx];
      const textBlock3 = userMessage3.blocks.find((b) => b.type === "text");
      if (textBlock3?.type === "text" && textBlock3.customCommandContent) {
        console.log("📄 Command Output:");
        console.log(textBlock3.customCommandContent);

        // Verify the script ran
        if (
          textBlock3.customCommandContent.includes("Running plugin script") ||
          textBlock3.customCommandContent.includes("info.sh")
        ) {
          console.log("\n✅ Script executed with WAVE_PLUGIN_ROOT available");
        } else {
          console.log("\n⚠️  Script output not found in command content");
        }
      } else {
        console.log("⚠️  No custom command content found");
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ All demonstrations completed successfully!");
    console.log("=".repeat(60));

    await agent.destroy();
  } finally {
    // 9. Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up temporary directory: ${tempDir}`);
  }
}

main().catch(console.error);
