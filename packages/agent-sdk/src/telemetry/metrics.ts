/**
 * OpenTelemetry Metrics
 *
 * The operational metric families (see docs/specs/enterprise/opentelemetry.md):
 * token usage, session count, lines changed, the creation actions (commits,
 * pull requests), active time and the edit-tool permission decisions.
 * Instruments are created once per initialized MeterProvider by
 * `initMetrics()`; until then — and after `resetMetrics()` — every record call
 * is a no-op, so callers never have to check whether telemetry is on.
 *
 * Attributes stay low-cardinality on purpose: the model id, the token kind and
 * the line direction, plus the standard surface every record shares (the
 * session, the identity of the user, the deployment's resource attributes and —
 * opt-in — the repository). No prompts, no file paths, no content of any kind.
 */

import type { Attributes, Counter, Meter } from "@opentelemetry/api";
import { standardAttributes } from "./attributes.js";
import type { ToolActivity } from "./toolActivity.js";
import type { HostEntrypoint } from "../constants/telemetry.js";
import type { PermissionDecisionSource } from "../types/permissions.js";
import { EDIT_TOOL_NAME, WRITE_TOOL_NAME } from "../constants/tools.js";

/** Which side of the session the active time was spent on. */
export type ActiveTimeType = "user" | "cli";

/** One edit-tool permission decision, as recorded by the metrics family. */
export interface CodeEditToolDecisionRecord {
  /** Whether the tool was allowed to run */
  decision: "accept" | "reject";
  /** Where the decision came from */
  source: PermissionDecisionSource;
  /** `Edit` or `Write` */
  toolName: string;
  /** Language of the target file, when it can be named (see `language.ts`) */
  language?: string;
}

/**
 * Tools whose permission decisions are counted — Claude Code's
 * `CODE_EDITING_TOOLS`. Wave has no notebook tool, so the set is Edit + Write;
 * both funnel their decision through `PermissionManager.checkPermission`.
 */
const CODE_EDITING_TOOLS: readonly string[] = [EDIT_TOOL_NAME, WRITE_TOOL_NAME];

/** Whether a tool's permission decision belongs to `wave.code_edit_tool.decision`. */
export function isCodeEditingTool(toolName: string): boolean {
  return CODE_EDITING_TOOLS.includes(toolName);
}

/** One LLM response's token usage, as recorded by the metrics family. */
export interface TokenUsageRecord {
  /** Model id the request went to (low-cardinality attribute) */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** What the caller knows about the record it is about to make. */
export interface RecordContext {
  /** Session the record belongs to → `session.id` */
  sessionId?: string;
  /** Session working directory — used only to derive `vcs.repository.*` */
  workdir?: string;
  /** Host entrypoint that created the session → `app.entrypoint` */
  entrypoint?: HostEntrypoint;
}

/**
 * Attribute policy, resolved once from the telemetry config at init time.
 *
 * `session.id` is a per-record attribute rather than a resource one: one
 * process hosts several sessions (the daemon), so it cannot be resolved once
 * for the provider. `app.entrypoint` rides along for the same reason — the same
 * daemon hosts sessions created from different front ends.
 */
export interface MetricAttributePolicy {
  /** Attach `session.id` to every data point */
  includeSessionId: boolean;
  /** Resolve `vcs.repository.*` (opt-in) */
  includeRepository: boolean;
  /** Attach `app.entrypoint` to every data point (opt-in) */
  includeEntrypoint: boolean;
  /** `OTEL_RESOURCE_ATTRIBUTES` keys projected onto every data point */
  resourceAttributes: Attributes;
}

let tokens: Counter | undefined;
let sessions: Counter | undefined;
let linesChanged: Counter | undefined;
let commits: Counter | undefined;
let pullRequests: Counter | undefined;
let activeTime: Counter | undefined;
let codeEditDecisions: Counter | undefined;

/** Whether the instruments above are live (the policy only matters then). */
let active = false;

let policy: MetricAttributePolicy = {
  includeSessionId: false,
  includeRepository: false,
  includeEntrypoint: false,
  resourceAttributes: {},
};

/**
 * Create the instruments on the given meter. Called by `initializeTelemetry()`
 * once the MeterProvider exists; a second call (after a shutdown/restart)
 * simply re-creates them on the fresh meter.
 */
export function initMetrics(
  meter: Meter,
  attributePolicy?: MetricAttributePolicy,
): void {
  policy = attributePolicy ?? policy;
  active = true;
  tokens = meter.createCounter("wave.tokens", {
    description: "Tokens consumed, by model and kind",
    unit: "{token}",
  });
  sessions = meter.createCounter("wave.sessions", {
    description: "Agent sessions started",
    unit: "{session}",
  });
  linesChanged = meter.createCounter("wave.lines.changed", {
    description: "Lines added or removed by edit tools",
    unit: "{line}",
  });
  commits = meter.createCounter("wave.commits", {
    description: "Commits created through a tool",
    unit: "{commit}",
  });
  pullRequests = meter.createCounter("wave.pull_requests", {
    description: "Pull requests or merge requests created through a tool",
    unit: "{pull_request}",
  });
  activeTime = meter.createCounter("wave.active_time", {
    description:
      "Active time, by type: the user at the prompt, or the agent working",
    unit: "s",
  });
  codeEditDecisions = meter.createCounter("wave.code_edit_tool.decision", {
    description:
      "Permission decisions on Edit and Write, accepted or rejected, by source",
  });
}

/** Drop the instruments: telemetry was shut down, later records must no-op. */
export function resetMetrics(): void {
  tokens = undefined;
  sessions = undefined;
  linesChanged = undefined;
  commits = undefined;
  pullRequests = undefined;
  activeTime = undefined;
  codeEditDecisions = undefined;
  active = false;
}

/**
 * The standard attributes of one data point: the identity of the user, the
 * session it belongs to and anything the deployment declared as a resource
 * attribute.
 *
 * Resolves to nothing when no instrument is live — a record made while
 * telemetry is off must not pay for a session lookup or a `git` call.
 */
function attributesWithContext(context?: RecordContext): Attributes {
  if (!active) return {};

  return {
    ...policy.resourceAttributes,
    ...standardAttributes({
      sessionId: policy.includeSessionId ? context?.sessionId : undefined,
      workdir: context?.workdir,
      includeRepository: policy.includeRepository,
      entrypoint: policy.includeEntrypoint ? context?.entrypoint : undefined,
    }),
  };
}

/**
 * Record the token kinds one LLM response consumed, by model. Called from the
 * success path only — a failed request brought back no usage to attribute.
 */
export function recordTokenUsage(
  record: TokenUsageRecord,
  context?: RecordContext,
): void {
  const base = attributesWithContext(context);
  const kinds: Array<[string, number | undefined]> = [
    ["input", record.inputTokens],
    ["output", record.outputTokens],
    ["cache_read", record.cacheReadTokens],
    ["cache_creation", record.cacheCreationTokens],
  ];
  for (const [type, value] of kinds) {
    if (value != null) {
      tokens?.add(value, { ...base, model: record.model, type });
    }
  }
}

/** Record a started session. */
export function recordSession(context?: RecordContext): void {
  sessions?.add(1, attributesWithContext(context));
}

/**
 * Record the creation actions a tool call performed — today the commit and
 * PR/MR counters. A call that created neither records nothing, so the common
 * case costs one call and no instrument lookup.
 */
export function recordToolActivity(
  activity: ToolActivity,
  context?: RecordContext,
): void {
  if (activity.commits) {
    commits?.add(1, attributesWithContext(context));
  }
  if (activity.pullRequests) {
    pullRequests?.add(1, attributesWithContext(context));
  }
}

/**
 * Record lines added/removed by an edit tool. Zero/undefined sides are
 * skipped so a pure insertion and a pure deletion stay distinguishable.
 */
export function recordLinesChanged(
  changed: {
    added?: number;
    removed?: number;
  },
  context?: RecordContext,
): void {
  if (changed.added) {
    linesChanged?.add(changed.added, {
      ...attributesWithContext(context),
      direction: "added",
    });
  }
  if (changed.removed) {
    linesChanged?.add(changed.removed, {
      ...attributesWithContext(context),
      direction: "removed",
    });
  }
}

/**
 * Record a closed stretch of active time, in seconds.
 *
 * Each call carries a **length**, never a total or a "now minus something
 * started long ago" value: the caller closes an interval when it ends, so a
 * resident process (the daemon) does not turn this into uptime. Whether the
 * values read as deltas or as a running total is decided by the reader's
 * temporality, exactly like every other counter here.
 */
export function recordActiveTime(
  seconds: number,
  type: ActiveTimeType,
  context?: RecordContext,
): void {
  if (!(seconds > 0)) return;
  activeTime?.add(seconds, { ...attributesWithContext(context), type });
}

/**
 * Record one permission decision on an edit tool.
 *
 * Called once per decision — not per tool call — and for the two code-editing
 * tools only: a `Read` or `Bash` decision says nothing about how much friction
 * editing has. A rejected decision counts the same as an accepted one; the two
 * are told apart by the `decision` attribute.
 */
export function recordCodeEditDecision(
  record: CodeEditToolDecisionRecord,
  context?: RecordContext,
): void {
  if (!isCodeEditingTool(record.toolName)) return;

  const attributes: Attributes = {
    ...attributesWithContext(context),
    decision: record.decision,
    source: record.source,
    tool_name: record.toolName,
  };
  if (record.language) {
    attributes.language = record.language;
  }
  codeEditDecisions?.add(1, attributes);
}
