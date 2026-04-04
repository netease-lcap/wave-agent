/**
 * Basic Permission System Example
 *
 * This example demonstrates the basic usage of the Wave Agent SDK permission system.
 * Shows how to use default mode, bypass mode, and custom permission callbacks.
 */

import {
  Agent,
  type PermissionDecision,
  type ToolPermissionContext,
} from "../src/index.js";

async function main() {
  console.log("🔒 Wave Agent SDK Permission System Examples\n");

  let defaultAgent: Agent | undefined;
  let bypassAgent: Agent | undefined;
  let customAgent: Agent | undefined;

  try {
    // Example 1: Default Safe Mode
    console.log(
      "1️⃣  Default Safe Mode (would prompt for confirmations in CLI):",
    );
    defaultAgent = await Agent.create({
      permissionMode: "default", // This is the default value
      logger: {
        debug: () => {},
        info: (msg) => console.log(`   ℹ️  ${msg}`),
        warn: (msg) => console.log(`   ⚠️  ${msg}`),
        error: (msg) => console.log(`   ❌ ${msg}`),
      },
    });
    console.log("   ✅ Agent created with default safe mode");
    console.log(
      "   📝 In CLI, this would prompt before Edit/Bash/Write operations\n",
    );

    // Example 2: Bypass Mode (Dangerous!)
    console.log("2️⃣  Bypass Mode (dangerous - no confirmations):");
    bypassAgent = await Agent.create({
      permissionMode: "bypassPermissions",
      logger: {
        debug: () => {},
        info: (msg) => console.log(`   ℹ️  ${msg}`),
        warn: (msg) => console.log(`   ⚠️  ${msg}`),
        error: (msg) => console.log(`   ❌ ${msg}`),
      },
    });
    console.log("   ✅ Agent created with bypass mode");
    console.log("   ⚠️  All tools will execute without permission checks\n");

    // Example 3: Custom Permission Logic
    console.log("3️⃣  Custom Permission Logic:");
    customAgent = await Agent.create({
      permissionMode: "default",
      canUseTool: async (
        context: ToolPermissionContext,
      ): Promise<PermissionDecision> => {
        console.log(
          `   🔍 Permission check requested for: ${context.toolName}`,
        );

        // Example business logic
        if (context.toolName === "Bash") {
          console.log("   ❌ Denying Bash execution (company policy)");
          return {
            behavior: "deny",
            message: "Bash execution not allowed by company policy",
          };
        }

        if (context.toolName === "Write") {
          console.log("   ❌ Denying Write operations (safety first)");
          return {
            behavior: "deny",
            message: "File writing disabled for safety",
          };
        }

        console.log(`   ✅ Allowing ${context.toolName} operation`);
        return { behavior: "allow" };
      },
      logger: {
        debug: () => {},
        info: (msg) => console.log(`   ℹ️  ${msg}`),
        warn: (msg) => console.log(`   ⚠️  ${msg}`),
        error: (msg) => console.log(`   ❌ ${msg}`),
      },
    });
    console.log("   ✅ Agent created with custom permission logic");
    console.log("   📋 Custom logic: Allow Edit, Deny Bash/Write\n");

    console.log("🎉 All examples completed successfully!");
    console.log(
      "\n📖 See other permission examples for more advanced use cases.",
    );
  } finally {
    // Cleanup
    if (defaultAgent) await defaultAgent.destroy();
    if (bypassAgent) await bypassAgent.destroy();
    if (customAgent) await customAgent.destroy();
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
