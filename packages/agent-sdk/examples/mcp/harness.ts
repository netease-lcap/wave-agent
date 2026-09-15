import fs from "fs/promises";
import os from "os";
import path from "path";
import { Agent } from "../../src/agent.js";
import type { AgentCallbacks } from "../../src/types/agent.js";
import type { Message } from "../../src/types/messaging.js";

/**
 * Shared plumbing for the MCP examples in this directory: a throwaway workdir
 * carrying a `.mcp.json` so the servers live and die with the demo, plus the few
 * readers every one of them needs.
 */

/** One stdio MCP server a demo launches: a name plus the script to spawn. */
export interface DemoServer {
  name: string;
  /** Absolute path of the `.mjs` server. */
  script: string;
}

export function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

/** A temp workdir with a project `.mcp.json`, and an Agent pointed at both. */
export async function startDemo(options: {
  servers: DemoServer[];
  workdirPrefix: string;
  callbacks?: AgentCallbacks;
}): Promise<{ agent: Agent; workDir: string }> {
  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), options.workdirPrefix),
  );
  await fs.writeFile(
    path.join(workDir, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: Object.fromEntries(
          options.servers.map((server) => [
            server.name,
            { type: "stdio", command: process.execPath, args: [server.script] },
          ]),
        ),
      },
      null,
      2,
    ),
  );

  const agent = await Agent.create({
    workdir: workDir,
    permissionMode: "bypassPermissions",
    callbacks: options.callbacks,
  });
  return { agent, workDir };
}

/** Always run from a `finally`: kill the servers, drop the temp workdir, report. */
export async function stopDemo(
  agent: Agent | undefined,
  workDir: string | undefined,
  failures: string[],
): Promise<void> {
  if (agent) await agent.destroy();
  if (workDir) await fs.rm(workDir, { recursive: true, force: true });
  if (failures.length > 0) {
    console.log("\n❌ FAILED");
    for (const failure of failures) console.log(`   - ${failure}`);
    process.exit(1);
  }
  console.log("\n✅ smooth");
}

/** A stdio server connects asynchronously — wait for the state a turn will read. */
export async function waitForServer(agent: Agent, name: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const server = agent.getMcpServers().find((s) => s.name === name);
    if (
      server &&
      server.status !== "connecting" &&
      server.status !== "disconnected"
    ) {
      return server;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`MCP server "${name}" never settled`);
}

export function textOf(message: Message): string {
  return message.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.content)
    .join("\n");
}

/**
 * The announcements the mechanism appended: meta messages carrying a marker.
 *
 * Detected by the marker line, not by the `<mcp_instructions>` envelope — a
 * departure notice carries the marker and nothing else. The `isMeta` half is the
 * same discriminator the reader uses, so quoted prose about a marker (a reply, a
 * hook echoing one) is not counted as connection state; see `quotedMarkers`.
 */
export function announcements(agent: Agent): string[] {
  return agent.messages
    .filter((message) => message.isMeta === true)
    .map(textOf)
    .filter((text) => markerOf(text) !== undefined);
}

/** Marker lines found in the one place the scanner never writes: the model's own prose. */
export function quotedMarkers(agent: Agent): string[] {
  return agent.messages
    .filter((message) => message.isMeta !== true)
    .map((message) => markerOf(textOf(message)))
    .filter((line): line is string => line !== undefined);
}

/** The marker line of an announcement: the connection state, stripped of prose. */
export function markerOf(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("<!-- mcp-instructions "));
}

/** The state each announcement carries, in message order. */
export function markers(agent: Agent): string[] {
  return announcements(agent).map((text) => markerOf(text) ?? "NO MARKER");
}

/** The tool blocks of one tool, in message order. */
export function toolBlocks(agent: Agent, name: string) {
  return agent.messages.flatMap((message) =>
    message.blocks.filter(
      (block) => block.type === "tool" && block.name === name,
    ),
  );
}
