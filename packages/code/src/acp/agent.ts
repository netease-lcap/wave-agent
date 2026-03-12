import {
  Agent as WaveAgent,
  AgentOptions,
  PermissionDecision,
  ToolPermissionContext,
} from "wave-agent-sdk";
import { logger } from "../utils/logger.js";
import type {
  Agent as AcpAgent,
  AgentSideConnection,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  CancelNotification,
  AuthenticateResponse,
  SessionId as AcpSessionId,
  ToolCallStatus,
  StopReason,
  PermissionOption,
} from "@agentclientprotocol/sdk";

export class WaveAcpAgent implements AcpAgent {
  private agents: Map<string, WaveAgent> = new Map();
  private connection: AgentSideConnection;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
  }

  async initialize(): Promise<InitializeResponse> {
    logger.info("Initializing WaveAcpAgent");
    return {
      protocolVersion: 1,
      agentInfo: {
        name: "wave-agent",
        version: "0.1.0",
      },
      agentCapabilities: {
        loadSession: true,
      },
    };
  }

  async authenticate(): Promise<AuthenticateResponse | void> {
    // No authentication required for now
  }

  private async createAgent(
    sessionId: string | undefined,
    cwd: string,
  ): Promise<WaveAgent> {
    const callbacks: AgentOptions["callbacks"] = {};
    const agentRef: { instance?: WaveAgent } = {};

    const agent = await WaveAgent.create({
      workdir: cwd,
      restoreSessionId: sessionId,
      canUseTool: (context) => {
        if (!agentRef.instance) {
          throw new Error("Agent instance not yet initialized");
        }
        return this.handlePermissionRequest(
          agentRef.instance.sessionId,
          context,
        );
      },
      callbacks: {
        onAssistantContentUpdated: (chunk: string) =>
          callbacks.onAssistantContentUpdated?.(chunk, ""),
        onAssistantReasoningUpdated: (chunk: string) =>
          callbacks.onAssistantReasoningUpdated?.(chunk, ""),
        onToolBlockUpdated: (params: unknown) => {
          const cb = callbacks.onToolBlockUpdated as
            | ((params: unknown) => void)
            | undefined;
          cb?.(params);
        },
        onTasksChange: (tasks: unknown[]) => {
          const cb = callbacks.onTasksChange as
            | ((tasks: unknown[]) => void)
            | undefined;
          cb?.(tasks);
        },
      },
    });

    agentRef.instance = agent;
    const actualSessionId = agent.sessionId;
    this.agents.set(actualSessionId, agent);

    // Update the callbacks object with the correct sessionId
    Object.assign(callbacks, this.createCallbacks(actualSessionId));

    return agent;
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const { cwd } = params;
    logger.info(`Creating new session in ${cwd}`);
    const agent = await this.createAgent(undefined, cwd);
    return {
      sessionId: agent.sessionId as AcpSessionId,
    };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const { sessionId, cwd } = params;
    logger.info(`Loading session: ${sessionId} in ${cwd}`);
    await this.createAgent(sessionId, cwd);
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const { sessionId, prompt } = params;
    logger.info(`Received prompt for session ${sessionId}`);
    const agent = this.agents.get(sessionId);
    if (!agent) {
      logger.error(`Session ${sessionId} not found`);
      throw new Error(`Session ${sessionId} not found`);
    }

    // Map ACP prompt to Wave Agent sendMessage
    const textContent = prompt
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("\n");

    const images = prompt
      .filter((block) => block.type === "image")
      .map((block) => {
        const img = block as { data: string; mimeType: string };
        return {
          path: `data:${img.mimeType};base64,${img.data}`,
          mimeType: img.mimeType,
        };
      });

    try {
      logger.info(
        `Sending message to agent: ${textContent.substring(0, 50)}...`,
      );
      await agent.sendMessage(
        textContent,
        images.length > 0 ? images : undefined,
      );
      // Force save session so it can be loaded later
      await (
        agent as unknown as {
          messageManager: { saveSession: () => Promise<void> };
        }
      ).messageManager.saveSession();
      logger.info(`Message sent successfully for session ${sessionId}`);
      return {
        stopReason: "end_turn" as StopReason,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("abort")) {
        logger.info(`Message aborted for session ${sessionId}`);
        return {
          stopReason: "cancelled" as StopReason,
        };
      }
      logger.error(`Error sending message for session ${sessionId}:`, error);
      throw error;
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const { sessionId } = params;
    logger.info(`Cancelling message for session ${sessionId}`);
    const agent = this.agents.get(sessionId);
    if (agent) {
      agent.abortMessage();
    }
  }

  private async handlePermissionRequest(
    sessionId: string,
    context: ToolPermissionContext,
  ): Promise<PermissionDecision> {
    logger.info(
      `Handling permission request for ${context.toolName} in session ${sessionId}`,
    );

    const options: PermissionOption[] = [
      {
        optionId: "allow_once",
        name: "Allow Once",
        kind: "allow_once",
      },
      {
        optionId: "allow_always",
        name: "Allow Always",
        kind: "allow_always",
      },
      {
        optionId: "reject_once",
        name: "Reject Once",
        kind: "reject_once",
      },
      {
        optionId: "reject_always",
        name: "Reject Always",
        kind: "reject_always",
      },
    ];

    try {
      const response = await this.connection.requestPermission({
        sessionId: sessionId as AcpSessionId,
        toolCall: {
          toolCallId: "perm-" + Math.random().toString(36).substring(2, 9),
          title: `Permission for ${context.toolName}`,
          status: "pending",
          rawInput: context.toolInput,
        },
        options,
      });

      if (response.outcome.outcome === "cancelled") {
        return { behavior: "deny", message: "Cancelled by user" };
      }

      const selectedOptionId = response.outcome.optionId;
      logger.info(`User selected permission option: ${selectedOptionId}`);

      switch (selectedOptionId) {
        case "allow_once":
          return { behavior: "allow" };
        case "allow_always":
          return {
            behavior: "allow",
            newPermissionRule: `${context.toolName}(*)`,
          };
        case "reject_once":
          return { behavior: "deny", message: "Rejected by user" };
        case "reject_always":
          return {
            behavior: "deny",
            message: "Rejected by user",
            newPermissionRule: `!${context.toolName}(*)`,
          };
        default:
          return { behavior: "deny", message: "Unknown option selected" };
      }
    } catch (error) {
      logger.error("Error requesting permission via ACP:", error);
      return {
        behavior: "deny",
        message: `Error requesting permission: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private createCallbacks(sessionId: string): AgentOptions["callbacks"] {
    return {
      onAssistantContentUpdated: (chunk: string) => {
        this.connection.sessionUpdate({
          sessionId: sessionId as AcpSessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: chunk,
            },
          },
        });
      },
      onAssistantReasoningUpdated: (chunk: string) => {
        this.connection.sessionUpdate({
          sessionId: sessionId as AcpSessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: {
              type: "text",
              text: chunk,
            },
          },
        });
      },
      onToolBlockUpdated: (params) => {
        const { id, name, stage, success, error, result } = params;

        if (stage === "start") {
          this.connection.sessionUpdate({
            sessionId: sessionId as AcpSessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: id,
              title: name || "Tool Call",
              status: "pending",
            },
          });
          return;
        }

        if (stage === "streaming") {
          // We don't support streaming tool arguments in ACP yet
          return;
        }

        const status: ToolCallStatus =
          stage === "end"
            ? success
              ? "completed"
              : "failed"
            : stage === "running"
              ? "in_progress"
              : "pending";

        this.connection.sessionUpdate({
          sessionId: sessionId as AcpSessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: id,
            status,
            title: name || "Tool Call",
            rawOutput: result || error,
          },
        });
      },
      onTasksChange: (tasks) => {
        this.connection.sessionUpdate({
          sessionId: sessionId as AcpSessionId,
          update: {
            sessionUpdate: "plan",
            entries: tasks.map((task) => ({
              content: task.subject,
              status:
                task.status === "completed"
                  ? "completed"
                  : task.status === "in_progress"
                    ? "in_progress"
                    : "pending",
              priority: "medium",
            })),
          },
        });
      },
    };
  }
}
