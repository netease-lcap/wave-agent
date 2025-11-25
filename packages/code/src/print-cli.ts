import { Agent, AgentCallbacks } from "wave-agent-sdk";
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

    // Subagent block callbacks
    onSubAgentBlockAdded: (subagentId: string, parameters) => {
      // Display subagent creation with indentation
      process.stdout.write(
        `\n🤖 Subagent [${parameters.subagent_type}]: ${parameters.description}\n`,
      );
    },
    onSubAgentBlockUpdated: (subagentId: string, status) => {
      // Display subagent status updates
      const statusIconMap = {
        active: "🔄",
        completed: "✅",
        error: "❌",
        aborted: "⚠️",
      } as const;

      const statusIcon = statusIconMap[status] ?? "🔄";
      process.stdout.write(`   ${statusIcon} Subagent status: ${status}\n`);
    },
    // Subagent message callbacks
    onSubagentAssistantMessageAdded: () => {
      // Subagent assistant message started - add indentation
      process.stdout.write("\n   ");
    },
    onSubagentAssistantContentUpdated: (_subagentId: string, chunk: string) => {
      // Stream subagent content with indentation - output only the new chunk
      process.stdout.write(chunk);
    },
    onSubagentUserMessageAdded: (_subagentId: string, params) => {
      // Display subagent user messages with indentation
      process.stdout.write(`\n   👤 User: ${params.content}\n`);
    },
    // Error block callback
    onErrorBlockAdded: (error: string) => {
      // Display error blocks with distinct formatting
      process.stdout.write(`\n❌ Error: ${error}\n`);
    },
  };

  try {
    // Initialize agent
    agent = await Agent.create({
      callbacks,
      restoreSessionId,
      continueLastSession,
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
