/**
 * Wires the interactive CLI's own session to the remote-control relay.
 *
 * The daemon serves its sessions by fanning notifications into a
 * `RemoteControlSink`; the CLI has no notification fan-out at all — every
 * surface it has is React state. So this hook supplies that fan-out, under the
 * same method names and payloads a `--stdio` / daemon process uses, which is what
 * lets the page treat the two hosts identically — including the remote channel's
 * 150 ms merge window, which only bites if the frames it merges are the same
 * ones.
 *
 * Two halves, and both have to be the same shape as the bridge's:
 *
 * - the callbacks that carry content, which the front end hands over from its own
 *   agent callbacks (`remoteNotifications` → `notify`);
 * - the coarse state this hook watches itself (`messagesChange` as a content-free
 *   structural signal, loading, permission mode, context usage, approvals). The
 *   page answers a signal by pulling with `getMessages({ since })`, so no payload
 *   ever rides the signal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BackgroundTask,
  Message,
  PermissionDecision,
  PermissionMode,
  QueuedMessage,
  RemoteControlSnapshot,
  RemoteControlStatus,
  SlashCommand,
  Task,
  ToolPermissionContext,
} from "wave-agent-sdk";
import {
  RemoteControlCliHost,
  type RemoteControlCliSession,
} from "../remote/remoteControlCliHost.js";
import {
  percentOf,
  remoteWire,
  toBackgroundTaskSummaries,
} from "../remote/remoteNotifications.js";
import type { RemoteNotify } from "../remote/remoteNotifications.js";
import { createRemoteControlSinkFactory } from "../remote/remoteControlSink.js";
import type { RemoteControlSink } from "../remote/remoteControlSink.js";

export interface UseRemoteControlOptions {
  workdir: string;
  sessionId: string;
  messages: Message[];
  isLoading: boolean;
  permissionMode: PermissionMode;
  latestTotalTokens: number;
  maxInputTokens: number;
  /**
   * The title `/rename` sets, read live off the agent — the page's session list
   * labels the row with it (and the page itself may be the one that renamed it).
   */
  customTitle: () => string | undefined;
  hasRunningBackgroundWork: boolean;
  hasPendingMessages: boolean;
  /**
   * The session-state family the page re-reads off `getSessionInfo` (spec
   * remote-control「Web 页作为第五种宿主」场景 26) — current values, so the
   * long-lived host answers reads even though the session underneath it is
   * replaced.
   */
  tasks: Task[];
  /** Background tasks as the TUI holds them — read off `getSessionInfo`. */
  backgroundTasks: BackgroundTask[];
  isCompacting: boolean;
  isCommandRunning: boolean;
  queuedMessages: QueuedMessage[];
  /** Approvals waiting on the user right now. */
  pending: Array<{ requestId: string; context: ToolPermissionContext }>;
  availableTools: () => string[];
  sendMessage: (text: string, force?: boolean) => void | Promise<void>;
  abort: () => void;
  setPermissionMode: (mode: PermissionMode) => void;
  respondPermission: (requestId: string, decision: PermissionDecision) => void;
  /** Rename the conversation (the title `wave -r` lists). */
  renameSession: (title: string) => void | Promise<void>;
  /** Compact the conversation; errors must propagate (the page shows them). */
  compact: (customInstructions?: string) => void | Promise<void>;
  /** Slash commands the page may offer (SDK commands: skills / custom). */
  slashCommands: () => SlashCommand[];
}

export interface RemoteControlApi {
  /** The `enableRemoteControl` switch was on when this process started. */
  enabled: boolean;
  status: RemoteControlStatus;
  getSnapshot: () => RemoteControlSnapshot;
  /** Dials out. `name` labels this machine on the phone. */
  connect: (name?: string) => void;
  disconnect: () => void;
  /**
   * Send one notification to the phone under the method name a server host
   * (`AgentBridge`) would use for the same thing. The front end calls it from its
   * content-carrying agent callbacks (see `remoteNotifications`) — that is what
   * makes the two hosts' fan-out identical, and therefore what makes the remote
   * channel's merge window apply to this host too.
   */
  notify: RemoteNotify;
}

/** The GUI dialog polls once a second for the same reason: there is no push. */
const STATUS_POLL_MS = 1000;

export function useRemoteControl(
  options: UseRemoteControlOptions,
): RemoteControlApi {
  // Every getter below must read the *current* value: the host outlives any
  // single render, and the session underneath it is replaced on /resume.
  const latest = useRef(options);
  latest.current = options;

  const [sink] = useState<RemoteControlSink | undefined>(() => {
    // The switch is read once, here, exactly as a server process reads it once
    // at startup — hence "restart the CLI" in the failure hint.
    const factory = createRemoteControlSinkFactory(options.workdir);
    if (!factory) return undefined;
    return factory(new RemoteControlCliHost(adapterOf(latest)));
  });

  const [status, setStatus] = useState<RemoteControlStatus>(
    () => sink?.getSnapshot() ?? { state: "off" },
  );

  // ── Outbound: state changes the phone renders ─────────────────
  //
  // `sendNotification` drops everything while the link is down, which is what
  // we want: a phone that reconnects re-reads the tail anyway.
  const sessionId = options.sessionId;
  const { messages, isLoading, permissionMode, latestTotalTokens } = options;

  const notify = useCallback<RemoteNotify>(
    (method, params) => {
      sink?.sendNotification(method, params, latest.current.sessionId);
    },
    [sink],
  );

  // A structural notice, never a payload: the phone answers it by pulling the
  // tail with `getMessages({ since })`, the same path a cold start takes and the
  // only one that can carry a 13 MB list. What counts as "structurally changed"
  // is `useStructureKey`'s business below.
  const structureKey = useStructureKey(messages, sink !== undefined);
  useEffect(() => {
    sink?.sendNotification(
      "messagesChange",
      remoteWire.messagesChangeSignal(),
      sessionId,
    );
  }, [sink, structureKey, sessionId]);

  useEffect(() => {
    sink?.sendNotification(
      "loadingChange",
      remoteWire.loadingChange(isLoading),
      sessionId,
    );
  }, [sink, isLoading, sessionId]);

  useEffect(() => {
    sink?.sendNotification(
      "permissionModeChange",
      remoteWire.permissionModeChange(permissionMode),
      sessionId,
    );
  }, [sink, permissionMode, sessionId]);

  useEffect(() => {
    if (!sink || !sessionId) return;
    sink.sendNotification(
      "contextUsage",
      remoteWire.contextUsage(latestTotalTokens, options.maxInputTokens),
      sessionId,
    );
  }, [sink, sessionId, latestTotalTokens, options.maxInputTokens]);

  // Approvals are announced once, when they appear. The page answers with
  // `permissionResponse`, which the host routes back into the same promise the
  // terminal is waiting on — first answer wins, as the spec requires.
  const announced = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = latest.current.pending;
    if (!sink || pending.length === 0) return;
    for (const request of pending) {
      if (announced.current.has(request.requestId)) continue;
      announced.current.add(request.requestId);
      sink.sendNotification(
        "permissionRequest",
        remoteWire.permissionRequest(request.requestId, request.context),
        sessionId,
      );
    }
    const alive = new Set(pending.map((request) => request.requestId));
    for (const id of [...announced.current]) {
      if (!alive.has(id)) announced.current.delete(id);
    }
  }, [sink, options.pending, sessionId]);

  // ── Status the command view renders ───────────────────────────

  useEffect(() => {
    if (!sink) return;
    const timer = setInterval(() => {
      setStatus(sink.getSnapshot());
    }, STATUS_POLL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [sink]);

  const connect = useCallback(
    (name?: string) => {
      sink?.connect(name);
      setStatus(sink?.getSnapshot() ?? { state: "off" });
    },
    [sink],
  );

  const disconnect = useCallback(() => {
    sink?.disconnect();
    setStatus(sink?.getSnapshot() ?? { state: "off" });
  }, [sink]);

  const getSnapshot = useCallback(
    () => sink?.getSnapshot() ?? { state: "off" as const },
    [sink],
  );

  // The process is going away: drop the outbound connection rather than let
  // the relay keep a subscription for a session that no longer exists.
  useEffect(() => {
    return () => {
      sink?.stop();
    };
  }, [sink]);

  return {
    enabled: sink !== undefined,
    status,
    getSnapshot,
    connect,
    disconnect,
    notify,
  };
}

/**
 * The id composition of the display list, in order — what "the list changed"
 * means for the remote path — as a key that is stable while the composition is.
 *
 * Ids are stable across a streamed message's growth and across in-place edits of
 * its blocks, so comparing this key is what separates a structural change (a
 * message appeared, was discarded, or the list was truncated/replaced) from a
 * delta landing in a message the phone already has. Anchored on the ids rather
 * than on "the messages state changed" so no call site has to be trusted to
 * remember to announce a structural change — watching `messages` instead is what
 * turned every model chunk into a signal plus a phone round trip.
 *
 * This runs once per render, and a streamed reply renders once per chunk, so the
 * two shortcuts are the point: with no sink there is nobody to signal, and an
 * unchanged id list returns the previous key rather than building a new string.
 *
 * The trigger stops at the ids on purpose: `since` is an **exclusive** anchor, so
 * a signal can only ever deliver entries appended after the phone's own last
 * message — a change made *inside* that message needs a payload-carrying
 * notification of its own (see `remoteNotifications`).
 */
function useStructureKey(messages: Message[], enabled: boolean): string {
  const last = useRef<{ ids: string[]; key: string }>({ ids: [], key: "" });
  if (!enabled) return "";
  const previous = last.current;
  if (
    previous.ids.length === messages.length &&
    messages.every((message, index) => message.id === previous.ids[index])
  ) {
    return previous.key;
  }
  const ids = messages.map((message) => message.id);
  last.current = { ids, key: ids.join("\n") };
  return last.current.key;
}

/** The single-session adapter the host is built on. */
function adapterOf(latest: {
  current: UseRemoteControlOptions;
}): RemoteControlCliSession {
  return {
    sessionId: () => latest.current.sessionId,
    workdir: () => latest.current.workdir,
    displayMessages: () => latest.current.messages,
    contextUsagePercent: () =>
      percentOf(
        latest.current.latestTotalTokens,
        latest.current.maxInputTokens,
      ),
    latestTotalTokens: () => latest.current.latestTotalTokens,
    permissionMode: () => latest.current.permissionMode,
    customTitle: () => latest.current.customTitle(),
    availableTools: () => latest.current.availableTools(),
    isLoading: () => latest.current.isLoading,
    hasRunningBackgroundWork: () => latest.current.hasRunningBackgroundWork,
    hasPendingMessages: () => latest.current.hasPendingMessages,
    tasks: () => latest.current.tasks,
    backgroundTasks: () =>
      toBackgroundTaskSummaries(latest.current.backgroundTasks),
    isCompacting: () => latest.current.isCompacting,
    isCommandRunning: () => latest.current.isCommandRunning,
    queuedMessages: () => latest.current.queuedMessages,
    pendingPermissions: () => latest.current.pending,
    sendMessage: (text, force) => latest.current.sendMessage(text, force),
    abort: () => latest.current.abort(),
    setPermissionMode: (mode) => latest.current.setPermissionMode(mode),
    respondPermission: (requestId, decision) =>
      latest.current.respondPermission(requestId, decision),
    renameSession: (title) => latest.current.renameSession(title),
    compact: (customInstructions) => latest.current.compact(customInstructions),
    slashCommands: () => latest.current.slashCommands(),
  };
}
