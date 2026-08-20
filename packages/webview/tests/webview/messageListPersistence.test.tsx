import { describe, it, expect, vi } from "vitest";
import { renderChatApp, waitFor, act, sendCommand } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/**
 * Persistent measured-height cache (OpenCode timelineCache alignment).
 *
 * Measured row heights are keyed by message id and written to localStorage
 * (debounced), so a session switch or webview reload answers estimateSize with
 * the real measured height instead of the 200px default. Each entry also
 * records the fold state it was measured in: reasoning blocks start expanded
 * while streaming and collapse once ended, compact blocks start collapsed —
 * estimateSize only trusts an entry whose fold state matches the message's
 * current default.
 *
 * jsdom measures every row at the stubbed 600px (tests/setup.ts), so the
 * assertions below are about the persistence CONTRACT (what lands in storage,
 * fold codes, corruption tolerance), not absolute heights — real geometry is
 * covered by the Playwright harness.
 */

const HEIGHTS_STORAGE_KEY = "wave-webview:measured-heights:v1";

type PersistedHeightEntry = { h: number; f: 0 | 1 | null };

function readPersistedHeights(): Map<string, PersistedHeightEntry> {
  const raw = localStorage.getItem(HEIGHTS_STORAGE_KEY);
  if (!raw) return new Map();
  return new Map(JSON.parse(raw) as Array<[string, PersistedHeightEntry]>);
}

function buildPlainMessages(count: number) {
  const messages: ReturnType<typeof MockDataGenerator.createUserMessage>[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 4 === 0 || i % 4 === 3) {
      messages.push(MockDataGenerator.createUserMessage(`问题 ${i}`, `u${i}`));
    } else {
      messages.push(
        MockDataGenerator.createAssistantMessage(`回答 ${i}`, `a${i}`),
      );
    }
  }
  return messages;
}

function buildReasoningMessage(id: string, stage: "streaming" | "end") {
  return {
    id,
    role: "assistant" as const,
    timestamp: "2024-01-01T00:00:00.000Z",
    blocks: [
      {
        type: "reasoning" as const,
        stage,
        content: "深层思考……",
        ...(stage === "end" ? { startTime: 1000, endTime: 2000 } : {}),
      },
    ],
  };
}

function buildCompactMessage(id: string) {
  return {
    id,
    role: "assistant" as const,
    timestamp: "2024-01-01T00:00:00.000Z",
    blocks: [{ type: "compact" as const, content: "压缩后的摘要" }],
  };
}

// Seed a corrupted payload BEFORE the module graph loads, so the module-level
// loadMeasuredHeights() (runs at import) has to survive it. The corrupted
// string stays in storage until the first measurement save overwrites it, so
// this test must run FIRST (before any other test triggers a save).
// Note: the key must be a literal — vi.hoisted runs before this module's const
// declarations, so referencing HEIGHTS_STORAGE_KEY would hit the TDZ.
vi.hoisted(() => {
  try {
    window.localStorage.setItem(
      "wave-webview:measured-heights:v1",
      "{corrupted-json",
    );
  } catch {
    // Storage unavailable — nothing to seed.
  }
});

describe("MessageList measured-height persistence", () => {
  it("recovers from a corrupted persisted payload", async () => {
    expect(localStorage.getItem(HEIGHTS_STORAGE_KEY)).toBe("{corrupted-json");
    // Import-time load swallowed the corrupt payload (module rendered, empty
    // cache fallback) — render a list and confirm a fresh measurement pass
    // overwrites the garbage with valid JSON.
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: buildPlainMessages(6) });
    });
    await waitFor(
      () => {
        const entries = readPersistedHeights();
        expect(entries.size).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
    const raw = localStorage.getItem(HEIGHTS_STORAGE_KEY);
    expect(() => JSON.parse(raw || "")).not.toThrow();
  });

  it("persists measured row heights keyed by message id", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: buildPlainMessages(10) });
    });
    // Wait for THIS test's own save — a size>0 check could pass on entries
    // left by an earlier test (the module-level cache + storage survive
    // across tests in the file).
    await waitFor(
      () => {
        expect(readPersistedHeights().get("a9")?.h).toBe(600);
      },
      { timeout: 3000 },
    );
    const entries = readPersistedHeights();
    // Every rendered row was measured and recorded (jsdom stubs offsetHeight
    // at 600 — see tests/setup.ts).
    for (const id of ["u0", "a1", "u4", "a9"]) {
      expect(entries.get(id)?.h).toBe(600);
    }
  });

  it("records the fold state each row was measured in", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("问题", "q0"),
          buildReasoningMessage("r-end", "end"),
          buildReasoningMessage("r-stream", "streaming"),
          buildCompactMessage("c1"),
          MockDataGenerator.createAssistantMessage("普通回答", "plain1"),
        ],
      });
    });
    await waitFor(
      () => {
        expect(readPersistedHeights().get("r-end")?.h).toBe(600);
      },
      { timeout: 3000 },
    );
    const entries = readPersistedHeights();
    // Ended reasoning starts collapsed → f=0; streaming reasoning starts
    // expanded → f=1; compact starts collapsed → f=0; no foldable blocks → f=null.
    expect(entries.get("r-end")?.f).toBe(0);
    expect(entries.get("r-stream")?.f).toBe(1);
    expect(entries.get("c1")?.f).toBe(0);
    expect(entries.get("plain1")?.f).toBeNull();
  });
});
