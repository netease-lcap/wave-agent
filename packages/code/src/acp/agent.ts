import {
  Agent as WaveAgent,
  AgentOptions,
  PermissionDecision,
  ToolPermissionContext,
  AgentToolBlockUpdateParams,
  Task,
  listSessions as listWaveSessions,
  listAllSessions as listAllWaveSessions,
  deleteSession as deleteWaveSession,
  truncateContent,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
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
  type SessionConfigOption,
  type SetSessionModeRequest,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  AGENT_METHODS,
} from "@agentclientprotocol/sdk";

export class WaveAcpAgent implements AcpAgent {
  private agents: Map<string, WaveAgent> = new Map();
  private connection: AgentSideConnection;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
  }

  private getSessionModeState(agent: WaveAgent) {
    return {
      currentModeId: agent.getPermissionMode(),
      availableModes: [
        {
          id: "default",
          name: "Default",
          description: "Ask for permission for restricted tools",
        },
        {
          id: "acceptEdits",
          name: "Accept Edits",
          description: "Automatically accept file edits",
        },
        {
          id: "plan",
          name: "Plan",
          description: "Plan mode for complex tasks",
        },
        {
          id: "bypassPermissions",
          name: "Bypass Permissions",
          description: "Automatically accept all tool calls",
        },
      ],
    };
  }

  private getSessionConfigOptions(agent: WaveAgent): SessionConfigOption[] {
    return [
      {
        id: "permission_mode",
        name: "Permission Mode",
        type: "select",
        category: "mode",
        currentValue: agent.getPermissionMode(),
        options: [
          { value: "default", name: "Default" },
          { value: "acceptEdits", name: "Accept Edits" },
          { value: "plan", name: "Plan" },
          { value: "bypassPermissions", name: "Bypass Permissions" },
        ],
      },
    ];
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
          close: {},
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
      stream: false,
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
        onTasksChange: (tasks) => callbacks.onTasksChange?.(tasks as Task[]),
        onPermissionModeChange: (mode) =>
          callbacks.onPermissionModeChange?.(mode),
      },
    });

    agentRef.instance = agent;
    const actualSessionId = agent.sessionId;
    this.agents.set(actualSessionId, agent);

    // Update the callbacks object with the correct sessionId
    Object.assign(callbacks, this.createCallbacks(actualSessionId));

    // Send initial available commands after agent creation
    // Use setImmediate to ensure the client receives the session response before the update
    setImmediate(() => {
      this.connection.sessionUpdate({
        sessionId: actualSessionId as AcpSessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: agent.getSlashCommands().map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            input: {
              hint: "Enter arguments...",
            },
          })),
        },
      });
    });

    return agent;
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const { cwd } = params;
    logger.info(`Creating new session in ${cwd}`);
    const agent = await this.createAgent(undefined, cwd);
    logger.info(`New session created with ID: ${agent.sessionId}`);

    return {
      sessionId: agent.sessionId as AcpSessionId,
      modes: this.getSessionModeState(agent),
      configOptions: this.getSessionConfigOptions(agent),
    };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const { sessionId, cwd } = params;
    logger.info(`Loading session: ${sessionId} in ${cwd}`);
    const agent = await this.createAgent(sessionId, cwd);

    return {
      modes: this.getSessionModeState(agent),
      configOptions: this.getSessionConfigOptions(agent),
    };
  }

  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    const { cwd } = params;
    logger.info(`listSessions called with params: ${JSON.stringify(params)}`);

    let waveSessions;
    if (!cwd) {
      logger.info("listSessions called without cwd, listing all sessions");
      waveSessions = await listAllWaveSessions();
    } else {
      logger.info(`Listing sessions for ${cwd}`);
      waveSessions = await listWaveSessions(cwd);
    }

    logger.info(`Found ${waveSessions.length} sessions`);
    const sessions: SessionInfo[] = waveSessions.map((meta) => ({
      sessionId: meta.id as AcpSessionId,
      cwd: meta.workdir,
      title: meta.firstMessage ? truncateContent(meta.firstMessage) : undefined,
      updatedAt: meta.lastActiveAt.toISOString(),
    }));
    return { sessions };
  }

  async unstable_closeSession(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const sessionId = params.sessionId as string;
    logger.info(`Stopping session ${sessionId}`);
    const agent = this.agents.get(sessionId);
    if (agent) {
      const workdir = agent.workingDirectory;
      await agent.destroy();
      this.agents.delete(sessionId);
      // Delete the session file so it doesn't show up in listSessions
      await deleteWaveSession(sessionId, workdir);
    }
    return {};
  }

  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === AGENT_METHODS.session_close) {
      return this.unstable_closeSession(params);
    }
    throw new Error(`Method ${method} not implemented`);
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<void> {
    const { sessionId, modeId } = params;
    const agent = this.agents.get(sessionId);
    if (!agent) throw new Error(`Session ${sessionId} not found`);
    agent.setPermissionMode(
      modeId as "default" | "acceptEdits" | "plan" | "bypassPermissions",
    );
  }

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const { sessionId, configId, value } = params;
    const agent = this.agents.get(sessionId);
    if (!agent) throw new Error(`Session ${sessionId} not found`);

    if (configId === "permission_mode") {
      agent.setPermissionMode(
        value as "default" | "acceptEdits" | "plan" | "bypassPermissions",
      );
    }

    return {
      configOptions: this.getSessionConfigOptions(agent),
    };
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

    let effectiveName = context.toolName;
    let effectiveCompactParams: string | undefined = undefined;

    if (agent?.messages && context.toolCallId) {
      const toolBlock = agent.messages
        .flatMap((m) => m.blocks)
        .find((b) => b.type === "tool" && b.id === context.toolCallId) as
        | import("wave-agent-sdk").ToolBlock
        | undefined;
      if (toolBlock) {
        effectiveName = toolBlock.name || effectiveName;
        effectiveCompactParams =
          toolBlock.compactParams || effectiveCompactParams;
      }
    }

    const displayTitle =
      effectiveName && effectiveCompactParams
        ? `${effectiveName}: ${effectiveCompactParams}`
        : effectiveName || "Tool Call";

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
          title: displayTitle,
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
        case "allow_always":
          if (context.toolName === BASH_TOOL_NAME) {
            const command = (context.toolInput?.command as string) || "";
            const rule = context.suggestedPrefix
              ? `${context.suggestedPrefix}*`
              : command;
            return {
              behavior: "allow",
              newPermissionRule: `${BASH_TOOL_NAME}(${rule})`,
            };
          }
          if (
            context.toolName === EDIT_TOOL_NAME ||
            context.toolName === WRITE_TOOL_NAME
          ) {
            return {
              behavior: "allow",
              newPermissionMode: "acceptEdits",
            };
          }
          return {
            behavior: "allow",
            newPermissionRule: context.toolName,
          };
        case "allow_once":
          return { behavior: "allow" };
        case "reject_once":
          return { behavior: "deny", message: "Rejected by user" };
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
        const filePath = (parameters.file_path ||
          parameters.filePath) as string;
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
          path: (parameters.file_path || parameters.filePath) as string,
          oldText,
          newText: parameters.content as string,
        },
      ];
    }
    if (name === "Edit") {
      let oldText: string | null = null;
      let newText: string | null = null;
      try {
        const filePath = (parameters.file_path ||
          parameters.filePath) as string;
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
            path: (parameters.file_path || parameters.filePath) as string,
            oldText,
            newText,
          },
        ];
      }

      // Fallback to snippets if file reading fails
      return [
        {
          type: "diff",
          path: (parameters.file_path || parameters.filePath) as string,
          oldText: parameters.old_string as string,
          newText: parameters.new_string as string,
        },
      ];
    }
    return this.getToolContent(name, parameters, undefined);
  }

  private getToolContent(
    name: string,
    parameters: Record<string, unknown> | undefined,
    shortResult: string | undefined,
  ): ToolCallContent[] | undefined {
    const contents: ToolCallContent[] = [];
    if (parameters) {
      if (name === "Write") {
        contents.push({
          type: "diff",
          path: (parameters.file_path || parameters.filePath) as string,
          oldText: null,
          newText: parameters.content as string,
        });
      } else if (name === "Edit") {
        contents.push({
          type: "diff",
          path: (parameters.file_path || parameters.filePath) as string,
          oldText: parameters.old_string as string,
          newText: parameters.new_string as string,
        });
      }
    }

    if (shortResult) {
      contents.push({
        type: "content",
        content: {
          type: "text",
          text: shortResult,
        },
      });
    }

    return contents.length > 0 ? contents : undefined;
  }

  private getToolLocations(
    name: string,
    parameters: Record<string, unknown> | undefined,
    extraStartLineNumber?: number,
  ): ToolCallLocation[] | undefined {
    if (!parameters) return undefined;
    if (
      name === "Write" ||
      name === "Edit" ||
      name === "Read" ||
      name === "LSP"
    ) {
      const filePath = (parameters.file_path || parameters.filePath) as string;
      let line =
        extraStartLineNumber ??
        (parameters.startLineNumber as number) ??
        (parameters.line as number) ??
        (parameters.offset as number);

      if (name === "Write" && line === undefined) {
        line = 1;
      }

      if (filePath) {
        return [
          {
            path: filePath,
            line: line,
          },
        ];
      }
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
    const getAgent = () => this.agents.get(sessionId);
    const toolStates = new Map<
      string,
      {
        name?: string;
        compactParams?: string;
        shortResult?: string;
        startLineNumber?: number;
      }
    >();
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
        const {
          id,
          name,
          stage,
          success,
          error,
          result,
          parameters,
          compactParams,
          shortResult,
          startLineNumber,
        } = params;

        let state = toolStates.get(id);
        if (!state) {
          state = {};
          toolStates.set(id, state);
        }
        if (name) state.name = name;
        if (compactParams) state.compactParams = compactParams;
        if (shortResult) state.shortResult = shortResult;
        if (startLineNumber !== undefined)
          state.startLineNumber = startLineNumber;

        const effectiveName = state.name || name;
        const effectiveCompactParams = state.compactParams || compactParams;
        const effectiveShortResult = state.shortResult || shortResult;
        const effectiveStartLineNumber =
          state.startLineNumber !== undefined
            ? state.startLineNumber
            : startLineNumber;

        const displayTitle =
          effectiveName && effectiveCompactParams
            ? `${effectiveName}: ${effectiveCompactParams}`
            : effectiveName || "Tool Call";

        let parsedParameters: Record<string, unknown> | undefined = undefined;
        if (parameters) {
          try {
            parsedParameters = JSON.parse(parameters);
          } catch {
            // Ignore parse errors during streaming
          }
        }

        const content =
          effectiveName && (parsedParameters || effectiveShortResult)
            ? this.getToolContent(
                effectiveName,
                parsedParameters,
                effectiveShortResult,
              )
            : undefined;
        const locations =
          effectiveName && parsedParameters
            ? this.getToolLocations(
                effectiveName,
                parsedParameters,
                effectiveStartLineNumber,
              )
            : undefined;
        const kind = effectiveName
          ? this.getToolKind(effectiveName)
          : undefined;

        if (stage === "start") {
          this.connection.sessionUpdate({
            sessionId: sessionId as AcpSessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: id,
              title: displayTitle,
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
            title: displayTitle,
            rawOutput: result || error,
            content,
            locations,
            kind,
            rawInput: parsedParameters,
          },
        });

        if (stage === "end") {
          toolStates.delete(id);
        }
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
      onPermissionModeChange: (mode) => {
        this.connection.sessionUpdate({
          sessionId: sessionId as AcpSessionId,
          update: {
            sessionUpdate: "current_mode_update",
            currentModeId: mode,
          },
        });
        const agent = getAgent();
        if (agent) {
          this.connection.sessionUpdate({
            sessionId: sessionId as AcpSessionId,
            update: {
              sessionUpdate: "config_option_update",
              configOptions: this.getSessionConfigOptions(agent),
            },
          });
        }
      },
    };
  }
}
