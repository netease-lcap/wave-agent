/**
 * Plan mode, with both of its tools deferred.
 *
 * `EnterPlanMode` and `ExitPlanMode` carry `shouldDefer: true` in Claude Code, so
 * wave matches them: neither is declared in `tools[]`, and neither can be called
 * directly. The model has to find the name in the announcement and call it from
 * inside an `Exec` script.
 *
 * That is the one flow where deferral could plausibly hurt, because the call *is*
 * an approval request. This example is the proof it does not: the approval fires
 * under the tool's own leaf name (`ExitPlanMode`, not `Exec`), the plan content
 * reaches it, and the permission mode really flips back to `default`.
 *
 * Run from `packages/agent-sdk`:
 *
 *   WAVE_FAST_MODEL=<model> npx tsx examples/tools/plan-mode-exec.ts
 */

import { Agent, type PermissionDecision } from "../../src/index.js";

interface Ask {
  toolName: string;
  sawPlanContent: boolean;
}

const failures: string[] = [];
const asks: Ask[] = [];

function check(condition: boolean, message: string): void {
  const line = `${condition ? "✓" : "✗"} ${message}`;
  console.log(line);
  if (!condition) failures.push(message);
}

function section(title: string): void {
  console.log(
    `\n${"─".repeat(4)} ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`,
  );
}

/**
 * Approve everything, and record what was asked — modelling what a real host does.
 *
 * `ExitPlanMode` does not flip the mode itself: the decision carries
 * `newPermissionMode`, and the CLI (`confirmationReducer.ts`), the webview and the
 * daemon all set it. A bare `allow` here would leave the session in plan mode, which
 * is the host's job rather than the tool's.
 *
 * `planContent` is only ever set on the `ExitPlanMode` context, so it doubles as the
 * check that the plan itself made it across the nested boundary.
 */
async function approveEverything(
  context: Parameters<
    NonNullable<Parameters<typeof Agent.create>[0]["canUseTool"]>
  >[0],
): Promise<PermissionDecision> {
  asks.push({
    toolName: context.toolName,
    sawPlanContent:
      typeof context.planContent === "string" && context.planContent.length > 0,
  });
  console.log(`   [ask] ${context.toolName}`);
  if (context.toolName === "ExitPlanMode") {
    return { behavior: "allow", newPermissionMode: "default" };
  }
  return { behavior: "allow" };
}

async function main(): Promise<void> {
  let agent: Agent | undefined;

  try {
    agent = await Agent.create({
      permissionMode: "plan",
      model: process.env.WAVE_FAST_MODEL,
      canUseTool: approveEverything,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      callbacks: {
        onToolBlockUpdated: (params) => {
          if (params.stage !== "end") return;
          console.log(`\n[tool] ${params.name} → ${params.shortResult ?? ""}`);
        },
      },
    });

    console.log(`plan file: ${agent.getPlanFilePath() ?? "(not set)"}`);
    console.log(`mode at start: ${agent.getPermissionMode()}`);

    section("neither plan-mode tool is declared flat");
    const declared = agent.getAvailableToolNames();
    check(
      !declared.includes("ExitPlanMode") && !declared.includes("EnterPlanMode"),
      "neither plan-mode tool is declared flat (deferred)",
    );
    check(declared.includes("Exec"), "Exec is declared");

    section("the model presents the plan through the sandbox");
    // Deliberately a plan with nothing to implement: the point of this example is the
    // approval round trip, and an approvable *actionable* plan would send the model
    // off to do the work afterwards, which is what an earlier version of this prompt
    // did.
    await agent.sendMessage(
      "Write a two-sentence plan to your plan file using Write. Its content is that " +
        "no code changes are needed and this is a planning exercise. Then present " +
        "the plan for my approval, and stop once it is approved.",
    );

    const announcement =
      agent.messages
        .flatMap((message) => message.blocks)
        .map((block) => (block.type === "text" ? block.content : ""))
        .find((text) => text.includes("$codemode")) ?? "";
    check(
      announcement.includes("ExitPlanMode") &&
        announcement.includes("EnterPlanMode"),
      "the announcement names both plan-mode tools",
    );

    const modeNow = agent.getPermissionMode();
    console.log(`mode at end: ${modeNow}`);
    const planAsk = asks.find((ask) => ask.toolName === "ExitPlanMode");
    console.log(
      `asks seen: ${asks.map((ask) => ask.toolName).join(", ") || "(none)"}`,
    );

    check(
      planAsk !== undefined,
      "the plan approval fired (nested, under its own name)",
    );
    check(
      planAsk?.sawPlanContent === true,
      "the plan content crossed the sandbox boundary into the approval",
    );
    check(modeNow !== "plan", "the approved plan left plan mode");
    // Nested calls surface as their own name inside Exec's summary, so this is the
    // measurable difference between "reached it directly" and "reached it as designed".
    const reachedInsideExec = agent.messages.some((message) =>
      message.blocks.some(
        (block) =>
          block.type === "tool" &&
          block.name === "Exec" &&
          `${block.result ?? ""}${block.shortResult ?? ""}`.includes(
            "ExitPlanMode",
          ),
      ),
    );
    console.log(
      `ExitPlanMode reached from inside Exec: ${reachedInsideExec ? "yes" : "no"}`,
    );
    if (!reachedInsideExec) {
      console.log(
        "   (the model may have searched and called in one script whose summary was " +
          "truncated — the mechanism is what was under test, not the model)",
      );
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
    failures.push(String(error));
  } finally {
    if (failures.length > 0) {
      console.log(
        `\n❌ FAILED\n${failures.map((line) => `   - ${line}`).join("\n")}`,
      );
    } else {
      console.log("\n✅ smooth");
    }
    if (agent) await agent.destroy();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
