#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

async function main() {
  const tempDir = join(tmpdir(), `skill-args-bash-demo-${Date.now()}`);
  const skillsDir = join(tempDir, ".wave", "skills");
  const skillName = "test-skill";
  const skillPath = join(skillsDir, skillName);

  let agent: Agent | undefined;

  try {
    // 1. Setup temp skills directory
    await mkdir(skillPath, { recursive: true });

    // 2. Create a skill that uses arguments and bash commands
    await writeFile(
      join(skillPath, "SKILL.md"),
      `---
name: ${skillName}
description: A test skill with arguments and bash execution
---

# Skill with Args and Bash

Hello $1! 
You provided these arguments: $ARGUMENTS

Current working directory: !\`pwd\`
Files in this directory:
!\`ls -F\`

This skill was invoked with arguments and executed bash commands.
`,
    );

    // 3. Initialize agent in temp directory
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    console.log(
      "🚀 Initializing Agent with Skill Arguments and Bash support...\n",
    );

    agent = await Agent.create({
      model: process.env.WAVE_FAST_MODEL, // Using a fast model as suggested
      workdir: tempDir,
      callbacks: {
        onAssistantContentUpdated: (chunk: string) => {
          process.stdout.write(chunk);
        },
        onToolBlockUpdated: (params) => {
          if (params.result) {
            console.log(`\n🛠️  Tool Result:\n${params.result}\n`);
          }
        },
        onErrorBlockAdded: (error) => {
          console.error(`❌ Error: ${error}`);
        },
      },
    });

    console.log(
      `💬 Invoking skill via slash command: /${skillName} World "and friends"\n`,
    );

    // 4. Invoke the skill using the new slash command support for skills
    console.log(
      `💬 Invoking skill via slash command: /${skillName} World "and friends"\n`,
    );
    await agent.sendMessage(`/${skillName} World "and friends"`);

    console.log("\n\n💬 Asking AI to use the skill tool with arguments...\n");
    // 5. Ask the AI to use the skill tool with arguments
    await agent.sendMessage(
      `Please use the skill tool to invoke ${skillName} with the argument "AI-User".`,
    );

    console.log("\n\n✅ Demo complete");

    process.chdir(originalCwd);
  } catch (error) {
    console.error("Error in demo:", error);
  } finally {
    if (agent) {
      await agent.destroy();
    }
    await rm(tempDir, { recursive: true, force: true });
    console.log("🧹 Cleaned up temporary directory");
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
