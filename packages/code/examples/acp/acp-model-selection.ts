import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Demonstrates ACP model selection via session config options.
 * - Creates a session and inspects available models
 * - Changes the model via setSessionConfigOption
 * - Verifies the change was applied
 * - Listens for config_option_update notifications
 */
async function runModelSelectionExample() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    path.join(process.cwd(), "tsconfig.dev.json"),
    path.join(process.cwd(), "src/index.ts"),
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-model-"));
  console.log(`Using temporary directory: ${tmpDir}`);

  console.log("Starting agent process...");
  const agentProcess = spawn(agentCommand[0], [...agentCommand.slice(1)], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, NODE_ENV: "integration-test" },
  });

  const stdin = Writable.toWeb(
    agentProcess.stdin!,
  ) as WritableStream<Uint8Array>;
  const stdout = Readable.toWeb(
    agentProcess.stdout!,
  ) as ReadableStream<Uint8Array>;

  const stream = ndJsonStream(stdin, stdout);

  const client: Client = {
    requestPermission: async () => {
      return { outcome: "approved" };
    },
    sessionUpdate: async (notification: SessionNotification) => {
      if (notification.update.sessionUpdate === "config_option_update") {
        const opts = notification.update.configOptions;
        console.log("Received config_option_update notification:");
        for (const opt of opts) {
          console.log(`  ${opt.id}: ${opt.currentValue}`);
        }
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    console.log("Initializing connection...");
    const initResult = await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "model-selection-client", version: "1.0.0" },
    });
    console.log(
      "Agent capabilities:",
      JSON.stringify(initResult.agentCapabilities, null, 2),
    );

    console.log("Creating new session...");
    const session = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("Session ID:", session.sessionId);

    // 1. Inspect available config options
    console.log("\n--- Available Configuration Options ---");
    if (session.configOptions) {
      for (const opt of session.configOptions) {
        console.log(
          `\n${opt.name} (id: "${opt.id}", category: "${opt.category}")`,
        );
        console.log(`  Current: ${opt.currentValue}`);
        if (opt.type === "select" && opt.options) {
          console.log(
            `  Options: ${opt.options.map((o: { value: string }) => o.value).join(", ")}`,
          );
        }
      }
    }

    // 2. Find the model option and change it
    const modelOption = session.configOptions?.find(
      (o: { category?: string }) => o.category === "model",
    );
    if (!modelOption) {
      console.warn(
        "No model config option available — skipping model change test",
      );
    } else if (modelOption.options && modelOption.options.length < 2) {
      console.warn(
        `Only one model configured (${modelOption.currentValue}) — cannot test switching`,
      );
    } else if (modelOption.options) {
      const currentModel = modelOption.currentValue;
      const nextModel = modelOption.options.find(
        (o: { value: string }) => o.value !== currentModel,
      )!;

      console.log(`\nSwitching model: ${currentModel} -> ${nextModel.value}`);

      const result = await connection.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "model",
        value: nextModel.value,
      });

      console.log("Config options after change:");
      for (const opt of result.configOptions) {
        console.log(`  ${opt.id}: ${opt.currentValue}`);
      }

      const updatedModel = result.configOptions.find(
        (o: { id: string }) => o.id === "model",
      );
      if (updatedModel?.currentValue === nextModel.value) {
        console.log("Model change verified successfully!");
      } else {
        throw new Error(
          `Model change failed: expected ${nextModel.value}, got ${updatedModel?.currentValue}`,
        );
      }
    }

    console.log("\nModel selection example completed successfully!");
  } catch (error) {
    console.error("Example failed:", error);
    process.exit(1);
  } finally {
    console.log("Cleaning up...");
    agentProcess.kill();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

runModelSelectionExample();
