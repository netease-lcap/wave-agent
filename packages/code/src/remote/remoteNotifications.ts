/**
 * The single table of notification **shapes**, shared by the two serving paths.
 *
 * `AgentBridge` (a daemon or a GUI-spawned `--stdio` child) puts the agent's
 * callbacks straight onto the wire; the foreground TUI has no notification
 * fan-out at all (`useRemoteControl` supplies it from its own React state). They
 * are two different hosts — one has a session registry, the other a component
 * tree — so each still decides *which* callbacks it emits. What must not exist in
 * two copies is the **contract**: a method name and the fields of its payload.
 * Both hosts build every frame they share from `remoteWire` below, so a payload
 * change lands once and the phone cannot tell which process served it (spec:
 * remote-control「前台 CLI 会话也能被手机接管」场景 10/11).
 *
 * What is deliberately *not* here: the families only a bridge emits (session
 * registry reads, `tasksChange`, `queuedMessagesChange`, `commandRunningChange`,
 * the compaction / plan / mcp changes). Nothing mirrors those, so there is no
 * shape to keep in sync — and the foreground host is not required to invent one:
 * the page reads that state off `getSessionInfo` on its alignment paths (spec
 * 同故事场景 11).
 */

import type {
  AgentCallbacks,
  BackgroundTask,
  BackgroundTaskSummary,
  PermissionMode,
  ToolBlockUpdateCallbackParams,
  ToolPermissionContext,
} from "wave-agent-sdk";
import { toolBlockUpdateForUi } from "../stdio/uiPayload.js";

/**
 * A content delta exactly as the SDK callback hands it over — derived rather
 * than re-declared, so a field added there cannot leave this table describing a
 * shape the agent does not produce.
 */
type StreamDelta = Parameters<
  NonNullable<AgentCallbacks["onAssistantContentUpdated"]>
>[0];

/**
 * Context-window usage as the percentage the ring renders — one rule for every
 * producer (the bridge's change push and its `getMessages` read, the CLI host's
 * push and its `getSessionInfo` read). 0 when the cap is unknown, so a caller
 * that has one reads a number rather than a special case.
 */
export function percentOf(tokens: number, maxInputTokens: number): number {
  if (!maxInputTokens || maxInputTokens <= 0) return 0;
  return Math.min(100, Math.round((tokens / maxInputTokens) * 100));
}

/** The shapes both hosts put on the wire, keyed by the method they ride under. */
export const remoteWire = {
  /**
   * A pure-delta frame carries the delta and nothing else — no accumulated value,
   * so a notification's size is independent of how long the stream has been
   * running (spec: stdio-transport「流式通知纯增量负载」). Explicit pick rather than
   * a spread, so a field added to the SDK callback does not silently join the wire.
   */
  assistantContentUpdated: (params: StreamDelta) => ({
    messageId: params.messageId,
    chunk: params.chunk,
    stage: params.stage,
  }),

  assistantReasoningUpdated: (params: StreamDelta) => ({
    messageId: params.messageId,
    chunk: params.chunk,
    stage: params.stage,
  }),

  /**
   * `streaming` frames carry only the delta (`parametersChunk`), while `start` /
   * `running` (one-time snapshots) and `end` (the authoritative full value) keep
   * `parameters`. The coalescer's merge rule is keyed on exactly this shape, so
   * this pick is what makes the 150 ms window behave the same in both hosts.
   *
   * `images` is cut on every stage: tool pictures are base64 that no UI renders
   * (specs/ui/stdio-transport.md「工具图片的字节不下发 UI」), and one of them can
   * be larger than a remote frame may be.
   */
  toolBlockUpdated: (params: ToolBlockUpdateCallbackParams) => {
    const trimmed = toolBlockUpdateForUi(params);
    if (trimmed.stage !== "streaming") return trimmed;
    const { parameters, ...rest } = trimmed;
    void parameters;
    return rest;
  },

  errorBlockAdded: (error: string) => ({ error }),

  loadingChange: (loading: boolean, latestTotalTokens?: number) => ({
    loading,
    ...(latestTotalTokens === undefined ? {} : { latestTotalTokens }),
  }),

  contextUsage: (latestTotalTokens: number, maxInputTokens: number) => ({
    percent: percentOf(latestTotalTokens, maxInputTokens),
  }),

  permissionModeChange: (mode: PermissionMode) => ({ mode }),

  permissionRequest: (requestId: string, context: ToolPermissionContext) => ({
    requestId,
    context,
  }),

  /**
   * `messagesChange` has exactly one shape now — content-free, on **every** path
   * (spec「messagesChange 只有一种形态」): the bridge's re-attach push, the
   * foreground CLI's structural notice and the relay's fan-out all carry `{}`.
   * The phone answers it with `getMessages({ since })`; no producer attaches the
   * list.
   */
  messagesChangeSignal: () => ({}),
} as const;

/** The methods this table defines — the only ones a mirroring host may send. */
export type RemoteMethod = keyof typeof remoteWire;

/**
 * A background task (shell / subagent / workflow) as it may travel: the
 * serializable half of `BackgroundTask`.
 *
 * A shape, hence this table's business — the two hosts each own the *list* (the
 * bridge reads it off the agent on every snapshot, the foreground TUI off its own
 * state) and both have to describe a task the same way, or the `/tasks` dialog
 * renders two different things depending on which process served the page. The
 * fields dropped here are the reasons it exists: `process` (a `ChildProcess`) and
 * `onStop` (a function) cannot go over a relay, and the full `stdout`/`stderr` are
 * fetched per task instead (`getBackgroundTaskOutput`).
 */
export function toBackgroundTaskSummaries(
  tasks: BackgroundTask[],
): BackgroundTaskSummary[] {
  return tasks.map((task) => ({
    id: task.id,
    type: task.type,
    status: task.status,
    startTime: task.startTime,
    endTime: task.endTime,
    command: task.command,
    description: task.description,
    exitCode: task.exitCode,
    runtime: task.runtime,
    outputPath: task.outputPath,
  }));
}

/**
 * What `RemoteControlSink.sendNotification` expects of a frame, minus the
 * session it belongs to (the sink already knows). The method is narrowed to the
 * table's keys so a caller cannot mirror a family that has no agreed shape.
 */
export type RemoteNotify = (method: RemoteMethod, params: unknown) => void;

/**
 * The callbacks whose **payload** a foreground host has to mirror, mapped onto
 * the remote path under the bridge's method names.
 *
 * One rule decides membership: **can a pull get the change back?** A streaming
 * delta grows a reply the phone is already holding, and an error block is
 * appended *inside* the last message — in both cases the `since` anchor is that
 * very message, so a signal would be a round trip that returns nothing and the
 * change would never reach the phone (spec remote-control「前台 CLI 会话也能被手机
 * 接管」场景 10/11). Structural changes (the list's id composition) and the state
 * the page reads off `getSessionInfo` travel on the hook's own signals instead.
 */
export function remoteNotifications(
  notify: RemoteNotify,
): Required<
  Pick<
    AgentCallbacks,
    | "onAssistantContentUpdated"
    | "onAssistantReasoningUpdated"
    | "onToolBlockUpdated"
    | "onErrorBlockAdded"
  >
> {
  return {
    onAssistantContentUpdated: (params) => {
      notify(
        "assistantContentUpdated",
        remoteWire.assistantContentUpdated(params),
      );
    },
    onAssistantReasoningUpdated: (params) => {
      notify(
        "assistantReasoningUpdated",
        remoteWire.assistantReasoningUpdated(params),
      );
    },
    onToolBlockUpdated: (params) => {
      notify("toolBlockUpdated", remoteWire.toolBlockUpdated(params));
    },
    onErrorBlockAdded: (error: string) => {
      notify("errorBlockAdded", remoteWire.errorBlockAdded(error));
    },
  };
}
