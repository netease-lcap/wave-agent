/**
 * Permission Mode: dontAsk Example
 *
 * This example demonstrates the 'dontAsk' permission mode.
 * In this mode, restricted tools (like Bash, Write, Edit) are automatically denied
 * unless they are explicitly allowed in the permissions configuration.
 * This prevents the agent from interrupting the user with permission prompts.
 */

import { Agent } from "../src/index.js";

async function main() {
  console.log("🔒 Wave Agent SDK: 'dontAsk' Permission Mode Example\n");

  // 1. Create an agent in 'dontAsk' mode
  console.log("1️⃣  Creating agent in 'dontAsk' mode...");
  const agent = await Agent.create({
    permissionMode: "dontAsk",
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log("   ✅ Agent created with 'dontAsk' mode.");
  console.log(
    "   📝 Policy: Restricted tools not explicitly allowed will be auto-denied.\n",
  );

  try {
    // 2. Test an unrestricted tool (should be allowed)
    // Unrestricted tools like 'Read' don't trigger permission checks in the same way,
    // but we can verify the permission manager's behavior directly.
    console.log("2️⃣  Testing unrestricted tool (Read)...");
    const readResult = await agent.checkPermission({
      toolName: "Read",
      permissionMode: "dontAsk",
    });
    console.log(`   📊 Result: ${readResult.behavior} (Expected: allow)\n`);

    // 3. Test a restricted tool (should be auto-denied)
    console.log("3️⃣  Testing restricted tool (Bash)...");
    const bashResult = await agent.checkPermission({
      toolName: "Bash",
      permissionMode: "dontAsk",
      toolInput: { command: "rm -rf /" }, // Use a command that is definitely not in default allowed rules
    });
    console.log(`   📊 Result: ${bashResult.behavior} (Expected: deny)`);
    if (bashResult.behavior === "deny") {
      console.log(`   💬 Message: ${bashResult.message}\n`);
    }

    // 4. Test with a persistent permission rule
    console.log("4️⃣  Adding persistent permission rule for 'Bash(ls)'...");
    await agent.addPermissionRule("Bash(ls)");

    console.log(
      "5️⃣  Testing restricted tool with matching rule (Bash 'ls')...",
    );
    const bashAllowedResult = await agent.checkPermission({
      toolName: "Bash",
      permissionMode: "dontAsk",
      toolInput: { command: "ls" },
    });
    console.log(
      `   📊 Result: ${bashAllowedResult.behavior} (Expected: allow)\n`,
    );

    console.log(
      "6️⃣  Testing restricted tool with non-matching rule (Bash 'rm')...",
    );
    const bashDeniedResult = await agent.checkPermission({
      toolName: "Bash",
      permissionMode: "dontAsk",
      toolInput: { command: "rm -rf /" },
    });
    console.log(
      `   📊 Result: ${bashDeniedResult.behavior} (Expected: deny)\n`,
    );
  } catch (error) {
    console.error("   ❌ Error during testing:", error);
  } finally {
    await agent.destroy();
  }

  console.log("🎉 'dontAsk' mode testing completed!");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
