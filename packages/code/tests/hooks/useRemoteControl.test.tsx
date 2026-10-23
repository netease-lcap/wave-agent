import { render } from "../helpers/inkHarness.js";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message } from "wave-agent-sdk";
import {
  useRemoteControl,
  type RemoteControlApi,
  type UseRemoteControlOptions,
} from "../../src/hooks/useRemoteControl.js";

/**
 * The hook owns the outbound connection, so every case here is about *what it
 * chooses to push*: the streaming deltas (handed over by the front end through
 * `notify`) and the structural signal. The relay side of the contract — the
 * 150 ms window those deltas land in — is driven in
 * `tests/remote/notificationCoalescer.test.ts`; the wire shapes in
 * `tests/remote/remoteNotifications.test.ts`.
 */
const h = vi.hoisted(() => ({
  notifications: [] as Array<{
    method: string;
    params: unknown;
    sessionId?: string;
  }>,
}));

vi.mock("../../src/remote/remoteControlSink.js", () => ({
  createRemoteControlSinkFactory: () => () => ({
    sendNotification: (method: string, params: unknown, sessionId?: string) => {
      h.notifications.push({ method, params, sessionId });
    },
    getSnapshot: () => ({ state: "off" }),
    connect: () => {},
    disconnect: () => {},
    stop: () => {},
  }),
}));

function message(id: string, content: string): Message {
  return {
    id,
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [{ type: "text", content, stage: "streaming" }],
  } as unknown as Message;
}

const baseOptions: Omit<UseRemoteControlOptions, "messages"> = {
  workdir: "/repo",
  sessionCwd: () => "/repo",
  sessionId: "s1",
  isLoading: false,
  permissionMode: "default",
  latestTotalTokens: 0,
  maxInputTokens: 100_000,
  customTitle: () => undefined,
  hasRunningBackgroundWork: false,
  hasPendingMessages: false,
  tasks: [],
  backgroundTasks: [],
  isCompacting: false,
  isCommandRunning: false,
  queuedMessages: [],
  pending: [],
  availableTools: () => [],
  sendMessage: vi.fn(),
  abort: vi.fn(),
  setPermissionMode: vi.fn(),
  respondPermission: vi.fn(),
  renameSession: vi.fn(),
  compact: vi.fn(),
  slashCommands: () => [],
};

function Harness({
  messages,
  onApi,
}: {
  messages: Message[];
  onApi: (api: RemoteControlApi) => void;
}) {
  const api = useRemoteControl({ ...baseOptions, messages });
  useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

function signals() {
  return h.notifications.filter((n) => n.method === "messagesChange");
}

describe("useRemoteControl outbound shape", () => {
  let api: RemoteControlApi | undefined;

  beforeEach(() => {
    h.notifications.length = 0;
    api = undefined;
  });

  it("should announce the list once per structural change, not per content change", () => {
    const { rerender } = render(
      <Harness messages={[message("m1", "He")]} onApi={(a) => (api = a)} />,
    );
    expect(signals()).toHaveLength(1);

    // The stream grows the message body: same ids, so nothing structural
    // happened and the phone hears nothing — this frame travels as a delta.
    rerender(
      <Harness messages={[message("m1", "Hello")]} onApi={(a) => (api = a)} />,
    );
    expect(signals()).toHaveLength(1);

    // A message appears (or is discarded): that is the structural change the
    // signal is for.
    rerender(
      <Harness
        messages={[message("m1", "Hello"), message("m2", "hi")]}
        onApi={(a) => (api = a)}
      />,
    );
    expect(signals()).toHaveLength(2);
  });

  it("should carry no content on the structural signal", () => {
    render(
      <Harness messages={[message("m1", "Hello")]} onApi={(a) => (api = a)} />,
    );

    expect(signals()[0]).toEqual({
      method: "messagesChange",
      params: {},
      sessionId: "s1",
    });
  });

  it("should hand the notifier to the streaming callbacks with the live session", () => {
    render(<Harness messages={[]} onApi={(a) => (api = a)} />);

    api?.notify("assistantContentUpdated", {
      messageId: "m1",
      chunk: "he",
      stage: "streaming",
    });

    expect(h.notifications.at(-1)).toEqual({
      method: "assistantContentUpdated",
      params: { messageId: "m1", chunk: "he", stage: "streaming" },
      sessionId: "s1",
    });
  });
});
