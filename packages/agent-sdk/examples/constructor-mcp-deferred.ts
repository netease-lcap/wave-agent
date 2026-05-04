#!/usr/bin/env tsx

/**
 * Verifies that MCP servers passed via agent.create() constructor options
 * are deferred and require tool_search to discover.
 *
 * Uses the popo-acp MCP server running at http://localhost:3100/mcp.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

async function main() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "constructor-mcp-deferred-"),
  );

  const agent = await Agent.create({
    workdir: tempDir,
    permissionMode: "bypassPermissions",
    model: "gemini-2.5-flash",
    mcpServers: {
      "popo-acp": {
        url: "http://localhost:3100/mcp",
      },
    },
    callbacks: {
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`[TOOL START] ${params.name}`);
        }
        if (params.stage === "end") {
          const status = params.success ? "✅" : "❌";
          const short = (params.result || "").slice(0, 150);
          console.log(`${status} [TOOL END] ${params.name}: ${short}`);
        }
      },
      onAssistantContentUpdated: (chunk: string) => {
        process.stdout.write(chunk);
      },
    },
  });

  try {
    // Step 1: Wait for MCP connection
    console.log("⏳ Waiting for MCP connection...\n");
    let attempts = 0;
    while (attempts < 30) {
      const servers = agent.getMcpServers();
      const popo = servers.find((s) => s.name === "popo-acp");
      if (popo?.status === "connected") {
        console.log(`✅ popo-acp connected (${popo.tools?.length || 0} tools)`);
        popo.tools?.forEach((t) =>
          console.log(`   - ${t.name}: ${t.description}`),
        );
        break;
      }
      if (popo?.status === "error") {
        console.log(`❌ popo-acp error: ${popo.error}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
      attempts++;
    }

    // Step 2: Ask agent to discover MCP tools via tool_search and call one
    console.log("\n📨 Asking agent to discover MCP tools and send a file...");
    await agent.sendMessage(
      "First use the tool_search tool to find available MCP tools. " +
        "If you find a tool called mcp__popo-acp__sendFile, describe what it does. " +
        "Then try to call it with a test file path like /tmp/test.txt.",
    );

    // Wait for agent to finish
    let waitAttempts = 0;
    while (agent.isLoading && waitAttempts < 120) {
      await new Promise((r) => setTimeout(r, 1000));
      waitAttempts++;
    }

    // Step 3: Check message history for MCP tool usage
    console.log(`\n📊 Final state: ${agent.messages.length} messages`);

    const mcpToolsUsed = new Set<string>();
    for (const msg of agent.messages) {
      for (const block of msg.blocks) {
        if (
          block.type === "tool" &&
          block.name?.startsWith("mcp__") &&
          block.name
        ) {
          mcpToolsUsed.add(block.name);
        }
      }
    }

    console.log(`MCP tools called: ${mcpToolsUsed.size}`);
    mcpToolsUsed.forEach((name) => console.log(`   - ${name}`));

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("RESULT:");
    if (mcpToolsUsed.size > 0) {
      console.log(
        "✅ PASS: MCP tools from constructor were deferred and became available after tool_search",
      );
    } else {
      console.log(
        "⚠️  UNCERTAIN: No MCP tools were called (check if tool_search succeeded)",
      );
    }
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
