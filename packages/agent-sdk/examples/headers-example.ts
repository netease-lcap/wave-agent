#!/usr/bin/env tsx

/**
 * Example demonstrating how to use headers with the Agent constructor
 *
 * This example shows how to pass custom HTTP headers to the OpenAI client,
 * which is useful for authentication, custom user agents, or other HTTP header requirements.
 */

import { Agent } from "../src/agent.js";

async function main() {
  try {
    // Example 1: Basic usage with headers
    console.log("Creating agent with custom headers...");

    const agent = await Agent.create({
      apiKey: process.env.WAVE_API_KEY || "test-key",
      baseURL: process.env.WAVE_BASE_URL || "https://api.openai.com/v1",
      defaultHeaders: {
        "User-Agent": "WaveAgent/1.0.0",
        "X-Custom-Client": "wave-agent-sdk",
        "X-Request-ID": `req-${Date.now()}`,
      },
    });

    console.log("✓ Agent created successfully with headers");
    console.log("Gateway config:", agent.getGatewayConfig());

    // Example 2: Headers are optional
    const agentNoHeaders = await Agent.create({
      apiKey: process.env.WAVE_API_KEY || "test-key",
      baseURL: process.env.WAVE_BASE_URL || "https://api.openai.com/v1",
      // No headers specified - this still works
    });

    console.log("✓ Agent created successfully without headers");
    console.log(
      "Gateway config (no headers):",
      agentNoHeaders.getGatewayConfig(),
    );

    // Example 3: Authentication headers
    const agentWithAuth = await Agent.create({
      apiKey: process.env.WAVE_API_KEY || "test-key",
      baseURL: process.env.WAVE_BASE_URL || "https://api.openai.com/v1",
      defaultHeaders: {
        Authorization: "Bearer additional-token", // Additional auth if needed
        "X-Organization": "my-org-id",
        Accept: "application/json",
      },
    });

    console.log("✓ Agent created successfully with authentication headers");
    console.log(
      "Gateway config (with auth):",
      agentWithAuth.getGatewayConfig(),
    );

    // Clean up
    await agent.destroy();
    await agentNoHeaders.destroy();
    await agentWithAuth.destroy();

    console.log("\n🎉 All header examples completed successfully!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
