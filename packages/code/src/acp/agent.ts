import {
  Agent as WaveAgent,
  AgentOptions,
  PermissionDecision,
  ToolPermissionContext,
  AgentToolBlockUpdateParams,
} from "wave-agent-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "../utils/logger.js";
import {
  type Agent as AcpAgent,
  type AgentSideConnection,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type PromptRequest,
  type PromptResponse,
  type CancelNotification,
  type AuthenticateResponse,
  type SessionId as AcpSessionId,
  type ToolCallStatus,
  type StopReason,
  type PermissionOption,
  type SessionInfo,
  type ToolCallContent,
  type ToolCallLocation,
  type ToolKind,
  AGENT_METHODS,
} from "@agentclientprotocol/sdk";

export class WaveAcpAgent implements AcpAgent {
  private agents: Map<string, WaveAgent> = new Map();
  private connection: AgentSideConnection;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
  }

  private async cleanupAllAgents() {
    logger.info("Cleaning up all active agents due to connection closure");
    const destroyPromises = Array.from(this.agents.values()).map((agent) =>
      agent.destroy(),
    );
    await Promise.all(destroyPromises);
    this.agents.clear();
  }

  async initialize(): Promise<InitializeResponse> {
    logger.info("Initializing WaveAcpAgent");
    // Setup cleanup on connection closure
    this.connection.closed.then(() => this.cleanupAllAgents());
    return {
      protocolVersion: 1,
      agentInfo: {
        name: "wave-agent",
        version: "0.1.0",
      },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: {
          list: {},
          stop: {},
        },
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

  async unstable_listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    void params;
    logger.info("Listing active sessions");
    const sessions: SessionInfo[] = Array.from(this.agents.values()).map(
      (agent) => {
        const lastMessage = agent.messages[agent.messages.length - 1] as
          | { timestamp?: string }
          | undefined;
        const updatedAt = lastMessage?.timestamp
          ? new Date(lastMessage.timestamp).toISOString()
          : new Date().toISOString();

        return {
          sessionId: agent.sessionId as AcpSessionId,
          cwd: agent.workingDirectory,
          updatedAt,
        };
      },
    );
    return {
      sessions,
    };
  }

  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === AGENT_METHODS.session_stop) {
      const sessionId = params.sessionId as string;
      logger.info(`Stopping session ${sessionId}`);
      const agent = this.agents.get(sessionId);
      if (agent) {
        await agent.destroy();
        this.agents.delete(sessionId);
      }
      return {};
    }
    throw new Error(`Method ${method} not implemented`);
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

    const agent = this.agents.get(sessionId);
    const workdir = agent?.workingDirectory || process.cwd();

    const toolCallId =
      context.toolCallId ||
      "perm-" + Math.random().toString(36).substring(2, 9);

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

    const content = context.toolName
      ? await this.getToolContentAsync(
          context.toolName,
          context.toolInput,
          workdir,
        )
      : undefined;
    const locations = context.toolName
      ? this.getToolLocations(context.toolName, context.toolInput)
      : undefined;
    const kind = context.toolName
      ? this.getToolKind(context.toolName)
      : undefined;

    try {
      const response = await this.connection.requestPermission({
        sessionId: sessionId as AcpSessionId,
        toolCall: {
          toolCallId,
          title: `Permission for ${context.toolName}`,
          status: "pending",
          rawInput: context.toolInput,
          content,
          locations,
          kind,
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

  private async getToolContentAsync(
    name: string,
    parameters: Record<string, unknown> | undefined,
    workdir: string,
  ): Promise<ToolCallContent[] | undefined> {
    if (!parameters) return undefined;
    if (name === "Write") {
      let oldText: string | null = null;
      try {
        const filePath = parameters.file_path as string;
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(workdir, filePath);
        oldText = await fs.readFile(fullPath, "utf-8");
      } catch {
        // File might not exist, which is fine for Write
      }
      return [
        {
          type: "diff",
          path: parameters.file_path as string,
          oldText,
          newText: parameters.content as string,
        },
      ];
    }
    if (name === "Edit") {
      let oldText: string | null = null;
      let newText: string | null = null;
      try {
        const filePath = parameters.file_path as string;
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(workdir, filePath);
        oldText = await fs.readFile(fullPath, "utf-8");
        if (oldText) {
          if (parameters.replace_all) {
            newText = oldText
              .split(parameters.old_string as string)
              .join(parameters.new_string as string);
          } else {
            newText = oldText.replace(
              parameters.old_string as string,
              parameters.new_string as string,
            );
          }
        }
      } catch {
        logger.error("Failed to read file for Edit diff");
      }

      if (oldText && newText) {
        return [
          {
            type: "diff",
            path: parameters.file_path as string,
            oldText,
            newText,
          },
        ];
      }

      // Fallback to snippets if file reading fails
      return [
        {
          type: "diff",
          path: parameters.file_path as string,
          oldText: parameters.old_string as string,
          newText: parameters.new_string as string,
        },
      ];
    }
    return this.getToolContent(name, parameters);
  }

  private getToolContent(
    name: string,
    parameters: Record<string, unknown> | undefined,
  ): ToolCallContent[] | undefined {
    if (!parameters) return undefined;
    if (name === "Write") {
      return [
        {
          type: "diff",
          path: parameters.file_path as string,
          oldText: null,
          newText: parameters.content as string,
        },
      ];
    }
    if (name === "Edit") {
      return [
        {
          type: "diff",
          path: parameters.file_path as string,
          oldText: parameters.old_string as string,
          newText: parameters.new_string as string,
        },
      ];
    }
    return undefined;
  }

  private getToolLocations(
    name: string,
    parameters: Record<string, unknown> | undefined,
  ): ToolCallLocation[] | undefined {
    if (!parameters) return undefined;
    if (name === "Write" || name === "Edit" || name === "Read") {
      return [
        {
          path: parameters.file_path as string,
          line: parameters.offset as number,
        },
      ];
    }
    return undefined;
  }

  private getToolKind(name: string): ToolKind {
    switch (name) {
      case "Read":
      case "Glob":
      case "Grep":
      case "LSP":
        return "read";
      case "Write":
      case "Edit":
        return "edit";
      case "Bash":
        return "execute";
      case "Agent":
        return "other";
      default:
        return "other";
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
      onToolBlockUpdated: (params: AgentToolBlockUpdateParams) => {
        const { id, name, stage, success, error, result, parameters } = params;

        let parsedParameters: Record<string, unknown> | undefined = undefined;
        if (parameters) {
          try {
            parsedParameters = JSON.parse(parameters);
          } catch {
            // Ignore parse errors during streaming
          }
        }

        const content =
          name && parsedParameters
            ? this.getToolContent(name, parsedParameters)
            : undefined;
        const locations =
          name && parsedParameters
            ? this.getToolLocations(name, parsedParameters)
            : undefined;
        const kind = name ? this.getToolKind(name) : undefined;

        if (stage === "start") {
          this.connection.sessionUpdate({
            sessionId: sessionId as AcpSessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: id,
              title: name || "Tool Call",
              status: "pending",
              content,
              locations,
              kind,
              rawInput: parsedParameters,
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
            content,
            locations,
            kind,
            rawInput: parsedParameters,
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
