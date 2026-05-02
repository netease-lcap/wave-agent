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
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  AskUserQuestion,
  AskUserQuestionOption,
} from "wave-agent-sdk";
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
  type TextContent,
  type ResourceLink,
  type EmbeddedResource,
  type ImageContent,
  type McpServer,
  AGENT_METHODS,
} from "@agentclientprotocol/sdk";
import type { McpServerConfig, McpServerStatus } from "wave-agent-sdk";

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
        {
          id: "dontAsk",
          name: "Don't Ask",
          description:
            "Automatically deny restricted tools unless pre-approved",
        },
      ],
    };
  }

  private getSessionConfigOptions(agent: WaveAgent): SessionConfigOption[] {
    const configuredModels = agent.getConfiguredModels();
    const currentModel = agent.getModelConfig().model;

    return [
      {
        id: "permission_mode",
        name: "Permission Mode",
        description: "Controls how the agent requests permission",
        type: "select",
        category: "mode",
        currentValue: agent.getPermissionMode(),
        options: [
          { value: "default", name: "Default" },
          { value: "acceptEdits", name: "Accept Edits" },
          { value: "plan", name: "Plan" },
          { value: "bypassPermissions", name: "Bypass Permissions" },
          { value: "dontAsk", name: "Don't Ask" },
        ],
      },
      {
        id: "model",
        name: "Model",
        description: "The AI model to use for this session",
        type: "select",
        category: "model",
        currentValue: currentModel,
        options: configuredModels.map((m) => ({
          value: m,
          name: m,
        })),
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
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: {
          list: {},
          close: {},
        },
        promptCapabilities: {
          image: true,
          embeddedContext: true,
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
    mcpServers?: McpServer[],
  ): Promise<WaveAgent> {
    const callbacks: AgentOptions["callbacks"] = {};
    const agentRef: { instance?: WaveAgent } = {};

    const sdkMcpServers = mcpServers
      ? convertAcpMcpServers(mcpServers)
      : undefined;

    const agent = await WaveAgent.create({
      workdir: cwd,
      restoreSessionId: sessionId,
      stream: true,
      mcpServers: sdkMcpServers,
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
        onModelChange: (model) => callbacks.onModelChange?.(model),
        onUserMessageAdded: (params) => callbacks.onUserMessageAdded?.(params),
        onMcpServersChange: (servers) => callbacks.onMcpServersChange?.(servers),
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
    const { cwd, mcpServers } = params;
    logger.info(`Creating new session in ${cwd}`);
    const agent = await this.createAgent(undefined, cwd, mcpServers);
    logger.info(`New session created with ID: ${agent.sessionId}`);

    return {
      sessionId: agent.sessionId as AcpSessionId,
      modes: this.getSessionModeState(agent),
      configOptions: this.getSessionConfigOptions(agent),
    };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const { sessionId, cwd, mcpServers } = params;
    logger.info(`Loading session: ${sessionId} in ${cwd}`);
    const agent = await this.createAgent(sessionId, cwd, mcpServers);

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
      modeId as
        | "default"
        | "acceptEdits"
        | "plan"
        | "bypassPermissions"
        | "dontAsk",
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
        value as
          | "default"
          | "acceptEdits"
          | "plan"
          | "bypassPermissions"
          | "dontAsk",
      );
    } else if (configId === "model" && typeof value === "string") {
      agent.setModel(value);
    }

    return {
      configOptions: this.getSessionConfigOptions(agent),
    };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const { sessionId, prompt } = params;
    logger.info(`Received prompt for session ${sessionId}`);
    logger.debug(`Prompt content for session ${sessionId}:`, prompt);
    const agent = this.agents.get(sessionId);
    if (!agent) {
      logger.error(`Session ${sessionId} not found`);
      throw new Error(`Session ${sessionId} not found`);
    }

    // Map ACP prompt to Wave Agent sendMessage
    const textBlocks: string[] = [];
    const images: { path: string; mimeType: string }[] = [];

    for (const block of prompt) {
      if (block.type === "text") {
        textBlocks.push((block as TextContent).text);
      } else if (block.type === "resource_link") {
        const link = block as ResourceLink;
        textBlocks.push(`[${link.name}](${link.uri})`);
      } else if (block.type === "resource") {
        const embedded = block as EmbeddedResource;
        textBlocks.push(`[Resource](${embedded.resource.uri})`);
      } else if (block.type === "image") {
        const img = block as ImageContent;
        images.push({
          path: img.data.startsWith("data:")
            ? img.data
            : `data:${img.mimeType};base64,${img.data}`,
          mimeType: img.mimeType,
        });
      }
    }

    const textContent = textBlocks.join("\n");

    try {
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

  private getAllowAlwaysName(context: ToolPermissionContext): string {
    if (context.toolName === BASH_TOOL_NAME) {
      const command = (context.toolInput?.command as string) || "";
      if (command.startsWith("mkdir")) {
        return "Yes, and auto-accept edits";
      }
      if (context.suggestedPrefix) {
        const prefix =
          context.suggestedPrefix.length > 12
            ? context.suggestedPrefix.substring(0, 9) + "..."
            : context.suggestedPrefix;
        return `Yes, always allow ${prefix}`;
      }
      return "Yes, always allow this command";
    }
    if (
      context.toolName === EDIT_TOOL_NAME ||
      context.toolName === WRITE_TOOL_NAME
    ) {
      return "Yes, and auto-accept edits";
    }
    if (context.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      return "Yes, auto-accept edits";
    }
    return "Allow Always";
  }

  private async handlePermissionRequest(
    sessionId: string,
    context: ToolPermissionContext,
  ): Promise<PermissionDecision> {
    logger.info(
      `Handling permission request for ${context.toolName} in session ${sessionId}`,
    );

    const agent = this.agents.get(sessionId);

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

    let options: PermissionOption[] = [
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

    if (
      context.toolName === BASH_TOOL_NAME ||
      context.toolName === EDIT_TOOL_NAME ||
      context.toolName === WRITE_TOOL_NAME
    ) {
      options = [
        {
          optionId: "allow_once",
          name: "Yes, proceed",
          kind: "allow_once",
        },
        {
          optionId: "allow_always",
          name: this.getAllowAlwaysName(context),
          kind: "allow_always",
        },
      ];
    } else if (context.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      options = [
        {
          optionId: "allow_once",
          name: "Yes, manually approve edits",
          kind: "allow_once",
        },
        {
          optionId: "allow_always",
          name: "Yes, auto-accept edits",
          kind: "allow_always",
        },
      ];
    } else if (context.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
      options = [
        {
          optionId: "allow_once",
          name: "Yes, enter plan mode",
          kind: "allow_once",
        },
        {
          optionId: "reject_once",
          name: "No, start implementing now",
          kind: "reject_once",
        },
      ];
    } else if (context.toolName === ASK_USER_QUESTION_TOOL_NAME) {
      options = [];
    }

    const content = context.toolName
      ? this.getToolContent(
          context.toolName,
          context.toolInput,
          undefined,
          context.planContent,
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

      if (context.toolName === ASK_USER_QUESTION_TOOL_NAME) {
        return {
          behavior: "allow",
          message: (response as unknown as { message?: string }).message,
        };
      }

      const selectedOptionId = response.outcome.optionId;
      logger.info(`User selected permission option: ${selectedOptionId}`);

      switch (selectedOptionId) {
        case "allow_always":
          if (context.toolName === BASH_TOOL_NAME) {
            const command = (context.toolInput?.command as string) || "";
            const rule = context.suggestedPrefix || command;
            return {
              behavior: "allow",
              newPermissionRule: `${BASH_TOOL_NAME}(${rule})`,
            };
          }
          if (
            context.toolName === EDIT_TOOL_NAME ||
            context.toolName === WRITE_TOOL_NAME ||
            context.toolName === EXIT_PLAN_MODE_TOOL_NAME
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
          if (context.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
            return { behavior: "allow", newPermissionMode: "default" };
          }
          if (context.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
            return { behavior: "allow", newPermissionMode: "plan" };
          }
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

  private getToolContent(
    name: string,
    parameters: Record<string, unknown> | undefined,
    shortResult: string | undefined,
    planContent?: string,
  ): ToolCallContent[] | undefined {
    const contents: ToolCallContent[] = [];
    if (parameters) {
      if (
        name === WRITE_TOOL_NAME &&
        typeof parameters.file_path === "string" &&
        typeof parameters.content === "string"
      ) {
        contents.push({
          type: "diff",
          path: parameters.file_path,
          oldText: null,
          newText: parameters.content,
        });
      } else if (
        name === EDIT_TOOL_NAME &&
        typeof parameters.file_path === "string" &&
        typeof parameters.old_string === "string" &&
        typeof parameters.new_string === "string"
      ) {
        contents.push({
          type: "diff",
          path: parameters.file_path,
          oldText: parameters.old_string,
          newText: parameters.new_string,
        });
      } else if (
        name === BASH_TOOL_NAME &&
        typeof parameters.command === "string"
      ) {
        contents.push({
          type: "content",
          content: {
            type: "text",
            text: "**Command:**\n```bash\n" + parameters.command + "\n```",
          },
        });
      } else if (name === EXIT_PLAN_MODE_TOOL_NAME && planContent) {
        contents.push({
          type: "content",
          content: {
            type: "text",
            text: planContent,
          },
        });
      } else if (
        name === ASK_USER_QUESTION_TOOL_NAME &&
        Array.isArray(parameters.questions)
      ) {
        const markdown = (parameters.questions as AskUserQuestion[])
          .map((q, i) => {
            let text = `### Question ${i + 1}\n${q.question}\n`;
            if (Array.isArray(q.options)) {
              text += q.options
                .map(
                  (opt: AskUserQuestionOption) =>
                    `- ${opt.label}${opt.description ? `: ${opt.description}` : ""}`,
                )
                .join("\n");
            }
            return text;
          })
          .join("\n\n");
        contents.push({
          type: "content",
          content: {
            type: "text",
            text: markdown,
          },
        });
      }

      if (name.startsWith("mcp__")) {
        contents.push({
          type: "content",
          content: {
            type: "text",
            text: "```json\n" + JSON.stringify(parameters, null, 2) + "\n```",
          },
        });
      }
    }

    if (shortResult) {
      contents.push({
        type: "content",
        content: {
          type: "text",
          text:
            name === BASH_TOOL_NAME
              ? "```\n" + shortResult + "\n```"
              : shortResult,
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
            const parsed = JSON.parse(parameters);
            parsedParameters = Array.isArray(parsed)
              ? { args: parsed }
              : parsed;
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
      onModelChange: () => {
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
      onUserMessageAdded: (params) => {
        this.connection.sessionUpdate({
          sessionId: sessionId as AcpSessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: params.content },
          },
        });
      },
      onMcpServersChange: (servers: McpServerStatus[]) => {
        for (const server of servers) {
          this.connection.sessionUpdate({
            sessionId: sessionId as AcpSessionId,
            update: {
              sessionUpdate: "ext_notification" as const,
              method: "mcp_server_status",
              params: {
                name: server.name,
                status: server.status,
                toolCount: server.toolCount,
                error: server.error,
              },
            },
          });
        }
      },
    };
  }
}

/**
 * Convert ACP McpServer[] to SDK Record<string, McpServerConfig>.
 */
function convertAcpMcpServers(
  servers: McpServer[],
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const server of servers) {
    const config: McpServerConfig = {};
    if ("type" in server && server.type === "http") {
      config.url = server.url;
      config.headers = convertHttpHeaders(server.headers);
    } else if ("type" in server && server.type === "sse") {
      config.url = server.url;
      config.headers = convertHttpHeaders(server.headers);
    } else {
      // stdio (no type discriminator)
      config.command = server.command;
      config.args = server.args;
      config.env = convertEnvVariables(server.env);
    }
    result[server.name] = config;
  }
  return result;
}

/**
 * Convert ACP EnvVariable[] to SDK Record<string, string>.
 */
function convertEnvVariables(
  env: Array<{ name: string; value: string }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of env) {
    result[entry.name] = entry.value;
  }
  return result;
}

/**
 * Convert ACP HttpHeader[] to SDK Record<string, string>.
 */
function convertHttpHeaders(
  headers: Array<{ name: string; value: string }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of headers) {
    result[entry.name] = entry.value;
  }
  return result;
}
