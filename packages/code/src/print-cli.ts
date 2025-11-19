import { Agent, AgentCallbacks } from "wave-agent-sdk";
import { logger } from "./utils/logger.js";
import { displayUsageSummary } from "./utils/usageSummary.js";

export interface PrintCliOptions {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  message?: string;
}

export async function startPrintCli(options: PrintCliOptions): Promise<void> {
  const { restoreSessionId, continueLastSession, message } = options;

  if (
    (!message || message.trim() === "") &&
    !continueLastSession &&
    !restoreSessionId
  ) {
    console.error(
      "Print mode requires a message: use --print 'your message' or -p 'your message'",
    );
    process.exit(1);
  }

  let agent: Agent;

  // Setup callbacks for agent
  const callbacks: AgentCallbacks = {
    onAssistantMessageAdded: () => {
      // Assistant message started - no content to output yet
      process.stdout.write("\n");
    },
    onAssistantContentUpdated: (chunk: string) => {
      // FR-001: Stream content updates for real-time display - output only the new chunk
      process.stdout.write(chunk);
    },
    onToolBlockUpdated: (params) => {
      // FR-002: Tool parameter streaming - log tool parameters as they are being constructed
      if (params.parametersChunk) {
        logger.debug(
          `[TOOL STREAM] ${params.name || "Unknown"}: received parameter chunk`,
        );

        // Enhanced logging for streaming parameter content (for debugging/demonstration)
        logger.debug(
          `[TOOL CHUNK] Latest chunk: ${params.parametersChunk.substring(0, 100)}${params.parametersChunk.length > 100 ? "..." : ""}`,
        );
      }

      // Log compact parameters for collapsed view mode demonstration
      if (params.compactParams) {
        logger.info(
          `[TOOL COMPACT] ${params.name || "Unknown"}: ${params.compactParams}`,
        );
      }

      // For demonstration: log parameter streaming progress with enhanced detail
      const paramLength = params.parameters?.length || 0;
      const hasChunk = params.parametersChunk ? " [+chunk]" : "";
      const hasCompact = params.compactParams ? " [compact ready]" : "";
      logger.debug(
        `[TOOL PROGRESS] ${params.name || "Unknown"}: ${paramLength} chars accumulated${hasChunk}${hasCompact}`,
      );
    },
  };

  try {
    // Initialize agent
    agent = await Agent.create({
      callbacks,
      restoreSessionId,
      continueLastSession,
      logger,
    });

    // Send message if provided and not empty
    if (message && message.trim() !== "") {
      await agent.sendMessage(message);
    }

    // Display usage summary before exit
    try {
      const usages = agent.usages;
      const sessionFilePath = agent.sessionFilePath;
      displayUsageSummary(usages, sessionFilePath);
    } catch {
      // Silently ignore usage summary errors
    }

    // Destroy agent and exit after sendMessage completes
    agent.destroy();
    process.exit(0);
  } catch (error) {
    console.error("Failed to send message:", error);
    if (agent!) {
      // Display usage summary even on error
      try {
        const usages = agent.usages;
        const sessionFilePath = agent.sessionFilePath;
        displayUsageSummary(usages, sessionFilePath);
      } catch {
        // Silently ignore usage summary errors
      }
      agent.destroy();
    }
    process.exit(1);
  }
}
