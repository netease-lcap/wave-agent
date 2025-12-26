#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

/**
 * This example demonstrates how to use the `fetch` option to implement
 * a custom rate limiter (QPS = 1) for AI requests.
 */

// Simple rate limiter implementation
class RateLimiter {
  private nextAllowedTime: number = 0;
  private minInterval: number;

  constructor(qps: number) {
    this.minInterval = 1000 / qps;
  }

  async wait() {
    const now = Date.now();
    const waitTime = Math.max(0, this.nextAllowedTime - now);

    // Reserve the slot immediately to prevent race conditions
    this.nextAllowedTime =
      Math.max(now, this.nextAllowedTime) + this.minInterval;

    if (waitTime > 0) {
      console.log(`⏳ Rate limiting: waiting ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

const limiter = new RateLimiter(1); // 1 request per second

// Custom fetch implementation that wraps the global fetch with rate limiting
const customFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  await limiter.wait();
  console.log(`🚀 Sending request to: ${input}`);
  return fetch(input, init);
};

// Create Agent instance with the custom fetch
const agent = await Agent.create({
  fetch: customFetch,
  callbacks: {
    onAssistantContentUpdated: (chunk: string) => {
      process.stdout.write(chunk);
    },
  },
});

async function main() {
  try {
    console.log("--- Sending 3 requests concurrently (QPS=1) ---");
    await Promise.all([
      agent.sendMessage("echo 1st"),
      agent.sendMessage("echo 2nd"),
      agent.sendMessage("echo 3rd"),
    ]);
    console.log("\n");
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    await agent.destroy();
    console.log("👋 Done!");
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
