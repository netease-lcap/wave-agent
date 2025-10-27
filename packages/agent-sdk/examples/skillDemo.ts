#!/usr/bin/env tsx

import { SkillManager } from "../src/managers/skillManager.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

async function main() {
  const tempDir = join(tmpdir(), `skill-demo-${Date.now()}`);
  const skillsDir = join(tempDir, ".wave", "skills");

  try {
    // Setup temp skills
    await mkdir(skillsDir, { recursive: true });
    await mkdir(join(skillsDir, "hello-world"), { recursive: true });

    await writeFile(
      join(skillsDir, "hello-world", "SKILL.md"),
      `---
name: hello-world
description: A simple greeting skill
---

# Hello World Skill

This demonstrates how Wave Skills work - user-defined automation templates
that the AI agent can discover and execute.

## Features
- Automatic discovery from .wave/skills directories
- Frontmatter validation
- Caching for performance
`,
    );

    // Demo SkillManager
    process.chdir(tempDir);
    const skillManager = new SkillManager({
      logger: {
        info: (...args: unknown[]) => console.log("ℹ️ ", ...args),
        debug: () => {}, // suppress debug logs for cleaner output
        warn: (...args: unknown[]) => console.log("⚠️ ", ...args),
        error: (...args: unknown[]) => console.log("❌", ...args),
      },
    });

    console.log("🚀 Initializing SkillManager...");
    await skillManager.initialize();

    console.log("\n📋 Available Skills:");
    skillManager.getAvailableSkills().forEach((skill) => {
      console.log(`  • ${skill.name}: ${skill.description}`);
    });

    console.log("\n🛠️  Creating and using skill tool...");
    const tool = skillManager.createTool();
    const result = await tool.execute(
      { skill_name: "hello-world" },
      { workdir: tempDir },
    );

    console.log(`\n✅ Result: ${result.shortResult}`);
    console.log(
      `📄 Content preview:\n${result.content.split("\n").slice(0, 3).join("\n")}...`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    console.log("\n🧹 Demo complete");
  }
}

main().catch(console.error);
