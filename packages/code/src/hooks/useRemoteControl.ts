/**
 * Wires the interactive CLI's own session to the remote-control relay.
 *
 * The daemon serves its sessions by fanning notifications into a
 * `RemoteControlSink`; the CLI has no notification fan-out at all — every
 * surface it has is React state. So this hook is the fan-out: each piece of
 * state the phone renders is watched here and pushed under the same method
 * names a `--stdio` / daemon process would use, which is what lets the page
 * treat the two hosts identically.
 *
 * Only the coarse signals are pushed (`messagesChange` as a content-free
 * signal, loading, permission mode, approvals). The page answers a signal by
 * pulling with `getMessages({ since })`, so no delta stream is needed to keep
 * it correct — the same bargain the daemon path makes for long sessions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Message,
  PermissionDecision,
  PermissionMode,
  RemoteControlSnapshot,
  RemoteControlStatus,
  SlashCommand,
  ToolPermissionContext,
} from "wave-agent-sdk";
import {
  RemoteControlCliHost,
  type RemoteControlCliSession,
} from "../remote/remoteControlCliHost.js";
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
  hasRunningBackgroundWork: boolean;
  hasPendingMessages: boolean;
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

  useEffect(() => {
    sink?.sendNotification("messagesChange", { messages }, sessionId);
  }, [sink, messages, sessionId]);

  useEffect(() => {
    sink?.sendNotification("loadingChange", { loading: isLoading }, sessionId);
  }, [sink, isLoading, sessionId]);

  useEffect(() => {
    sink?.sendNotification(
      "permissionModeChange",
      { mode: permissionMode },
      sessionId,
    );
  }, [sink, permissionMode, sessionId]);

  useEffect(() => {
    if (!sink || !sessionId) return;
    sink.sendNotification(
      "contextUsage",
      { percent: percentOf(latestTotalTokens, options.maxInputTokens) },
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
        { requestId: request.requestId, context: request.context },
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
  };
}

function percentOf(tokens: number, maxInputTokens: number): number {
  if (!maxInputTokens || maxInputTokens <= 0) return 0;
  return Math.min(100, Math.round((tokens / maxInputTokens) * 100));
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
    availableTools: () => latest.current.availableTools(),
    isLoading: () => latest.current.isLoading,
    hasRunningBackgroundWork: () => latest.current.hasRunningBackgroundWork,
    hasPendingMessages: () => latest.current.hasPendingMessages,
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
