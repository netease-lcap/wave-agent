/**
 * Verify that EnterPlanMode works correctly in bypassPermissions mode.
 *
 * Issue: commit ead3e8f6 added `context.toolManager.setPermissionMode("plan")`
 * in EnterPlanMode's execute method. But Agent.setPermissionMode() also calls
 * planManager.handlePlanModeTransition("plan") (generates plan file, sets plan
 * entry reminder) and the onPermissionModeChange callback. In bypass mode the
 * canUseTool callback is never invoked, so only toolManager.setPermissionMode
 * runs — the plan file is never generated and the UI is never notified.
 *
 * This example verifies:
 * 1. The permission mode switches to "plan" after EnterPlanMode
 * 2. The plan file path is generated (requires handlePlanModeTransition)
 * 3. The onPermissionModeChange callback fires
 * 4. The canUseTool callback is NOT called in bypass mode
 */

import { Agent } from "../src/agent.js";

async function main() {
  let canUseToolCalled = false;
  let permissionModeChanged: string | null = null;
  let modeChangeCount = 0;

  const agent = await Agent.create({
    workdir: process.cwd(),
    model: process.env.WAVE_FAST_MODEL,
    permissionMode: "bypassPermissions",
    canUseTool: async () => {
      canUseToolCalled = true;
      return { behavior: "allow" };
    },
    callbacks: {
      onAssistantContentUpdated: (chunk: string) => {
        process.stdout.write(chunk);
      },
      onPermissionModeChange: (mode: string) => {
        modeChangeCount++;
        permissionModeChanged = mode;
        console.log(`\n[onPermissionModeChange] mode -> ${mode}`);
      },
    },
  });

  console.log("=== Initial state ===");
  console.log(`permissionMode: ${agent.getPermissionMode()}`);
  console.log(`planFilePath: ${agent.getPlanFilePath()}`);

  // Start sendMessage without awaiting — we'll poll state and abort later
  const sendPromise = agent.sendMessage(
    "Use the EnterPlanMode tool to enter plan mode. " +
      "I want you to plan a refactoring of the authentication system to use OAuth2. " +
      "Call EnterPlanMode now.",
  );

  // Poll the permission mode every 2s; abort after 30s
  let aborted = false;
  const pollInterval = setInterval(() => {
    const mode = agent.getPermissionMode();
    const planPath = agent.getPlanFilePath();
    console.log(
      `\n[poll] permissionMode=${mode}, planFilePath=${planPath || "undefined"}`,
    );
    if (mode === "plan" && !aborted) {
      // Mode switched — give it a moment for plan file generation, then abort
      aborted = true;
      setTimeout(() => {
        console.log(
          "\n[poll] Mode is 'plan', aborting to check final state...",
        );
        agent.abortMessage();
      }, 3000);
    }
  }, 2000);

  const timeout = setTimeout(() => {
    if (!aborted) {
      aborted = true;
      console.log("\n[timeout] Aborting after 30s...");
      agent.abortMessage();
    }
  }, 30000);

  try {
    await sendPromise;
  } catch (e) {
    console.log(
      `\n[sendMessage] ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  clearInterval(pollInterval);
  clearTimeout(timeout);

  console.log("\n=== After AI cycle ===");
  const finalMode = agent.getPermissionMode();
  const finalPlanPath = agent.getPlanFilePath();

  console.log(`permissionMode: ${finalMode}`);
  console.log(`planFilePath: ${finalPlanPath}`);
  console.log(`canUseTool was called: ${canUseToolCalled}`);
  console.log(
    `onPermissionModeChange fired: ${permissionModeChanged !== null} (count: ${modeChangeCount})`,
  );
  console.log(`permissionModeChanged to: ${permissionModeChanged}`);

  console.log("\n=== Verification Results ===");
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

  checks.push({
    name: "Permission mode is 'plan'",
    pass: finalMode === "plan",
    detail: `expected 'plan', got '${finalMode}'`,
  });

  checks.push({
    name: "Plan file path is generated",
    pass:
      finalPlanPath !== undefined &&
      finalPlanPath !== null &&
      finalPlanPath.length > 0,
    detail: `expected a path, got '${finalPlanPath}'`,
  });

  checks.push({
    name: "canUseTool NOT called in bypass mode",
    pass: !canUseToolCalled,
    detail: canUseToolCalled
      ? "canUseTool was called (should not happen in bypass)"
      : "correct - not called",
  });

  checks.push({
    name: "onPermissionModeChange callback fired with 'plan'",
    pass: permissionModeChanged === "plan",
    detail: `expected 'plan', got '${permissionModeChanged}'`,
  });

  // Check tool visibility after entering plan mode
  const toolNames = agent.getAvailableToolNames();
  const hasExitPlanMode = toolNames.includes("ExitPlanMode");
  const hasEnterPlanMode = toolNames.includes("EnterPlanMode");
  console.log(`\n[tools] visible tools: ${toolNames.join(", ")}`);
  console.log(`[tools] ExitPlanMode visible: ${hasExitPlanMode}`);
  console.log(`[tools] EnterPlanMode visible: ${hasEnterPlanMode}`);

  checks.push({
    name: "ExitPlanMode is visible in plan mode",
    pass: hasExitPlanMode,
    detail: hasExitPlanMode
      ? "correct - ExitPlanMode is available"
      : "ExitPlanMode is missing from tool list",
  });

  checks.push({
    name: "EnterPlanMode is hidden in plan mode",
    pass: !hasEnterPlanMode,
    detail: hasEnterPlanMode
      ? "EnterPlanMode should be hidden in plan mode"
      : "correct - EnterPlanMode is hidden",
  });

  let allPass = true;
  for (const check of checks) {
    const status = check.pass ? "PASS" : "FAIL";
    console.log(`  [${status}] ${check.name} — ${check.detail}`);
    if (!check.pass) allPass = false;
  }

  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAILED"} ===`);

  await agent.destroy();
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
