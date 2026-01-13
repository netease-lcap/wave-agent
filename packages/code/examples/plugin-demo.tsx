import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/components/App.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

/**
 * This example demonstrates how to load a local plugin into the Wave Code App.
 * It creates a temporary plugin and then renders the App with that plugin.
 */
async function main() {
  // 1. Create a temporary plugin
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-code-plugin-demo-"),
  );
  const pluginDir = path.join(tempDir, "demo-plugin");
  const wavePluginDir = path.join(pluginDir, ".wave-plugin");
  const commandsDir = path.join(pluginDir, "commands");

  await fs.mkdir(pluginDir, { recursive: true });
  await fs.mkdir(wavePluginDir, { recursive: true });
  await fs.mkdir(commandsDir, { recursive: true });

  await fs.writeFile(
    path.join(wavePluginDir, "plugin.json"),
    JSON.stringify(
      {
        name: "demo-plugin",
        description: "A demo plugin for the CLI",
        version: "1.0.0",
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(commandsDir, "hello.md"),
    `---
description: A friendly greeting from the demo plugin
---

# Hello from Demo Plugin

This command was loaded from a local plugin!
`,
  );

  console.log(`Created temporary plugin at: ${pluginDir}`);

  try {
    console.log("Starting Wave Code App with plugin...");

    // 2. Render the App with the plugin directory
    // We use bypassPermissions to simplify the demo
    const { lastFrame, unmount } = render(
      <App pluginDirs={[pluginDir]} bypassPermissions={true} />,
    );

    // Give it a moment to initialize the agent and load plugins
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("\n📸 Current Interface State:");
    console.log("---------------------------");
    console.log(lastFrame());
    console.log("---------------------------");

    console.log(
      "\nPlugin should be loaded. You can now use /demo-plugin:hello",
    );

    // Clean up
    unmount();
    console.log("\n✨ Demo completed!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
  } finally {
    // 3. Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\nCleaned up temporary directory: ${tempDir}`);
  }
}

// Handle errors
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise rejection:", reason);
});

main().catch((error) => {
  console.error("❌ Error occurred while running demo:", error);
  process.exit(1);
});
