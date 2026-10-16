import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  percentOf,
  remoteNotifications,
  remoteWire,
} from "../../src/remote/remoteNotifications.js";
import {
  NotificationCoalescer,
  REMOTE_FRAME_WINDOW_MS,
  type RelayFrame,
} from "../../src/remote/notificationCoalescer.js";
import type { ToolBlockUpdateCallbackParams } from "wave-agent-sdk";

describe("remoteNotifications", () => {
  let sent: Array<{ method: string; params: unknown }>;

  beforeEach(() => {
    sent = [];
  });

  function callbacks() {
    return remoteNotifications((method, params) => {
      sent.push({ method, params });
    });
  }

  it("should put a text delta on the wire under the bridge's method name", () => {
    callbacks().onAssistantContentUpdated?.({
      messageId: "m1",
      chunk: "hel",
      stage: "streaming",
    });

    expect(sent).toEqual([
      {
        method: "assistantContentUpdated",
        params: { messageId: "m1", chunk: "hel", stage: "streaming" },
      },
    ]);
  });

  it("should carry the delta and nothing else, so a later field cannot join the wire", () => {
    callbacks().onAssistantReasoningUpdated?.({
      messageId: "m1",
      chunk: "think",
      stage: "streaming",
      // A field the SDK callback does not have today: the wire frame must stay
      // the three fields the coalescer's key and the phone's reducer expect.
      accumulated: "think",
    } as unknown as {
      messageId: string;
      chunk: string;
      stage: "streaming";
    });

    expect(sent).toEqual([
      {
        method: "assistantReasoningUpdated",
        params: { messageId: "m1", chunk: "think", stage: "streaming" },
      },
    ]);
  });

  it("should send only the parameters chunk while a tool block is streaming", () => {
    callbacks().onToolBlockUpdated?.({
      messageId: "m1",
      id: "t1",
      stage: "streaming",
      parametersChunk: '{"a"',
      parameters: '{"a":1}',
    } as ToolBlockUpdateCallbackParams);

    expect(sent).toEqual([
      {
        method: "toolBlockUpdated",
        params: {
          messageId: "m1",
          id: "t1",
          stage: "streaming",
          parametersChunk: '{"a"',
        },
      },
    ]);
  });

  it("should keep the authoritative parameters on the non-streaming stages", () => {
    for (const stage of ["start", "running", "end"] as const) {
      const params = {
        messageId: "m1",
        id: "t1",
        stage,
        parameters: '{"a":1}',
      } as ToolBlockUpdateCallbackParams;
      expect(remoteWire.toolBlockUpdated(params)).toEqual(params);
    }
  });

  it("should send an error block as its own payload frame", () => {
    // The one message family a signal cannot recover: the block is appended
    // *inside* the last message, and the phone's `since` anchor is that message
    // (spec remote-control「前台 CLI 会话也能被手机接管」场景 11).
    callbacks().onErrorBlockAdded?.("API Error: 500");

    expect(sent).toEqual([
      { method: "errorBlockAdded", params: { error: "API Error: 500" } },
    ]);
  });

  it("should keep the shapes both hosts share identical", () => {
    // These builders are the ones `AgentBridge` emits through too (daemon /
    // `--stdio`), so a change here is a change to *both* hosts' wire contract —
    // which is the point of the table: one edit, no drift.
    expect(remoteWire.loadingChange(true, 100)).toEqual({
      loading: true,
      latestTotalTokens: 100,
    });
    // Absent tokens must not become an explicit `undefined` on the frame — the
    // CLI host knows the flag but not always the count.
    expect(remoteWire.loadingChange(false)).toEqual({ loading: false });
    expect(remoteWire.contextUsage(50_000, 200_000)).toEqual({ percent: 25 });
    expect(remoteWire.permissionModeChange("plan")).toEqual({ mode: "plan" });
    expect(
      remoteWire.permissionRequest("perm_1", {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls" },
      }),
    ).toEqual({
      requestId: "perm_1",
      context: {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls" },
      },
    });
    // The two shapes of one method: the host snapshot the relay never sees (the
    // remote path strips the list) and the content-free signal it forwards.
    expect(remoteWire.messagesChangeSnapshot([])).toEqual({ messages: [] });
    expect(remoteWire.messagesChangeSignal()).toEqual({});
  });

  it("should round the context ring's percentage the same way everywhere", () => {
    expect(percentOf(50_000, 200_000)).toBe(25);
    // Capped, so an over-budget session reads 100 rather than growing the ring.
    expect(percentOf(400_000, 200_000)).toBe(100);
    // Unknown cap: a number, not a special case (the read paths return it as-is).
    expect(percentOf(1_000, 0)).toBe(0);
  });

  it("should emit frames the remote channel's own window merges", () => {
    // The point of the shapes above: they are the ones `mergeSpec` accepts. If
    // this test ever needs a second mechanism, the two hosts have drifted apart.
    vi.useFakeTimers();
    const written: RelayFrame[][] = [];
    const coalescer = new NotificationCoalescer((frames) =>
      written.push(frames),
    );
    const stream = remoteNotifications((method, params) => {
      coalescer.push(method, params, "s1");
    });

    for (const chunk of ["h", "e", "l", "l", "o"]) {
      stream.onAssistantContentUpdated?.({
        messageId: "m1",
        chunk,
        stage: "streaming",
      });
    }
    expect(written).toHaveLength(0);
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written).toHaveLength(1);
    expect(written[0][0].params).toEqual({
      messageId: "m1",
      stage: "streaming",
      chunk: "hello",
    });
    vi.useRealTimers();
  });
});
