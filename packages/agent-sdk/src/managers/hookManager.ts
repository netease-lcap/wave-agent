/**
 * Hook Manager
 *
 * Central orchestrator for the hooks system. Handles configuration loading,
 * validation, and hook execution across all supported events.
 */

import {
  type HookCommand,
  type HookEvent,
  type HookEventConfig,
  type HookExecutionContext,
  type ExtendedHookExecutionContext,
  type HookExecutionResult,
  type HookMcpServerRef,
  type HookValidationResult,
  type SessionEndSource,
  type SessionStartSource,
  HookConfigurationError,
  HOOK_SOURCE_LIMITS,
  isValidHookEvent,
  isValidHookEventConfig,
} from "../types/hooks.js";
import type {
  WaveConfiguration,
  PartialHookConfiguration,
} from "../types/configuration.js";
import { HookMatcher } from "../utils/hookMatcher.js";
import { executeCommand, isCommandSafe } from "../services/hook.js";
import { basename } from "path";
import type { MessageManager } from "./messageManager.js";
import type { MessageQueue } from "./messageQueue.js";
import { taskNotificationToXml } from "../utils/notificationXml.js";
import { Container } from "../utils/container.js";
import type { ConfigurationService } from "../services/configurationService.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import { toolResponsePayload } from "../utils/toolResponse.js";
import { logOTelEvent } from "../telemetry/events.js";
import { entrypointOf } from "../telemetry/attributes.js";

import { logger } from "../utils/globalLogger.js";

/** Debug-log shape for hook results, shared by the tool-event executors. */
function summarizeHookResults(results: HookExecutionResult[]) {
  return results.map((r) => ({
    success: r.success,
    duration: r.duration,
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    stderr: r.stderr,
  }));
}

/**
 * Where a hook came from, as the user-facing error notice words it.
 *
 * Only the sources that are not the session's own get a label: a skill's hook
 * must say `skill:<name>` (its author cannot see the user's settings, and the
 * user cannot tell a skill's interception from their own), a plugin's says
 * `plugin:<dir>`. A `settings.json` / AgentOptions hook returns undefined and
 * reads exactly as before — labelling the default everywhere would be noise.
 *
 * The name is the skill's own `name` (not the directory) because that is what
 * the user invoked; the path is only a fallback for a command that lost its
 * stamp on the way (e.g. one registered outside `registerSkillHooks`).
 */
function hookSourceLabel(command: {
  skillRoot?: string;
  skillName?: string;
  pluginRoot?: string;
}): string | undefined {
  if (command.skillRoot) {
    return `skill:${command.skillName ?? basename(command.skillRoot)}`;
  }
  if (command.pluginRoot) {
    return `plugin:${basename(command.pluginRoot)}`;
  }
  return undefined;
}

/** Append one hook's text to a running collector, newline-separated. */
function appendHookText(current: string | undefined, text: string) {
  return current ? `${current}\n${text}` : text;
}

/**
 * What the PostToolUse hook input says about the call itself, besides the
 * result. Filled by the two execution funnels, which are the only places that
 * know the `tool_use` id, when the call started, and which MCP server ran it.
 */
export interface ToolHookCallInfo {
  /** Id of the `tool_use` block (Claude Code's `tool_use_id`). */
  toolUseId?: string;
  /** Call duration in ms (Claude Code's `duration_ms`). */
  durationMs?: number;
  /** The MCP server that answered; absent for every non-MCP tool. */
  mcpServer?: HookMcpServerRef;
}

export class HookManager {
  private configuration: PartialHookConfiguration | undefined;
  private programmaticHooks: PartialHookConfiguration = {};
  /**
   * Plugin hooks grouped by plugin root path. A map rather than one merged
   * object because mergeHooksConfiguration only appends — a flat object can
   * never be reversed, so the in-place plugin reload path could not drop
   * exactly one plugin's hooks (and re-registering would double them).
   */
  private pluginHooks = new Map<string, PartialHookConfiguration>();
  /**
   * Skill hooks grouped by the skill's absolute directory path. Keyed by path
   * rather than by skill name because a name identifies nothing here: two
   * skills may carry the same one, and a hot reload re-parses the same skill
   * from a new directory. The path is what a re-register can replace exactly,
   * so one skill never ends up with two registrations and a stale one can be
   * dropped without touching its namesake.
   */
  private skillHooks = new Map<string, PartialHookConfiguration>();
  private waveConfigHooks: PartialHookConfiguration = {};
  /**
   * Fingerprints of `once` commands that already ran successfully in this
   * session. Retiring the command from its source is not enough on its own:
   * every reload path re-registers from configuration that still says
   * `once: true` (a skills-dir file change re-parses the skill, a settings
   * reload rebuilds the wave config), and a fresh copy has no memory of having
   * run. The set is what makes "once" mean once per session rather than once
   * per registration (spec `automation/skill-hooks` 边界情况).
   */
  private readonly exhaustedOnceHooks = new Set<string>();
  private readonly matcher: HookMatcher;
  private readonly workdir: string;

  constructor(
    private container: Container,
    workdir: string,
    matcher: HookMatcher = new HookMatcher(),
  ) {
    this.workdir = workdir;
    this.matcher = matcher;
  }

  /**
   * Merged env for this session (OS env overlaid with the per-session settings
   * snapshot). Hook subprocesses spawn with this env so settings.json `env`
   * vars reach hooks without polluting other sessions in one stdio process.
   */
  private get sessionEnv(): Record<string, string> {
    return (
      this.container
        .get<ConfigurationService>("ConfigurationService")
        ?.getMergedEnv?.() ?? (process.env as Record<string, string>)
    );
  }

  /**
   * Load hook configuration from programmatic source (AgentOptions.hooks)
   */
  loadConfiguration(hooks?: PartialHookConfiguration): void {
    this.programmaticHooks = {};

    if (hooks) {
      this.mergeHooksConfiguration(this.programmaticHooks, hooks);
    }

    // Validate merged configuration
    const validation = this.validatePartialConfiguration(
      this.programmaticHooks,
    );
    if (!validation.valid) {
      throw new HookConfigurationError(
        "merged configuration",
        validation.errors,
      );
    }

    this.rebuildConfiguration();
  }

  /**
   * Load hooks configuration from a pre-loaded WaveConfiguration
   * Configuration loading is now handled by ConfigurationService
   */
  loadConfigurationFromWaveConfig(waveConfig: WaveConfiguration | null): void {
    try {
      // Replace (not append) wave config hooks to avoid duplicates on reload
      this.waveConfigHooks = {};

      if (waveConfig?.hooks) {
        const validation = this.validatePartialConfiguration(waveConfig.hooks);
        if (!validation.valid) {
          throw new HookConfigurationError(
            "provided configuration",
            validation.errors,
          );
        }
        this.waveConfigHooks = { ...waveConfig.hooks };
      }

      this.rebuildConfiguration();
    } catch (error) {
      // Re-throw configuration errors, but handle other errors gracefully
      if (error instanceof HookConfigurationError) {
        throw error;
      } else {
        logger?.warn(
          `[HookManager] Failed to load configuration, continuing with existing hooks: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Rebuild the full configuration from all sources, in execution order:
   * programmatic (AgentOptions.hooks) → plugin → wave config (settings.json) →
   * skill.
   *
   * The order is the spec's, not an accident (spec `automation/skill-hooks`
   * 故事③场景 3): settings always runs before a skill's hooks. Hooks are never
   * merged across sources — every source appends — so this order is the only
   * thing that decides who runs first.
   *
   * Merging concatenates the per-event config arrays and clones nothing, so
   * each config object and each command object in the rebuilt view *is* the
   * object held by its source. That is what lets `removeExecutedOnceHook`
   * find a command by reference.
   */
  private rebuildConfiguration(): void {
    const rebuilt: PartialHookConfiguration = {};
    this.mergeHooksConfiguration(rebuilt, this.programmaticHooks);
    for (const hooks of this.pluginHooks.values()) {
      this.mergeHooksConfiguration(rebuilt, hooks);
    }
    this.mergeHooksConfiguration(rebuilt, this.waveConfigHooks);
    for (const hooks of this.skillHooks.values()) {
      this.mergeHooksConfiguration(rebuilt, hooks);
    }
    this.dropExhaustedOnceHooks(rebuilt);
    this.configuration = Object.keys(rebuilt).length > 0 ? rebuilt : undefined;
  }

  /**
   * Remove the commands this session already ran as `once` from the view an
   * execution sees. Merging is the single funnel every source goes through, so
   * filtering here covers a re-registered skill, a reloaded settings file and a
   * re-registered plugin alike — without any of them having to know the set
   * exists.
   *
   * A config that loses nothing keeps its own object (and its own `hooks`
   * array), so the identity lookup in {@link removeExecutedOnceHook} still
   * points at the source's command. A config that does lose a command gets a
   * copy: its source keeps the original for the next merge, and the exhausted
   * fingerprint — not the removal — is what keeps the command out.
   */
  private dropExhaustedOnceHooks(
    configuration: PartialHookConfiguration,
  ): void {
    if (this.exhaustedOnceHooks.size === 0) return;
    for (const [event, configs] of Object.entries(configuration)) {
      if (!isValidHookEvent(event)) continue;
      const kept = configs
        .map((config) => {
          const hooks = config.hooks.filter(
            (command) =>
              !this.exhaustedOnceHooks.has(
                HookManager.onceFingerprint(event, config.matcher, command),
              ),
          );
          return hooks.length === config.hooks.length
            ? config
            : { ...config, hooks };
        })
        .filter((config) => config.hooks.length > 0);
      if (kept.length === 0) {
        delete configuration[event];
      } else {
        configuration[event] = kept;
      }
    }
  }

  /**
   * Identity of a `once` command: the source that owns it, the event, the
   * matcher and the command text. Two sources holding the same hook text are
   * separate commands (故事③场景 1), while an edit to the skill's own command
   * text is a new command that has not run yet.
   */
  private static onceFingerprint(
    event: HookEvent,
    matcher: string | undefined,
    command: HookCommand,
  ): string {
    // Hooks with no stamp are the session's own (settings.json / AgentOptions);
    // they share one key, which is right: the same command written in both is
    // the same hook as far as "has this already run" goes.
    const source = command.skillRoot
      ? `skill:${command.skillRoot}`
      : command.pluginRoot
        ? `plugin:${command.pluginRoot}`
        : "session";
    return [source, event, matcher ?? "", command.command].join("\u0000");
  }

  /**
   * Execute hooks for a specific event
   */
  async executeHooks(
    event: HookEvent,
    context: HookExecutionContext | ExtendedHookExecutionContext,
  ): Promise<HookExecutionResult[]> {
    // Validate execution context
    const contextValidation = this.validateExecutionContext(event, context);
    if (!contextValidation.valid) {
      logger?.error(
        `[HookManager] Invalid execution context for ${event}: ${contextValidation.errors.join(", ")}`,
      );
      return [
        {
          success: false,
          stderr: `Invalid execution context: ${contextValidation.errors.join(", ")}`,
          duration: 0,
          timedOut: false,
        },
      ];
    }

    if (!this.configuration) {
      return [];
    }

    const eventConfigs = this.configuration[event];
    if (!eventConfigs || eventConfigs.length === 0) {
      return [];
    }

    const results: HookExecutionResult[] = [];

    for (
      let configIndex = 0;
      configIndex < eventConfigs.length;
      configIndex++
    ) {
      const config = eventConfigs[configIndex];

      // Check if this config applies to the current context
      if (
        !this.configApplies(config, event, this.matchValueFor(event, context))
      ) {
        continue;
      }

      // Execute all commands for this configuration. The commands are
      // snapshotted because a `once` hook retires itself mid-loop, and the
      // rebuilt view shares this very `hooks` array with its source (merging
      // only concatenates the config arrays), so a splice would shift the next
      // command under the index and skip it.
      for (const [commandIndex, hookCommand] of [...config.hooks].entries()) {
        try {
          const options = hookCommand.timeout
            ? { timeout: hookCommand.timeout * 1000 }
            : undefined;

          // Build execution context with WAVE_PLUGIN_ROOT / WAVE_SKILL_DIR when
          // this hook came from a plugin or a skill.
          let command = hookCommand.command;
          const sourceEnv = {
            ...("env" in context ? (context.env ?? {}) : {}),
            ...(hookCommand.pluginRoot
              ? {
                  WAVE_PLUGIN_ROOT: hookCommand.pluginRoot,
                  CLAUDE_PLUGIN_ROOT: hookCommand.pluginRoot,
                }
              : {}),
            ...(hookCommand.skillRoot
              ? {
                  WAVE_SKILL_DIR: hookCommand.skillRoot,
                  CLAUDE_SKILL_DIR: hookCommand.skillRoot,
                }
              : {}),
          };
          const execContext: typeof context =
            hookCommand.pluginRoot || hookCommand.skillRoot
              ? { ...context, env: sourceEnv }
              : context;

          // Substitute the directory placeholders in the command string.
          // ${WAVE_SKILL_DIR} is substituted here as well even though the skill
          // parse already resolved it: other sources (programmatic hooks) can
          // carry the token too, and a literal token reaches the shell as a
          // broken path instead of a visible error.
          if (hookCommand.pluginRoot) {
            command = command.replace(
              /\$\{WAVE_PLUGIN_ROOT\}/g,
              hookCommand.pluginRoot,
            );
            command = command.replace(
              /\$\{CLAUDE_PLUGIN_ROOT\}/g,
              hookCommand.pluginRoot,
            );
          }
          if (hookCommand.skillRoot) {
            command = command.replace(
              /\$\{WAVE_SKILL_DIR\}/g,
              hookCommand.skillRoot,
            );
            command = command.replace(
              /\$\{CLAUDE_SKILL_DIR\}/g,
              hookCommand.skillRoot,
            );
          }

          if (hookCommand.async || hookCommand.asyncRewake) {
            // Execute async command without awaiting. `asyncRewake` implies
            // `async` — a hook whose result is only ever read on exit code 2
            // has nothing to contribute to the caller's return value.
            const execution = executeCommand(command, execContext, options);
            if (hookCommand.asyncRewake) {
              // A rewaking hook has to inspect its own result rather than just
              // its rejection, so it cannot share the failure logger below.
              void this.rewakeOnBlockingError(
                `${event}:${configIndex}:${commandIndex}`,
                execution,
              );
            } else {
              execution.catch((error) => {
                const errorMessage =
                  error instanceof Error
                    ? error.message
                    : "Unknown execution error";
                logger?.error(
                  `[HookManager] Async hook command ${commandIndex + 1} failed: ${errorMessage}`,
                );
              });
            }
            // Async hooks are not included in results to prevent blocking.
            // `once` is deliberately not honoured here: an async hook's result
            // arrives after the loop has moved on (and possibly after the turn
            // ended), so there is no synchronous success to retire it on —
            // retiring on spawn alone would drop a hook that never ran.
            continue;
          }

          const result = await executeCommand(command, execContext, options);
          results.push({
            ...result,
            command,
            source: hookSourceLabel(hookCommand),
          });

          // `once`: a successful run has done its job for the session, so the
          // command leaves its own source and the next match skips it. Only
          // success counts — a non-zero exit or a timeout leaves the
          // registration in place so a transient failure cannot silently
          // remove an interception hook.
          if (hookCommand.once && result.success) {
            // Two records, on purpose: the removal keeps this source clean for
            // `getSkillHooks()` and the tests that read it, while the
            // fingerprint survives a re-registration from configuration that
            // still says `once: true` — that is what makes it once per
            // session rather than once per registration.
            this.exhaustedOnceHooks.add(
              HookManager.onceFingerprint(event, config.matcher, hookCommand),
            );
            this.removeExecutedOnceHook(hookCommand);
          }

          // Continue with next command even if this one fails
          // This allows for non-critical hooks to fail without stopping the workflow
        } catch (error) {
          // This should be rare as executor handles most errors
          const errorMessage =
            error instanceof Error ? error.message : "Unknown execution error";
          logger?.error(
            `[HookManager] Unexpected error in command ${commandIndex + 1}: ${errorMessage}`,
          );

          results.push({
            success: false,
            stderr: errorMessage,
            duration: 0,
            timedOut: false,
            command: hookCommand.command,
            source: hookSourceLabel(hookCommand),
          });
        }
      }
    }

    return results;
  }

  /**
   * Deliver an async hook's blocking-error output to the model.
   *
   * `asyncRewake` is not "run in the background" — it is "keep the result of a
   * background run". Nobody awaits the hook, and by the time it finishes the
   * turn that launched it is usually over, so the only channel left to reach the
   * model is a queued notification: an idle session starts a new turn, a busy
   * one has the text injected into the turn already running, and either way the
   * user's next action is not displaced. Exit code 2 is the wake condition (the
   * blocking-error code everywhere else in this file); any other exit code, a
   * timeout, or a spawn failure stays silent, because a hook that could not run
   * must never wake the model.
   */
  private async rewakeOnBlockingError(
    hookId: string,
    execution: Promise<HookExecutionResult>,
  ): Promise<void> {
    let result: HookExecutionResult;
    try {
      result = await execution;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown execution error";
      logger?.error(
        `[HookManager] Rewaking hook ${hookId} failed: ${errorMessage}`,
      );
      return;
    }

    if (result.timedOut || result.exitCode !== 2) return;

    const text = result.stderr?.trim() || result.stdout?.trim();
    if (!text) return;

    const messageQueue = this.container.has("MessageQueue")
      ? this.container.get<MessageQueue>("MessageQueue")
      : undefined;
    if (!messageQueue) return;

    messageQueue.enqueueNotification(
      taskNotificationToXml({
        type: "task_notification",
        taskId: `hook-${hookId}`,
        taskType: "hook",
        status: "failed",
        summary: `<system-reminder>\n${text}\n</system-reminder>`,
      }),
    );
  }

  /**
   * Run the PreToolUse hooks for one tool call and report whether it is blocked.
   *
   * Tool events live here rather than in the tool-call loop because a tool can be
   * reached two ways — declared flat, or through the REPL sandbox's pool — and
   * both take the same execution funnel (`ToolManager.execute` for built-ins,
   * `McpManager.executeMcpTool` for MCP). Hanging the hooks on the funnels is
   * what makes a nested call auditable exactly like a flat one.
   *
   * Returns the text the model must see for a blocked call (Claude Code's
   * `PreToolUse:<tool> hook error: <stderr>`), or null to let the call run.
   * Hook failures fail open: a hook that cannot run never blocks a tool.
   */
  async executePreToolUseHooks(
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    context: ToolContext,
  ): Promise<string | null> {
    try {
      const results = await this.executeHooks(
        "PreToolUse",
        this.buildToolHookContext(
          "PreToolUse",
          toolName,
          toolInput,
          undefined,
          context,
        ),
      );
      if (results.length === 0) return null;

      logger?.debug(
        `Executed ${results.length} PreToolUse hook(s) for ${toolName}:`,
        summarizeHookResults(results),
      );

      const blocking = this.processToolHookResults(
        "PreToolUse",
        results,
        context.messageManager,
      );

      logOTelEvent(
        "tool_decision",
        {
          tool_name: toolName,
          decision: blocking ? "blocked" : "approved",
          source: "hook",
        },
        {
          sessionId: context.sessionId,
          // The session's starting directory, not the shell-following one a
          // tool context carries (see `SessionWorkdir` in containerSetup).
          workdir:
            this.container.get<string>("SessionWorkdir") ?? context.workdir,
          entrypoint: entrypointOf(this.container),
        },
      ).catch(() => {}); // Non-blocking

      return blocking
        ? this.formatToolHookMessage("PreToolUse", toolName, blocking)
        : null;
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error("PreToolUse hook execution failed:", error);
      return null;
    }
  }

  /**
   * Run the PostToolUse hooks for one tool call.
   *
   * Exit code 2 cannot block a call that already ran: Claude Code shows the
   * stderr to the model as an injected message instead, and so do we — the tool
   * result itself is never rewritten.
   *
   * The hook input carries the tool's `data` as `tool_response` (see
   * {@link toolResponsePayload}), plus the call's identity and cost
   * (`tool_use_id` / `duration_ms` / `mcp_server`, all four from Claude Code's
   * PostToolUse schema).
   */
  async executePostToolUseHooks(
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    toolResponse: ToolResult | undefined,
    context: ToolContext,
    call?: ToolHookCallInfo,
  ): Promise<void> {
    try {
      const results = await this.executeHooks(
        "PostToolUse",
        this.buildToolHookContext(
          "PostToolUse",
          toolName,
          toolInput,
          toolResponse,
          context,
          call,
        ),
      );
      if (results.length === 0) return;

      logger?.debug(
        `Executed ${results.length} PostToolUse hook(s) for ${toolName}:`,
        summarizeHookResults(results),
      );

      const blocking = this.processToolHookResults(
        "PostToolUse",
        results,
        context.messageManager,
      );

      if (blocking && context.messageManager) {
        context.messageManager.addUserMessage({
          content: this.formatToolHookMessage(
            "PostToolUse",
            toolName,
            blocking,
          ),
          isMeta: true,
        });
      }
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error("PostToolUse hook execution failed:", error);
    }
  }

  /**
   * Exit-code handling for tool events: a blocking result (exit code 2) takes
   * precedence and is returned for the caller to surface, every other result
   * only reaches the user — plain-text stdout of tool hooks is dropped, as in
   * Claude Code. The structured (`hookSpecificOutput.additionalContext`)
   * channel is read from every result, whatever the exit code, because it is
   * orthogonal to it.
   */
  private processToolHookResults(
    event: "PreToolUse" | "PostToolUse",
    results: HookExecutionResult[],
    messageManager?: MessageManager,
  ): HookExecutionResult | undefined {
    const blocking = results.find((result) => result.exitCode === 2);

    if (messageManager) {
      for (const result of results) {
        this.injectAdditionalContext(event, result, messageManager);
        this.injectNotice(result, messageManager);
      }
    }

    if (blocking) return blocking;
    if (!messageManager) return undefined;

    for (const result of results) {
      if (result.exitCode === undefined) continue;
      if (result.exitCode === 0) {
        this.handleHookSuccess(event, result, messageManager);
      } else {
        this.handleNonBlockingError(result, messageManager);
      }
    }
    return undefined;
  }

  /**
   * The model-visible wording of a tool-event hook result, verbatim from Claude
   * Code: the same string on both sides is what lets a hook (and its author's
   * expectations) move between the two without re-reading the docs. PostToolUse
   * also names the command, since several hooks can match one tool and the model
   * needs to know which one objected.
   */
  private formatToolHookMessage(
    event: "PreToolUse" | "PostToolUse",
    toolName: string,
    result: HookExecutionResult,
  ): string {
    const stderr = result.stderr?.trim() || "Hook execution failed";
    const label = `${event}:${toolName}`;
    return event === "PreToolUse"
      ? `${label} hook error: ${stderr}`
      : `${label} hook blocking error from command: "${result.command ?? ""}": ${stderr}`;
  }

  private buildToolHookContext(
    event: "PreToolUse" | "PostToolUse",
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    toolResult: ToolResult | undefined,
    context: ToolContext,
    call?: ToolHookCallInfo,
  ): ExtendedHookExecutionContext {
    const workdir = context.workdir || this.workdir;
    return {
      event,
      projectDir: workdir,
      // Tool hooks run in the current workdir (which drifts when the model
      // `cd`s), but $WAVE_PROJECT_DIR must stay anchored to the session root,
      // otherwise every hook command written against it breaks after a `cd`.
      sessionRoot: this.workdir,
      timestamp: new Date(),
      toolName,
      sessionId: context.sessionId ?? context.messageManager?.getSessionId(),
      transcriptPath: context.messageManager?.getTranscriptPath(),
      cwd: workdir,
      toolInput,
      // `tool_response` 是工具自己的 `data`，不是整个 `ToolResult`（口径见
      // `utils/toolResponse.ts`）。
      toolResponse:
        event === "PostToolUse" && toolResult !== undefined
          ? toolResponsePayload(toolResult.data, toolResult.content)
          : undefined,
      toolUseId: call?.toolUseId,
      durationMs: call?.durationMs,
      mcpServer: call?.mcpServer,
      subagentType: context.aiManager?.getSubagentType(),
      planFilePath: context.permissionManager?.getPlanFilePath(),
      env: context.sessionEnv,
    };
  }

  /**
   * Process hook execution results for the non-tool events and determine
   * appropriate actions based on exit codes and hook event type.
   *
   * Tool events (PreToolUse / PostToolUse) do not come through here: they have
   * their own executors on the execution funnels, because their feedback has to
   * reach a nested call inside the REPL sandbox too.
   */
  processHookResults(
    event: HookEvent,
    results: HookExecutionResult[],
    messageManager?: MessageManager,
  ): {
    shouldBlock: boolean;
    errorMessage?: string;
  } {
    if (!messageManager || results.length === 0) {
      return { shouldBlock: false };
    }

    // Context from the structured channel is orthogonal to the exit code, so it
    // is collected from every result before the exit-code branches below.
    for (const result of results) {
      this.injectAdditionalContext(event, result, messageManager);
      this.injectNotice(result, messageManager);
    }

    // First pass: Check for any blocking errors (exit code 2)
    // Blocking errors take precedence and stop all processing
    for (const result of results) {
      if (result.exitCode === 2) {
        // Handle blocking error immediately and return
        const blockingResult = this.handleBlockingError(
          event,
          result,
          messageManager,
        );
        return {
          shouldBlock: blockingResult.shouldBlock,
          errorMessage: blockingResult.errorMessage,
        };
      }
    }

    // Second pass: Process all non-blocking results
    for (const result of results) {
      if (result.exitCode === undefined) {
        continue; // Skip results without exit codes
      }

      // Handle exit code interpretation
      if (result.exitCode === 0) {
        // Claude Code's `decision: "block"` channel for the two stop events:
        // exit 0 plus `{"decision":"block","reason":…}` on stdout continues the
        // conversation with that text — the same effect as exit 2 + stderr,
        // without dressing the text up as a hook error. Checked before
        // `handleHookSuccess` so a structured body is never re-emitted as text.
        const stopBlockReason = this.extractStopBlockReason(event, result);
        if (stopBlockReason !== null) {
          messageManager.addUserMessage({
            content: stopBlockReason,
            isMeta: true,
          });
          return { shouldBlock: true, errorMessage: stopBlockReason };
        }
        // Success case - handle stdout based on hook type
        this.handleHookSuccess(event, result, messageManager);
      } else {
        // Non-blocking error case (any exit code except 0 and 2)
        this.handleNonBlockingError(result, messageManager);
      }
    }

    return { shouldBlock: false };
  }

  /**
   * Set the events that honour `hookSpecificOutput.additionalContext`, verbatim
   * from Claude Code's hook output switch: `UserPromptSubmit` / `PreToolUse` /
   * `PostToolUse` (plus `SessionStart`, which keeps its own parsing below).
   * `Stop` / `SubagentStop` are deliberately absent — on those two the only
   * model-visible channel is exit code 2, so a hook that wants to re-prompt the
   * agent exits 2 rather than adding context.
   */
  private static readonly ADDITIONAL_CONTEXT_EVENTS: readonly HookEvent[] = [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
  ];

  /**
   * Parse a hook's stdout as a JSON object, or `null` when it is not one.
   *
   * Every structured field (`systemMessage`, `hookSpecificOutput`, `decision`)
   * travels in this one object, so the three readers share this entry point.
   */
  private parseStdoutJson(
    result: HookExecutionResult,
  ): Record<string, unknown> | null {
    const stdout = result.stdout?.trim();
    if (!stdout || !stdout.startsWith("{")) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return null; // not structured output
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  }

  /**
   * `{"decision":"block","reason":"…"}` on Stop / SubagentStop with exit 0 —
   * Claude Code's second blocking channel (the first being exit 2 + stderr).
   *
   * `reason` is injected as the next instruction and the turn continues, i.e.
   * the same effect as exit 2 without dressing the text up as a hook error.
   * Other events ignore the field: `decision` has no defined meaning there in
   * Claude Code either.
   */
  private extractStopBlockReason(
    event: HookEvent,
    result: HookExecutionResult,
  ): string | null {
    if (event !== "Stop" && event !== "SubagentStop") return null;

    const parsed = this.parseStdoutJson(result);
    if (!parsed || parsed.decision !== "block") return null;

    const reason = parsed.reason;
    if (typeof reason !== "string" || !reason.trim()) return null;
    return reason.trim();
  }

  /**
   * Inject the universal `systemMessage` field: a line for the human reading the
   * conversation, never for the model (Claude Code's warning line).
   *
   * Orthogonal to the exit code, like `additionalContext` above — a hook that
   * blocks (exit code 2) still gets to tell the user *why* it blocked, which is
   * the whole point for looping hooks: the reason reaches the model, the
   * `systemMessage` tells the user which round this is and how to stop.
   *
   * Both fields travel in the same stdout JSON, so this deliberately does not
   * require exit code 0: a hook that blocks keeps writing its reason to stderr
   * (the model-visible channel) and adds this JSON on stdout for the user.
   */
  private injectNotice(
    result: HookExecutionResult,
    messageManager: MessageManager,
  ): void {
    const parsed = this.parseStdoutJson(result);
    if (!parsed) return;

    const systemMessage = parsed.systemMessage;
    if (typeof systemMessage !== "string" || !systemMessage.trim()) return;

    messageManager.addNoticeBlock(systemMessage.trim(), "info");
  }

  /**
   * Inject `hookSpecificOutput.additionalContext` from a hook's stdout.
   *
   * The channel is orthogonal to the exit code (spec `automation/hooks` /
   * 结构化方式：JSON 输出): Claude Code parses stdout JSON before it looks at the
   * exit code, so a hook can add context without manufacturing an error. That is
   * the whole point of the field — exit code 2 + stderr already reaches the
   * model, but it reaches it wearing an error.
   *
   * `SessionStart` is not handled here: it has its own parsing in
   * `executeSessionStartHooks`, which additionally treats non-JSON stdout as
   * context (spec `automation/session-hooks`).
   */
  private injectAdditionalContext(
    event: HookEvent,
    result: HookExecutionResult,
    messageManager: MessageManager,
  ): void {
    if (!HookManager.ADDITIONAL_CONTEXT_EVENTS.includes(event)) return;

    const parsed = this.parseStdoutJson(result);
    if (!parsed) return;

    const hookSpecificOutput = parsed.hookSpecificOutput;
    if (typeof hookSpecificOutput !== "object" || hookSpecificOutput === null) {
      return;
    }

    const output = hookSpecificOutput as Record<string, unknown>;

    if (output.hookEventName !== event) {
      // A hook declared output for a different event: the payload cannot be
      // trusted to belong here, so it is reported rather than injected.
      this.handleNonBlockingError(
        {
          ...result,
          stderr: `Hook returned incorrect event name: expected '${event}' but got '${String(
            output.hookEventName,
          )}'`,
        },
        messageManager,
      );
      return;
    }

    const additionalContext = output.additionalContext;
    if (typeof additionalContext !== "string" || !additionalContext.trim()) {
      return;
    }

    messageManager.addUserMessage({
      content: `<system-reminder>\n${additionalContext.trim()}\n</system-reminder>`,
      isMeta: true,
    });
  }

  /**
   * Handle successful hook execution (exit code 0)
   *
   * `UserPromptSubmit` keeps the contract that its stdout is context for the
   * prompt being submitted — but only while that stdout is plain text. When it
   * is structured, `injectAdditionalContext` already took the context out of it,
   * and dumping the raw JSON into the conversation as well would be noise.
   */
  private handleHookSuccess(
    event: HookEvent,
    result: HookExecutionResult,
    messageManager: MessageManager,
  ): void {
    const stdout = result.stdout?.trim();
    if (event === "UserPromptSubmit" && stdout && !stdout.startsWith("{")) {
      messageManager.addUserMessage({
        content: stdout,
        isMeta: true,
      });
    }
    // For SessionStart, stdout is processed separately in executeSessionStartHooks
    // For SessionEnd, stdout is ignored (fire-and-forget cleanup)
    // For other hook types (PreToolUse, PostToolUse, Stop, PermissionRequest), ignore stdout
  }

  /**
   * Handle blocking error (exit code 2) - behavior varies by hook type
   */
  /**
   * The text a user-facing error notice shows for a failed hook.
   *
   * Same stderr as before, prefixed with the source when the hook has one, so a
   * notice about a skill's interception reads `[skill:verify] …` instead of
   * looking like one of the user's own settings hooks. The model-facing strings
   * are deliberately left alone (see `HookExecutionResult.source`).
   */
  private hookNoticeText(result: HookExecutionResult): string {
    const text = result.stderr?.trim() || "Hook execution failed";
    return result.source ? `[${result.source}] ${text}` : text;
  }

  private handleBlockingError(
    event: HookEvent,
    result: HookExecutionResult,
    messageManager: MessageManager,
  ): {
    shouldBlock: boolean;
    errorMessage?: string;
  } {
    const errorMessage = result.stderr?.trim() || "Hook execution failed";

    switch (event) {
      case "UserPromptSubmit":
        // Block prompt processing, show error to user, erase prompt
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        messageManager.removeLastUserMessage();
        return {
          shouldBlock: true,
          errorMessage,
        };

      case "Stop":
        // Show error to Wave Agent via user message and block stopping to continue conversation
        messageManager.addUserMessage({
          content: errorMessage,
          isMeta: true,
        });
        return { shouldBlock: true, errorMessage };

      case "PermissionRequest":
        // For permission request hooks with exit code 2, show stderr in error block and block (deny) permission
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        return { shouldBlock: true, errorMessage };

      case "SubagentStop":
        // Similar to Stop, show error and allow blocking
        messageManager.addUserMessage({
          content: errorMessage,
          isMeta: true,
        });
        return { shouldBlock: true, errorMessage };

      case "WorktreeCreate":
        // Non-blocking for now, just show error in error block
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        return { shouldBlock: false };

      case "WorktreeRemove":
        // Non-blocking for cleanup, log error but don't block
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        return { shouldBlock: false };

      case "SessionStart":
        // Non-blocking for startup, show error in error block
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        return { shouldBlock: false };

      case "SessionEnd":
        // Blocking error (exit code 2): show in error block, don't block shutdown
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        return { shouldBlock: false };

      case "PreCompact":
        // Non-blocking for compaction, show error in error block
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        return { shouldBlock: false };

      case "PostCompact":
        // Non-blocking for compaction, show error in error block
        messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
        return { shouldBlock: false };

      default:
        return { shouldBlock: false };
    }
  }

  /**
   * Handle non-blocking error (other exit codes)
   */
  private handleNonBlockingError(
    result: HookExecutionResult,
    messageManager: MessageManager,
  ): void {
    messageManager.addNoticeBlock(this.hookNoticeText(result), "error");
  }

  /**
   * Check if hooks are configured for an event/tool combination
   */
  hasHooks(event: HookEvent, matchValue?: string): boolean {
    if (!this.configuration) return false;

    const eventConfigs = this.configuration[event];
    if (!eventConfigs || eventConfigs.length === 0) return false;

    return eventConfigs.some((config) =>
      this.configApplies(config, event, matchValue),
    );
  }

  /**
   * Validate Wave configuration structure and content
   */
  validateConfiguration(config: WaveConfiguration): HookValidationResult {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      return { valid: false, errors: ["Configuration must be an object"] };
    }

    // Validate hooks if present
    if (config.hooks) {
      if (typeof config.hooks !== "object") {
        errors.push("hooks property must be an object");
      } else {
        // Validate each hook event
        for (const [eventName, eventConfigs] of Object.entries(config.hooks)) {
          // Validate event name
          if (!isValidHookEvent(eventName)) {
            errors.push(`Invalid hook event: ${eventName}`);
            continue;
          }

          // Validate event configurations
          if (!Array.isArray(eventConfigs)) {
            errors.push(
              `Hook event ${eventName} must be an array of configurations`,
            );
            continue;
          }

          eventConfigs.forEach((eventConfig, index) => {
            const configErrors = this.validateEventConfig(
              eventName as HookEvent,
              eventConfig,
              index,
            );
            errors.push(...configErrors);
          });
        }
      }
    }

    // Validate environment variables if present
    if (config.env) {
      if (typeof config.env !== "object" || Array.isArray(config.env)) {
        errors.push("env property must be an object");
      } else {
        for (const [key, value] of Object.entries(config.env)) {
          if (typeof key !== "string" || key.trim() === "") {
            errors.push(`Invalid environment variable key: ${key}`);
          }
          if (typeof value !== "string") {
            errors.push(`Environment variable ${key} must have a string value`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate partial hook configuration structure and content
   */
  private validatePartialConfiguration(
    config: PartialHookConfiguration,
  ): HookValidationResult {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      return { valid: false, errors: ["Configuration must be an object"] };
    }

    // Validate each hook event that is present
    for (const [eventName, eventConfigs] of Object.entries(config)) {
      // Validate event name
      if (!isValidHookEvent(eventName)) {
        errors.push(`Invalid hook event: ${eventName}`);
        continue;
      }

      // Validate event configurations
      if (!Array.isArray(eventConfigs)) {
        errors.push(
          `Hook event ${eventName} must be an array of configurations`,
        );
        continue;
      }

      eventConfigs.forEach((eventConfig, index) => {
        const configErrors = this.validateEventConfig(
          eventName as HookEvent,
          eventConfig,
          index,
        );
        errors.push(...configErrors);
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get current configuration
   */
  getConfiguration(): PartialHookConfiguration | undefined {
    if (!this.configuration) return undefined;

    // Deep clone to prevent external modification
    return JSON.parse(JSON.stringify(this.configuration));
  }

  /**
   * Clear current configuration
   */
  clearConfiguration(): void {
    this.configuration = undefined;
  }

  /**
   * Validate execution context for a specific event
   */
  private validateExecutionContext(
    event: HookEvent,
    context: HookExecutionContext,
  ): HookValidationResult {
    const errors: string[] = [];

    // Validate basic context structure
    if (!context || typeof context !== "object") {
      return { valid: false, errors: ["Context must be an object"] };
    }

    // Warn about event mismatch but don't fail validation
    if (context.event !== event) {
      logger?.warn(
        `[HookManager] Context event '${context.event}' does not match requested event '${event}'`,
      );
    }

    // Validate project directory
    if (!context.projectDir || typeof context.projectDir !== "string") {
      errors.push("Context must have a valid projectDir string");
    }

    // Validate timestamp
    if (!context.timestamp || !(context.timestamp instanceof Date)) {
      errors.push("Context must have a valid timestamp Date object");
    }

    // Validate tool-specific requirements
    if (
      event === "PreToolUse" ||
      event === "PostToolUse" ||
      event === "PermissionRequest"
    ) {
      if (!context.toolName || typeof context.toolName !== "string") {
        errors.push(`${event} event requires a valid toolName in context`);
      }
    }

    // Validate non-tool events don't have unexpected tool names
    if (
      (event === "UserPromptSubmit" ||
        event === "Stop" ||
        event === "SubagentStop" ||
        event === "WorktreeCreate" ||
        event === "WorktreeRemove" ||
        event === "SessionStart" ||
        event === "SessionEnd" ||
        event === "PreCompact" ||
        event === "PostCompact") &&
      context.toolName !== undefined
    ) {
      logger?.warn(
        `[HookManager] ${event} event has unexpected toolName in context: ${context.toolName}`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate a summary of hook execution results
   */
  private generateExecutionSummary(
    event: HookEvent,
    results: HookExecutionResult[],
    totalDuration: number,
  ): string {
    if (results.length === 0) {
      return `No hooks executed for ${event}`;
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;
    const timedOut = results.filter((r) => r.timedOut).length;
    const avgDuration =
      results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    let summary = `${successful}/${results.length} commands successful`;

    if (failed > 0) {
      summary += `, ${failed} failed`;
    }

    if (timedOut > 0) {
      summary += `, ${timedOut} timed out`;
    }

    summary += ` (avg: ${Math.round(avgDuration)}ms, total: ${totalDuration}ms)`;

    return summary;
  }

  /**
   * Merge hook configurations, with the second taking precedence
   */
  private mergeHooksConfiguration(
    target: PartialHookConfiguration,
    source: PartialHookConfiguration,
  ): void {
    for (const [event, configs] of Object.entries(source)) {
      if (isValidHookEvent(event)) {
        // Concatenate hook configs so multiple sources (programmatic, file-based, plugins) coexist
        if (!target[event]) {
          target[event] = [...configs];
        } else {
          target[event] = [...target[event], ...configs];
        }
      }
    }
  }

  /**
   * The value a config's `matcher` is tested against, per event.
   *
   * Tool events match the tool name. `SessionStart` matches the firing `source`
   * (`startup` / `resume` / `clear` / `compact`) — Claude Code's `SessionStart`
   * matcher semantics, so a config written for it (`{"matcher": "compact"}`)
   * means the same thing here. Every other event has no matcher value.
   */
  private matchValueFor(
    event: HookEvent,
    context: HookExecutionContext | ExtendedHookExecutionContext,
  ): string | undefined {
    if (event === "SessionStart") {
      return "source" in context ? context.source : undefined;
    }
    return context.toolName;
  }

  /**
   * Check if a hook configuration applies to the current context
   */
  private configApplies(
    config: HookEventConfig,
    event: HookEvent,
    matchValue?: string,
  ): boolean {
    // For events that don't use matchers, config always applies
    if (
      event === "UserPromptSubmit" ||
      event === "Stop" ||
      event === "SubagentStop" ||
      event === "WorktreeCreate" ||
      event === "WorktreeRemove" ||
      event === "CwdChanged" ||
      event === "SessionEnd" ||
      event === "PreCompact" ||
      event === "PostCompact"
    ) {
      return true;
    }

    // Tool events and SessionStart, the two events whose config may carry a
    // matcher: the tool name for the former, the firing `source` for the latter.
    if (
      event === "PreToolUse" ||
      event === "PostToolUse" ||
      event === "PermissionRequest" ||
      event === "SessionStart"
    ) {
      if (!config.matcher) {
        // No matcher means applies to every value (Claude Code's default too)
        return true;
      }

      if (!matchValue) {
        // No value to match against, cannot match
        return false;
      }

      return this.matcher.matches(config.matcher, matchValue);
    }

    return false;
  }

  /**
   * Validate a single event configuration
   */
  private validateEventConfig(
    event: HookEvent,
    config: unknown,
    index: number,
  ): string[] {
    const errors: string[] = [];
    const prefix = `Hook event ${event}[${index}]`;

    if (!isValidHookEventConfig(config)) {
      errors.push(`${prefix}: Invalid hook event configuration structure`);
      return errors;
    }

    // Validate matcher requirements. SessionStart accepts a matcher too: it is
    // matched against the firing `source` (Claude Code semantics), so a config
    // carried over from Claude Code must load instead of failing validation.
    if (
      (event === "PreToolUse" ||
        event === "PostToolUse" ||
        event === "PermissionRequest" ||
        event === "SessionStart") &&
      config.matcher
    ) {
      if (!this.matcher.isValidPattern(config.matcher)) {
        errors.push(`${prefix}: Invalid matcher pattern: ${config.matcher}`);
      }
    }

    // Validate that non-tool events don't have matchers
    if (
      (event === "UserPromptSubmit" ||
        event === "Stop" ||
        event === "SubagentStop" ||
        event === "WorktreeCreate" ||
        event === "WorktreeRemove" ||
        event === "SessionEnd" ||
        event === "PreCompact" ||
        event === "PostCompact") &&
      config.matcher
    ) {
      errors.push(`${prefix}: Event ${event} should not have a matcher`);
    }

    // Validate commands
    config.hooks.forEach((hookCommand, cmdIndex) => {
      if (!isCommandSafe(hookCommand.command)) {
        errors.push(
          `${prefix}.hooks[${cmdIndex}]: Command may be unsafe: ${hookCommand.command}`,
        );
      }
    });

    return errors;
  }

  /**
   * Get statistics about current configuration
   */
  getConfigurationStats(): {
    totalEvents: number;
    totalConfigs: number;
    totalCommands: number;
    eventBreakdown: Record<HookEvent, number>;
  } {
    if (!this.configuration) {
      return {
        totalEvents: 0,
        totalConfigs: 0,
        totalCommands: 0,
        eventBreakdown: {
          PreToolUse: 0,
          PostToolUse: 0,
          UserPromptSubmit: 0,
          Stop: 0,
          SubagentStop: 0,
          PermissionRequest: 0,
          WorktreeCreate: 0,
          WorktreeRemove: 0,
          CwdChanged: 0,
          SessionStart: 0,
          SessionEnd: 0,
          PreCompact: 0,
          PostCompact: 0,
        },
      };
    }

    const eventBreakdown: Record<HookEvent, number> = {
      PreToolUse: 0,
      PostToolUse: 0,
      UserPromptSubmit: 0,
      Stop: 0,
      SubagentStop: 0,
      PermissionRequest: 0,
      WorktreeCreate: 0,
      WorktreeRemove: 0,
      CwdChanged: 0,
      SessionStart: 0,
      SessionEnd: 0,
      PreCompact: 0,
      PostCompact: 0,
    };

    let totalConfigs = 0;
    let totalCommands = 0;

    Object.entries(this.configuration).forEach(([event, configs]) => {
      if (isValidHookEvent(event)) {
        eventBreakdown[event] = configs.length;
        totalConfigs += configs.length;
        totalCommands += configs.reduce(
          (sum, config) => sum + config.hooks.length,
          0,
        );
      }
    });

    return {
      totalEvents: Object.keys(this.configuration).length,
      totalConfigs,
      totalCommands,
      eventBreakdown,
    };
  }

  /**
   * Execute CwdChanged hooks.
   */
  async executeCwdChangedHooks(
    oldCwd: string,
    newCwd: string,
    sessionId: string,
    transcriptPath: string,
    env: Record<string, string>,
  ): Promise<HookExecutionResult[]> {
    const context: ExtendedHookExecutionContext = {
      event: "CwdChanged",
      projectDir: this.workdir,
      timestamp: new Date(),
      sessionId,
      transcriptPath,
      cwd: newCwd,
      oldCwd,
      newCwd,
      env,
    };
    const results = await this.executeHooks("CwdChanged", context);
    if (results.length > 0) {
      // For CwdChanged hooks, we don't block, just log errors
      this.processHookResults("CwdChanged", results);
    }
    return results;
  }

  /**
   * Register hooks provided by a plugin
   */
  registerPluginHooks(
    pluginRoot: string,
    hooks: PartialHookConfiguration,
  ): void {
    // Stamp pluginRoot on each hook command
    const stampedHooks: PartialHookConfiguration = {};
    for (const [event, configs] of Object.entries(hooks)) {
      if (!isValidHookEvent(event)) continue;
      stampedHooks[event] = configs.map((config) => ({
        ...config,
        hooks: config.hooks.map((cmd) => ({ ...cmd, pluginRoot })),
      }));
    }

    // Replace (not append) the previous registration for this root, so
    // re-registering the same plugin never doubles its hooks.
    this.pluginHooks.set(pluginRoot, stampedHooks);
    this.rebuildConfiguration();
  }

  /**
   * Drop every hook contributed by a plugin, addressed by its root path.
   * Used by the in-place plugin reload path (before re-registering) and when a
   * plugin is disabled or uninstalled.
   * @returns true if this root had hooks registered
   */
  unregisterPluginHooks(pluginRoot: string): boolean {
    const removed = this.pluginHooks.delete(pluginRoot);
    if (removed) {
      this.rebuildConfiguration();
    }
    return removed;
  }

  /**
   * Get hooks registered by plugins (read-only view for the settings UI).
   * Plugin hooks carry pluginRoot on each command and are read-only in the UI.
   */
  getPluginHooks(): PartialHookConfiguration {
    const merged: PartialHookConfiguration = {};
    for (const hooks of this.pluginHooks.values()) {
      this.mergeHooksConfiguration(merged, hooks);
    }
    return merged;
  }

  /**
   * Register the hooks a skill declared in its `SKILL.md` frontmatter.
   *
   * Session-scoped and idempotent, exactly like `registerPluginHooks`: the
   * registration is keyed by `skillRoot` and replaces the previous one, so
   * calling the same skill twice in one session leaves one copy of its hooks
   * (spec `automation/skill-hooks` 故事②场景 2).
   *
   * A source over {@link HOOK_SOURCE_LIMITS} registers nothing at all — not even
   * the part that fits — and drops whatever it had registered before: a skill
   * that grew past the budget while a session is running must not keep an older,
   * smaller set alive, since the author would see interception that no longer
   * matches the file on disk (故事④).
   *
   * @returns the declared volume alongside `registered`, so the caller can tell
   *   the model *why* a skill's hooks are missing instead of guessing.
   */
  registerSkillHooks(
    skillRoot: string,
    skillName: string,
    hooks: PartialHookConfiguration,
  ): { registered: boolean; hookCount: number; matcherChars: number } {
    // Measured on what the skill declared, before the event-name filter below:
    // the budget exists to stop one source from flooding every tool call, and
    // an event we happen to reject does not make the declaration smaller.
    let hookCount = 0;
    let matcherChars = 0;
    for (const configs of Object.values(hooks)) {
      for (const config of configs) {
        hookCount += config.hooks.length;
        matcherChars += config.matcher?.length ?? 0;
      }
    }

    if (
      hookCount > HOOK_SOURCE_LIMITS.maxHooks ||
      matcherChars > HOOK_SOURCE_LIMITS.maxMatcherChars
    ) {
      this.skillHooks.delete(skillRoot);
      this.rebuildConfiguration();
      return { registered: false, hookCount, matcherChars };
    }

    // Stamp the origin on each command: it is what execution uses for
    // ${WAVE_SKILL_DIR} and what a permission card or failure log shows as
    // `skill:<name>`.
    const stampedHooks: PartialHookConfiguration = {};
    for (const [event, configs] of Object.entries(hooks)) {
      if (!isValidHookEvent(event)) continue;
      stampedHooks[event] = configs.map((config) => ({
        ...config,
        hooks: config.hooks.map((cmd) => ({ ...cmd, skillRoot, skillName })),
      }));
    }

    // Replace (not append), so re-registering the same skill never doubles its
    // hooks — the hot-reload path re-registers on every reshape.
    this.skillHooks.set(skillRoot, stampedHooks);
    this.rebuildConfiguration();
    return { registered: true, hookCount, matcherChars };
  }

  /**
   * Drop every hook contributed by a skill, addressed by its directory path.
   * Used when a skill is removed or reshaped into one without hooks.
   * @returns true if this skill had hooks registered
   */
  unregisterSkillHooks(skillRoot: string): boolean {
    const removed = this.skillHooks.delete(skillRoot);
    if (removed) {
      this.rebuildConfiguration();
    }
    return removed;
  }

  /**
   * Skill directories with a live registration — the hot-update path rebuilds
   * exactly these.
   */
  getRegisteredSkillRoots(): string[] {
    return [...this.skillHooks.keys()];
  }

  /**
   * Get hooks registered by skills (read-only view for tests and the UI).
   * Skill hooks carry skillRoot / skillName on each command.
   */
  getSkillHooks(): PartialHookConfiguration {
    const merged: PartialHookConfiguration = {};
    for (const hooks of this.skillHooks.values()) {
      this.mergeHooksConfiguration(merged, hooks);
    }
    return merged;
  }

  /**
   * Retire a `once` command from the source that owns it.
   *
   * Lookup is by object reference (`===`) and that is sound because
   * `rebuildConfiguration()` reuses every object it collects: merging only
   * concatenates the per-event config arrays and clones neither the config nor
   * the command, so the command the executor just ran *is* the object sitting in
   * its source. Anything looser — command text, matcher — would also hit a
   * second source holding an identical hook, and cross-source hooks must not
   * touch each other (故事③场景 1).
   */
  private removeExecutedOnceHook(hookCommand: HookCommand): boolean {
    let removed = HookManager.removeCommandFromSource(
      this.programmaticHooks,
      hookCommand,
    );

    for (const [root, hooks] of this.pluginHooks) {
      if (HookManager.removeCommandFromSource(hooks, hookCommand)) {
        removed = true;
        // An empty registration keeps showing up in the source map; drop it so
        // introspection reflects "this plugin contributes nothing".
        if (Object.keys(hooks).length === 0) this.pluginHooks.delete(root);
      }
    }

    if (
      HookManager.removeCommandFromSource(this.waveConfigHooks, hookCommand)
    ) {
      removed = true;
    }

    for (const [skillRoot, hooks] of this.skillHooks) {
      if (HookManager.removeCommandFromSource(hooks, hookCommand)) {
        removed = true;
        if (Object.keys(hooks).length === 0) this.skillHooks.delete(skillRoot);
      }
    }

    if (removed) {
      this.rebuildConfiguration();
    }
    return removed;
  }

  /**
   * Remove one command (in place) from a single source's registration, then
   * clear the containers it leaves empty: the config when it has no commands
   * left, the event when it has no configs left.
   * @returns true when the command was found in this source
   */
  private static removeCommandFromSource(
    source: PartialHookConfiguration,
    hookCommand: HookCommand,
  ): boolean {
    for (const [event, configs] of Object.entries(source)) {
      if (!isValidHookEvent(event)) continue;

      for (
        let configIndex = configs.length - 1;
        configIndex >= 0;
        configIndex--
      ) {
        const config = configs[configIndex];
        const hookIndex = config.hooks.indexOf(hookCommand);
        if (hookIndex === -1) continue;

        config.hooks.splice(hookIndex, 1);
        if (config.hooks.length === 0) {
          configs.splice(configIndex, 1);
        }
        if (configs.length === 0) {
          delete source[event];
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Execute SessionStart hooks during initialization.
   * Collects additionalContext and initialUserMessage from hook stdout.
   *
   * @param messageManager Where a failing hook's report goes. Without it the
   *   hook still runs, it just has nowhere to complain to.
   * @param agentType Set when the firing agent is a subagent (compact path).
   */
  async executeSessionStartHooks(
    source: SessionStartSource,
    sessionId: string,
    transcriptPath: string,
    messageManager?: MessageManager,
    agentType?: string,
  ): Promise<{
    results: HookExecutionResult[];
    additionalContext?: string;
    initialUserMessage?: string;
  }> {
    const context: ExtendedHookExecutionContext = {
      event: "SessionStart",
      projectDir: this.workdir,
      timestamp: new Date(),
      sessionId,
      transcriptPath,
      cwd: this.workdir,
      source,
      agentType,
      env: Object.fromEntries(
        Object.entries(this.sessionEnv).filter((e) => e[1] !== undefined),
      ) as Record<string, string>,
    };

    const results = await this.executeHooks("SessionStart", context);

    if (messageManager) {
      this.reportSessionStartFailures(results, messageManager);
    }

    let additionalContext: string | undefined;
    let initialUserMessage: string | undefined;

    for (const result of results) {
      if (!result.success || !result.stdout?.trim()) continue;

      const trimmed = result.stdout.trim();
      const parsed = this.parseStdoutJson(result);

      if (!parsed) {
        if (!trimmed.startsWith("{")) {
          // Not structured output at all: on SessionStart the whole stdout is
          // context (spec `automation/session-hooks`).
          additionalContext = appendHookText(additionalContext, trimmed);
          continue;
        }
        // Shaped like structured output but is not JSON — a broken hook rather
        // than context, so the blob is reported instead of fed to the model.
        if (messageManager) {
          this.handleNonBlockingError(
            {
              ...result,
              stderr: `SessionStart hook printed malformed JSON: ${trimmed.slice(0, 200)}`,
            },
            messageManager,
          );
        }
        continue;
      }

      const hookSpecificOutput = parsed.hookSpecificOutput;
      if (
        typeof hookSpecificOutput === "object" &&
        hookSpecificOutput !== null
      ) {
        const output = hookSpecificOutput as Record<string, unknown>;

        const contextText = output.additionalContext;
        if (typeof contextText === "string" && contextText.trim()) {
          additionalContext = appendHookText(additionalContext, contextText);
        }

        // Claude Code reads `initialUserMessage` from *inside*
        // `hookSpecificOutput` (2.1.326: `oe.initialUserMessage =
        // _e.hookSpecificOutput.initialUserMessage`); reading only the top level
        // silently dropped every hook written against the documented contract.
        if (
          typeof output.initialUserMessage === "string" &&
          output.initialUserMessage.trim()
        ) {
          initialUserMessage = output.initialUserMessage;
        }
      }

      // Tolerated fallback, NOT a Claude Code contract: the top-level position
      // our own settings skill documented before this alignment. Kept so hooks
      // written against it keep working; the inner position wins when both are
      // present.
      if (
        initialUserMessage === undefined &&
        typeof parsed.initialUserMessage === "string" &&
        parsed.initialUserMessage.trim()
      ) {
        initialUserMessage = parsed.initialUserMessage;
      }
    }

    return { results, additionalContext, initialUserMessage };
  }

  /**
   * Make a broken `SessionStart` hook visible.
   *
   * This is the one event that never goes through `processHookResults`, so a
   * failing hook used to vanish without a trace: the collection loop only reads
   * `success` results, which drops exit-2 stdout along with every stderr, and
   * the user is left with "my hook did not work" and nothing to go on. Running
   * the results through the shared handler gives a failure the same presentation
   * every other event has — one `error` notice block — while startup stays
   * unblocked (`handleBlockingError`'s `SessionStart` branch returns
   * `shouldBlock: false`). `systemMessage` rides along on the same pass.
   */
  private reportSessionStartFailures(
    results: HookExecutionResult[],
    messageManager: MessageManager,
  ): void {
    if (results.length === 0) return;

    this.processHookResults("SessionStart", results, messageManager);

    // The handler cannot see a timeout: the child is killed and `close` still
    // reports exit code 0, which reads as a success there.
    for (const result of results) {
      if (result.success || result.exitCode !== 0) continue;
      this.handleNonBlockingError(
        {
          ...result,
          stderr: result.stderr?.trim() || "SessionStart hook timed out",
        },
        messageManager,
      );
    }
  }

  /**
   * Execute SessionEnd hooks during agent destruction.
   * Non-blocking: always continues shutdown even if hooks fail.
   * No stdout processing needed (SessionEnd hooks are fire-and-forget cleanup).
   */
  async executeSessionEndHooks(
    source: SessionEndSource,
    sessionId: string,
    transcriptPath: string,
  ): Promise<HookExecutionResult[]> {
    const context: ExtendedHookExecutionContext = {
      event: "SessionEnd",
      projectDir: this.workdir,
      timestamp: new Date(),
      sessionId,
      transcriptPath,
      cwd: this.workdir,
      endSource: source,
      env: Object.fromEntries(
        Object.entries(this.sessionEnv).filter((e) => e[1] !== undefined),
      ) as Record<string, string>,
    };

    const results = await this.executeHooks("SessionEnd", context);

    // Process results but never block shutdown
    if (results.length > 0) {
      this.processHookResults("SessionEnd", results);
    }

    return results;
  }

  /**
   * Execute PreCompact hooks before compaction.
   * Returns custom instructions from hook stdout.
   */
  async executePreCompactHooks(
    sessionId: string,
    transcriptPath: string,
    customInstructions?: string,
  ): Promise<{
    results: HookExecutionResult[];
    additionalInstructions?: string;
  }> {
    const context: ExtendedHookExecutionContext = {
      event: "PreCompact",
      projectDir: this.workdir,
      timestamp: new Date(),
      sessionId,
      transcriptPath,
      cwd: this.workdir,
      compactInstructions: customInstructions,
      env: Object.fromEntries(
        Object.entries(this.sessionEnv).filter((e) => e[1] !== undefined),
      ) as Record<string, string>,
    };

    const results = await this.executeHooks("PreCompact", context);

    let additionalInstructions: string | undefined;
    for (const result of results) {
      if (result.success && result.stdout?.trim()) {
        const trimmed = result.stdout.trim();
        additionalInstructions = additionalInstructions
          ? additionalInstructions + "\n" + trimmed
          : trimmed;
      }
    }

    return { results, additionalInstructions };
  }

  /**
   * Execute PostCompact hooks after compaction.
   * Receives the compact summary text.
   */
  async executePostCompactHooks(
    sessionId: string,
    transcriptPath: string,
    compactSummary: string,
  ): Promise<HookExecutionResult[]> {
    const context: ExtendedHookExecutionContext = {
      event: "PostCompact",
      projectDir: this.workdir,
      timestamp: new Date(),
      sessionId,
      transcriptPath,
      cwd: this.workdir,
      compactSummary,
      env: Object.fromEntries(
        Object.entries(this.sessionEnv).filter((e) => e[1] !== undefined),
      ) as Record<string, string>,
    };

    const results = await this.executeHooks("PostCompact", context);
    if (results.length > 0) {
      this.processHookResults("PostCompact", results);
    }
    return results;
  }
}
