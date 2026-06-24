#!/usr/bin/env tsx

/**
 * Verify cache strategy effectiveness.
 *
 * Sends multiple turns of conversation and logs cache metrics after each turn.
 * Shows how cache_read_input_tokens grows (or doesn't) across turns.
 *
 * Expected behavior with "last message marker" strategy:
 * - Turn 1: cache_creation = large (entire prefix written)
 * - Turn 2: cache_read ≈ previous total, cache_creation ≈ small delta
 * - Turn 3+: cache_read keeps growing, cache_creation stays small
 *
 * Usage:
 *   cd packages/agent-sdk && pnpm exec tsx examples/cache-strategy-verify.ts
 */

import { Agent } from "../src/agent.js";

const MODEL = "qwen3.7-plus";

// Simple prompts that force the model to respond differently each turn
const PROMPTS = [
  "Say exactly: 'Turn 1 complete'",
  "Say exactly: 'Turn 2 complete'",
  "Say exactly: 'Turn 3 complete'",
  "Say exactly: 'Turn 4 complete'",
  "Say exactly: 'Turn 5 complete'",
];

async function main() {
  console.log(`\n=== Cache Strategy Verification ===`);
  console.log(`Model: ${MODEL}`);
  console.log(`Turns: ${PROMPTS.length}\n`);

  const agent = await Agent.create({
    model: MODEL,
    callbacks: {
      onUsagesChange: (usages) => {
        if (usages.length === 0) return;
        const u = usages[usages.length - 1];
        const turn = usages.length;
        const cacheRead = u.cache_read_input_tokens ?? 0;
        const cacheCreate = u.cache_creation_input_tokens ?? 0;
        const promptTokens = u.prompt_tokens ?? 0;
        const cacheRatio =
          promptTokens > 0
            ? ((cacheRead / promptTokens) * 100).toFixed(1)
            : "0";

        console.log(`\n--- Turn ${turn} ---`);
        console.log(`  prompt_tokens:            ${promptTokens}`);
        console.log(
          `  cache_read_input_tokens:  ${cacheRead} (${cacheRatio}%)`,
        );
        console.log(`  cache_creation_input:     ${cacheCreate}`);
        console.log(`  completion_tokens:        ${u.completion_tokens}`);

        // Show the delta from previous turn
        if (usages.length > 1) {
          const prev = usages[usages.length - 2];
          const prevRead = prev.cache_read_input_tokens ?? 0;
          const prevCreate = prev.cache_creation_input_tokens ?? 0;
          const readDelta = cacheRead - prevRead;
          const createDelta = cacheCreate - prevCreate;
          console.log(
            `  Δ cache_read:              ${readDelta >= 0 ? "+" : ""}${readDelta}`,
          );
          console.log(
            `  Δ cache_creation:          ${createDelta >= 0 ? "+" : ""}${createDelta}`,
          );
        }
      },
    },
  });

  try {
    for (let i = 0; i < PROMPTS.length; i++) {
      console.log(
        `\n>>> Sending prompt ${i + 1}/${PROMPTS.length}: "${PROMPTS[i]}"`,
      );
      await agent.sendMessage(PROMPTS[i]);
    }

    // Summary
    console.log(`\n\n=== Summary ===`);
    const usages = agent.usages;
    const totalRead = usages.reduce(
      (sum, u) => sum + (u.cache_read_input_tokens ?? 0),
      0,
    );
    const totalCreate = usages.reduce(
      (sum, u) => sum + (u.cache_creation_input_tokens ?? 0),
      0,
    );
    const totalPrompt = usages.reduce(
      (sum, u) => sum + (u.prompt_tokens ?? 0),
      0,
    );

    console.log(`Total prompt tokens:       ${totalPrompt}`);
    console.log(
      `Total cache read:          ${totalRead} (${totalPrompt > 0 ? ((totalRead / totalPrompt) * 100).toFixed(1) : 0}%)`,
    );
    console.log(`Total cache creation:      ${totalCreate}`);
    console.log(
      `Cache efficiency:          ${totalRead + totalCreate > 0 ? ((totalRead / (totalRead + totalCreate)) * 100).toFixed(1) : 0}%`,
    );

    // Check if cache is actually working
    const firstRead = usages[0]?.cache_read_input_tokens ?? 0;
    const lastRead = usages[usages.length - 1]?.cache_read_input_tokens ?? 0;

    if (lastRead > firstRead && usages.length > 1) {
      console.log(
        `\n✓ Cache read is growing across turns — strategy is working`,
      );
    } else if (usages.length > 1) {
      console.log(`\n✗ Cache read is NOT growing — strategy may have issues`);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.destroy();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
