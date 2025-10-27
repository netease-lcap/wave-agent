#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

async function main() {
  const tempDir = join(tmpdir(), `skill-demo-${Date.now()}`);
  const skillsDir = join(tempDir, ".wave", "skills");

  try {
    // Setup temp skills with additional resource file
    await mkdir(skillsDir, { recursive: true });
    await mkdir(join(skillsDir, "hello-world"), { recursive: true });

    // Create a sample skill with reference to additional file
    await writeFile(
      join(skillsDir, "hello-world", "SKILL.md"),
      `---
name: hello-world
description: A simple greeting skill with template
---

# Hello World Skill

This demonstrates Wave Skills - user-defined automation templates that the AI agent can discover and execute.

## Template File
See the \`template.txt\` file in this skill directory for the greeting template.

## Features
- Automatic discovery from .wave/skills directories  
- Support for additional resource files in skill directory
- Frontmatter validation and caching
`,
    );

    // Create additional resource file
    await writeFile(
      join(skillsDir, "hello-world", "template.txt"),
      `Hello! Welcome to Wave Skills.

This is a template file that shows how skills can include additional resources.
The AI agent can access this file using the skill directory path.

Template Variables:
- {name}: User's name
- {date}: Current date
- {project}: Project name
`,
    );

    // Initialize agent in temp directory
    process.chdir(tempDir);

    console.log("🚀 Initializing Agent with Wave Skills support...\n");

    const agent = await Agent.create({
      callbacks: {
        onAssistantMessageAdded: (content) => {
          if (content) {
            console.log("🤖 Assistant:", content);
          }
        },
        onToolBlockUpdated: (params) => {
          if (params.result) {
            console.log(`\n🛠️  Tool Result:\n${params.result}\n`);
          }
        },
        onErrorBlockAdded: (error) => {
          console.log(`❌ Error: ${error}`);
        },
      },
    });

    console.log("💬 Asking agent to discover and use Wave skills...\n");

    // Send message to discover and use skills
    await agent.sendMessage(
      "Please use the skill tool to invoke the hello-world Wave skill, then read the template.txt file from that skill directory.",
    );

    // Show final state
    console.log(
      `\n📊 Final state: ${agent.messages.length} messages exchanged`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    console.log("\n🧹 Demo complete");
  }
}

main().catch(console.error);
