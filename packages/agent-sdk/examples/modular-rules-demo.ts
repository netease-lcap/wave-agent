#!/usr/bin/env tsx

/**
 * Modular Rules Feature Demo
 *
 * This example demonstrates the modular rules feature which allows organizing
 * memory rules into multiple files within `.wave/rules/` directory.
 *
 * Features demonstrated:
 * 1. Project-level modular rules in `.wave/rules/`
 * 2. Path-specific rules with YAML frontmatter
 * 3. Global rules without path restrictions
 * 4. Subdirectory organization
 * 5. Rule activation based on file context
 */

import { Agent } from "../src/agent.js";
import { mkdir, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Test workspace setup
async function setupTestWorkspace(): Promise<string> {
  const testDir = join(tmpdir(), `modular-rules-demo-${Date.now()}`);
  const waveRulesDir = join(testDir, ".wave", "rules");
  const srcApiDir = join(testDir, "src", "api");
  const srcUiDir = join(testDir, "src", "ui");
  const testsDir = join(testDir, "tests");

  // Create directory structure
  await mkdir(waveRulesDir, { recursive: true });
  await mkdir(srcApiDir, { recursive: true });
  await mkdir(srcUiDir, { recursive: true });
  await mkdir(testsDir, { recursive: true });

  console.log("📁 Created test workspace at:", testDir);

  // Create sample source files
  await writeFile(
    join(srcApiDir, "users.ts"),
    `// API endpoint for user management
export class UserController {
  getUsers() {
    return [];
  }
}`,
  );

  await writeFile(
    join(srcUiDir, "Button.tsx"),
    `// UI Button component
export function Button() {
  return <button>Click me</button>;
}`,
  );

  await writeFile(
    join(testsDir, "users.test.ts"),
    `// Test file for user API
test('getUsers returns empty array', () => {
  expect(true).toBe(true);
});`,
  );

  // Rule 1: Global code style rules (no path restriction)
  await writeFile(
    join(waveRulesDir, "code-style.md"),
    `# Code Style Guide

- Use 2 spaces for indentation
- Always use semicolons
- Prefer const over let when possible
- Use descriptive variable names`,
  );

  // Rule 2: API-specific rules with path restriction
  await writeFile(
    join(waveRulesDir, "api-guidelines.md"),
    `---
paths:
  - "src/api/**/*.ts"
---

# API Development Guidelines

- All controller classes must use PascalCase
- All public methods must have JSDoc comments
- Use async/await for all database operations
- Always validate input parameters
- Return proper HTTP status codes`,
  );

  // Rule 3: UI-specific rules with path restriction
  await writeFile(
    join(waveRulesDir, "ui-guidelines.md"),
    `---
paths:
  - "src/ui/**/*.tsx"
  - "src/ui/**/*.jsx"
---

# UI Development Guidelines

- All components must be functional components
- Use TypeScript for type safety
- Follow accessibility best practices (ARIA labels)
- Keep components small and focused
- Use CSS modules for styling`,
  );

  // Rule 4: Testing rules in a subdirectory
  const frontendRulesDir = join(waveRulesDir, "frontend");
  await mkdir(frontendRulesDir, { recursive: true });

  await writeFile(
    join(frontendRulesDir, "react-testing.md"),
    `---
paths:
  - "tests/**/*.test.ts"
  - "tests/**/*.test.tsx"
---

# React Testing Guidelines

- Use React Testing Library for component tests
- Write tests that resemble how users interact with the app
- Avoid testing implementation details
- Mock external dependencies
- Aim for 80% code coverage`,
  );

  // Rule 5: Multiple path patterns with brace expansion
  await writeFile(
    join(waveRulesDir, "typescript-config.md"),
    `---
paths:
  - "src/**/*.{ts,tsx}"
  - "tests/**/*.{ts,tsx}"
---

# TypeScript Configuration

- Enable strict mode in tsconfig.json
- No explicit \`any\` types unless absolutely necessary
- Use interfaces for object shapes
- Export types that might be reused`,
  );

  console.log("📝 Created sample memory rules:");
  console.log("   - code-style.md (global)");
  console.log("   - api-guidelines.md (src/api/**/*.ts)");
  console.log("   - ui-guidelines.md (src/ui/**/*.{tsx,jsx})");
  console.log("   - frontend/react-testing.md (tests/**/*.test.{ts,tsx})");
  console.log(
    "   - typescript-config.md (src/**/*.{ts,tsx}, tests/**/*.{ts,tsx})",
  );

  return testDir;
}

// Demo function
async function demoModularRules(): Promise<void> {
  let testDir: string | undefined;
  let agent: Agent | undefined;

  try {
    // Setup test workspace
    testDir = await setupTestWorkspace();

    // Create agent with the test workspace
    console.log("\n🤖 Creating Agent with modular rules...\n");

    const activeRulesLog: string[][] = [];

    agent = await Agent.create({
      workdir: testDir,
      agentModel: "gemini-2.0-flash-exp",
      logger: {
        debug: (...args: unknown[]) => {
          const message = args[0];
          if (
            typeof message === "string" &&
            message.startsWith("Active modular rules")
          ) {
            const rules = message
              .split(": ")[1]
              .split(", ")
              .map((r) => r.trim());
            activeRulesLog.push(rules);
          }
        },
        info: () => {},
        warn: () => {},
        error: (...args: unknown[]) => console.error("[ERROR]", ...args),
      },
      callbacks: {
        onAssistantContentUpdated: () => {},
        onToolBlockUpdated: () => {},
      },
    });

    console.log("\n✅ Agent created\n");

    // Test 1: Work with API file (should activate api-guidelines.md and global rules)
    console.log("=== Test 1: Working with API file ===");
    await agent.sendMessage(
      "Please review the file src/api/users.ts and tell me what coding guidelines apply to it based on the memory rules. List the specific rules that are active.",
    );

    const test1Rules = activeRulesLog[activeRulesLog.length - 1] || [];
    console.log("Active rules for Test 1:", test1Rules);
    if (
      test1Rules.includes("api-guidelines.md") &&
      test1Rules.includes("code-style.md") &&
      test1Rules.includes("typescript-config.md")
    ) {
      console.log("✅ Test 1 Passed: Correct rules activated");
    } else {
      console.error("❌ Test 1 Failed: Expected rules not found");
    }

    // Test 2: Work with UI file (should activate ui-guidelines.md and global rules)
    console.log("\n=== Test 2: Working with UI file ===");
    await agent.sendMessage(
      "Now review the file src/ui/Button.tsx. What guidelines apply to this file? Are they different from the API file?",
    );

    const test2Rules = activeRulesLog[activeRulesLog.length - 1] || [];
    console.log("Active rules for Test 2:", test2Rules);
    if (
      test2Rules.includes("ui-guidelines.md") &&
      test2Rules.includes("code-style.md") &&
      test2Rules.includes("typescript-config.md")
    ) {
      console.log("✅ Test 2 Passed: Correct rules activated");
    } else {
      console.error("❌ Test 2 Failed: Expected rules not found");
    }

    // Test 3: Work with test file (should activate react-testing.md and global rules)
    console.log("\n=== Test 3: Working with test file ===");
    await agent.sendMessage(
      "Finally, review tests/users.test.ts. What testing guidelines should I follow based on the memory rules?",
    );

    const test3Rules = activeRulesLog[activeRulesLog.length - 1] || [];
    console.log("Active rules for Test 3:", test3Rules);
    if (
      test3Rules.includes("frontend/react-testing.md") &&
      test3Rules.includes("code-style.md") &&
      test3Rules.includes("typescript-config.md")
    ) {
      console.log("✅ Test 3 Passed: Correct rules activated");
    } else {
      console.error("❌ Test 3 Failed: Expected rules not found");
    }

    console.log("\n\n✅ Demo completed successfully!");
    console.log("\n📊 Key Takeaways:");
    console.log("   - Global rules (code-style.md) apply to all files");
    console.log(
      "   - Path-specific rules only activate when working on matching files",
    );
    console.log("   - Multiple rules can be active simultaneously");
    console.log("   - Rules in subdirectories are discovered automatically");
    console.log("   - Glob patterns with brace expansion are supported");
  } catch (error) {
    console.error("\n❌ Demo failed:", error);
    throw error;
  } finally {
    // Cleanup
    if (agent) {
      console.log("\n🧹 Cleaning up agent...");
      await agent.destroy();
    }

    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
      console.log("🧹 Cleaned up test workspace");
    }

    console.log("👋 Done!");
  }
}

// Handle process exit
let isExiting = false;
const cleanup = async () => {
  if (isExiting) return;
  isExiting = true;
  console.log("\n\n🛑 Received exit signal, cleaning up...");
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demoModularRules().catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
}

export { demoModularRules, setupTestWorkspace };
