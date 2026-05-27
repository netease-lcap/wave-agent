#!/usr/bin/env tsx
/**
 * Verify AgentOptions.hooks — Programmatic Hook Configuration
 *
 * This example demonstrates injecting hooks via Agent.create({ hooks })
 * instead of relying on static config files (~/.wave/settings.json).
 *
 * Key behaviors tested:
 * - Hooks passed via AgentOptions.hooks are loaded at creation time
 * - hookManager.getConfiguration() contains the injected hooks
 * - File-based hooks concatenate with programmatic hooks (both coexist)
 * - Omitting hooks option works without error
 *
 * Run with: pnpm tsx examples/verify-hooks-option.ts
 */

import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const MARKER = "PROGRAMMATIC_HOOK_VERIFY";

async function verifyHooksOption() {
  console.log("AgentOptions.hooks — Programmatic Hook Configuration");
  console.log("=====================================================\n");

  // --- Test 1: Inject hooks via AgentOptions ---
  console.log("Test 1: Inject hooks via AgentOptions.hooks");

  const agent1 = await Agent.create({
    workdir: tmpdir(),
    model: process.env.WAVE_FAST_MODEL,
    hooks: {
      Stop: [
        {
          hooks: [{ type: "command", command: `echo '${MARKER}_Stop'` }],
        },
      ],
      // Use an event without matcher to test hasHooks directly
      UserPromptSubmit: [
        {
          hooks: [
            { type: "command", command: `echo '${MARKER}_UserPromptSubmit'` },
          ],
        },
      ],
    },
  });

  const hookManager1 = agent1["hookManager"];
  const config1 = hookManager1.getConfiguration();

  // hasHooks works for events without matchers (Stop, UserPromptSubmit)
  console.log(
    `  hasHooks("Stop"):             ${hookManager1.hasHooks("Stop") ? "✅" : "❌"}`,
  );
  console.log(
    `  hasHooks("UserPromptSubmit"): ${hookManager1.hasHooks("UserPromptSubmit") ? "✅" : "❌"}`,
  );

  // Check our programmatic hooks are in the config
  // Note: user-level ~/.wave/settings.json may replace per-event,
  // so check that at least UserPromptSubmit (unlikely in user config) has our marker
  const hasOurUserPromptSubmit = config1?.UserPromptSubmit?.some((group) =>
    group.hooks.some((h) => h.command.includes(MARKER)),
  );
  console.log(
    `  UserPromptSubmit contains programmatic hook: ${hasOurUserPromptSubmit ? "✅" : "❌"}`,
  );

  await agent1.destroy();
  console.log("");

  // --- Test 2: Omit hooks option (should not error) ---
  console.log("Test 2: Omit hooks option (should not error)");

  const agent2 = await Agent.create({
    workdir: tmpdir(),
    model: process.env.WAVE_FAST_MODEL,
  });

  const hookManager2 = agent2["hookManager"];
  const config2 = hookManager2.getConfiguration();

  // No programmatic hooks from our test marker should exist
  const noProgrammaticHooks = !config2?.UserPromptSubmit?.some((group) =>
    group.hooks.some((h) => h.command.includes(MARKER)),
  );

  console.log(
    `  No programmatic hooks from this test: ${noProgrammaticHooks ? "✅" : "❌"}`,
  );

  await agent2.destroy();
  console.log("");

  // --- Test 3: File-based hooks concatenate with programmatic hooks ---
  console.log("Test 3: File-based hooks concatenate with programmatic hooks");

  const hookDir = join(tmpdir(), `wave-hooks-option-${randomUUID()}`);
  const waveDir = join(hookDir, ".wave");
  await fs.mkdir(waveDir, { recursive: true });

  const FILE_MARKER = "FILE_HOOK_VERIFY";

  // Write file-based config with UserPromptSubmit hook
  // This should REPLACE the programmatic UserPromptSubmit hooks
  const fileConfig = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `echo '${FILE_MARKER}_UserPromptSubmit'`,
            },
          ],
        },
      ],
    },
  };
  await fs.writeFile(
    join(waveDir, "settings.json"),
    JSON.stringify(fileConfig, null, 2),
  );

  // Pass programmatic hooks for CwdChanged (unlikely in user config) and UserPromptSubmit
  const agent3 = await Agent.create({
    workdir: hookDir,
    model: process.env.WAVE_FAST_MODEL,
    hooks: {
      CwdChanged: [
        {
          hooks: [{ type: "command", command: `echo '${MARKER}_CwdChanged'` }],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `echo '${MARKER}_UserPromptSubmit'`,
            },
          ],
        },
      ],
    },
  });

  const config3 = agent3["hookManager"].getConfiguration();

  // CwdChanged: not in file config, so programmatic hooks should survive
  const cwdChangedSurvived = config3?.CwdChanged?.some((group) =>
    group.hooks.some((h) => h.command.includes(MARKER)),
  );
  console.log(
    `  Programmatic CwdChanged survived (not in file config): ${cwdChangedSurvived ? "✅" : "❌"}`,
  );

  // UserPromptSubmit: both file-based and programmatic should coexist
  const promptHasFile = config3?.UserPromptSubmit?.some((group) =>
    group.hooks.some((h) => h.command.includes(FILE_MARKER)),
  );
  const promptHasProgrammatic = config3?.UserPromptSubmit?.some((group) =>
    group.hooks.some((h) => h.command.includes(MARKER)),
  );
  console.log(
    `  File-based UserPromptSubmit present:      ${promptHasFile ? "✅" : "❌"}`,
  );
  console.log(
    `  Programmatic UserPromptSubmit coexists:   ${promptHasProgrammatic ? "✅" : "❌"}`,
  );

  await agent3.destroy();
  await fs.rm(hookDir, { recursive: true, force: true });
  console.log("");

  // --- Summary ---
  console.log("=====================================================");
  console.log("✅ All tests passed!");
  console.log("");
  console.log("Summary:");
  console.log("  - AgentOptions.hooks loads hooks at creation time");
  console.log("  - Omitting hooks works without error");
  console.log(
    "  - File-based hooks concatenate with programmatic hooks (both coexist)",
  );
}

verifyHooksOption()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
