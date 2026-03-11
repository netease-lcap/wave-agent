import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { WaveAcpAgent } from "./agent.js";
import { logger } from "../utils/logger.js";

export async function startAcpCli() {
  // Redirect console.log to logger to avoid interfering with JSON-RPC over stdio
  console.log = (...args: unknown[]) => {
    logger.info(...args);
  };

  logger.info("Starting ACP bridge...");

  // Convert Node.js stdio to Web streams
  const stdin = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stdout = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;

  // Create ACP stream
  const stream = ndJsonStream(stdout, stdin);

  // Initialize AgentSideConnection
  const connection = new AgentSideConnection((conn) => {
    return new WaveAcpAgent(conn);
  }, stream);

  // Wait for connection to close
  await connection.closed;
}
