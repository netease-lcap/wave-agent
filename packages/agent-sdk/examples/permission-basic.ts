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

  // Example 1: Default Safe Mode
  console.log("1️⃣  Default Safe Mode (would prompt for confirmations in CLI):");
  const defaultAgent = await Agent.create({
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
    "   📝 In CLI, this would prompt before Edit/Delete/Bash/Write operations\n",
  );

  // Example 2: Bypass Mode (Dangerous!)
  console.log("2️⃣  Bypass Mode (dangerous - no confirmations):");
  const bypassAgent = await Agent.create({
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
  const customAgent = await Agent.create({
    permissionMode: "default",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      console.log(`   🔍 Permission check requested for: ${context.toolName}`);

      // Example business logic
      if (context.toolName === "Bash") {
        console.log("   ❌ Denying Bash execution (company policy)");
        return {
          behavior: "deny",
          message: "Bash execution not allowed by company policy",
        };
      }

      if (context.toolName === "Delete") {
        console.log("   ❌ Denying Delete operations (safety first)");
        return {
          behavior: "deny",
          message: "File deletion disabled for safety",
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
  console.log(
    "   📋 Custom logic: Allow Edit/MultiEdit/Write, Deny Bash/Delete\n",
  );

  // Cleanup
  defaultAgent.destroy();
  bypassAgent.destroy();
  customAgent.destroy();

  console.log("🎉 All examples completed successfully!");
  console.log(
    "\n📖 See other permission examples for more advanced use cases.",
  );
}

main().catch(console.error);
