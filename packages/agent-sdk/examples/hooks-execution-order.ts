#!/usr/bin/env tsx

/**
 * Hooks Execution Order Test
 * Verifies: UserPromptSubmit → PreToolUse → PostToolUse → Stop
 */

import { Agent } from "../src/agent.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function main() {
  console.log("🧪 Testing Hooks Execution Order\n");

  const testDir = join(tmpdir(), `hooks-test-${Date.now()}`);
  const logFile = join(testDir, "log.txt");

  mkdirSync(join(testDir, ".wave"), { recursive: true });
  writeFileSync(join(testDir, "test.js"), 'console.log("test");');

  // Configure all hook types
  const hooks = {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `echo "1.UserPromptSubmit" >> "${logFile}"`,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Edit",
        hooks: [
          { type: "command", command: `echo "2.PreToolUse" >> "${logFile}"` },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Edit",
        hooks: [
          { type: "command", command: `echo "3.PostToolUse" >> "${logFile}"` },
        ],
      },
    ],
    Stop: [
      {
        hooks: [{ type: "command", command: `echo "4.Stop" >> "${logFile}"` }],
      },
    ],
  };

  writeFileSync(
    join(testDir, ".wave", "settings.json"),
    JSON.stringify({ hooks }, null, 2),
  );

  try {
    const agent = await Agent.create({ workdir: testDir });
    await agent.sendMessage('Edit test.js and add comment "// test"');
    await agent.destroy();

    await new Promise((resolve) => setTimeout(resolve, 500));

    const log = readFileSync(logFile, "utf-8").trim();
    console.log("Execution Order:");
    console.log(log);

    const correct =
      log.includes("1.UserPromptSubmit") &&
      log.includes("2.PreToolUse") &&
      log.includes("3.PostToolUse") &&
      log.includes("4.Stop");

    console.log(
      `\n${correct ? "✅" : "❌"} Order ${correct ? "correct" : "incorrect"}`,
    );
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch(console.error);
