import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Meter } from "@opentelemetry/api";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import * as metrics from "../../src/telemetry/metrics.js";
import { Container } from "../../src/utils/container.js";
import type {
  PermissionCallback,
  PermissionMode,
  ToolPermissionContext,
} from "../../src/types/permissions.js";
import { OPERATION_CANCELLED_BY_USER } from "../../src/types/permissions.js";

/**
 * The standard attribute surface is stubbed (`tests/telemetry/metrics.test.ts`
 * covers it); the instruments themselves are real, so the assertions below are
 * about the data points `wave.code_edit_tool.decision` actually receives.
 */
const { standardAttributes } = vi.hoisted(() => ({
  standardAttributes: vi.fn(() => ({})),
}));
vi.mock("@/telemetry/attributes.js", () => ({ standardAttributes }));

/** The active-time pause is asserted, not exercised, here. */
const { beginUserWait, endUserWait } = vi.hoisted(() => ({
  beginUserWait: vi.fn(),
  endUserWait: vi.fn(),
}));
vi.mock("@/telemetry/activity.js", () => ({ beginUserWait, endUserWait }));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type AddSpy = ReturnType<typeof vi.fn>;

/** A meter whose instruments are spies, keyed by metric name. */
function fakeMeter() {
  const instruments = new Map<string, { add: AddSpy }>();
  const createCounter = vi.fn((name: string) => {
    const instrument = { add: vi.fn() };
    instruments.set(name, instrument);
    return instrument;
  });

  return {
    meter: { createCounter } as unknown as Meter,
    counter: (name: string) => instruments.get(name)!,
  };
}

describe("wave.code_edit_tool.decision", () => {
  let fake: ReturnType<typeof fakeMeter>;
  let permissionManager: PermissionManager;

  const SESSION_ID = "session-1";

  function buildManager(options: { workdir?: string } = {}) {
    const container = new Container();
    container.register("Workdir", options.workdir ?? "/repo");
    container.register("MessageManager", {
      getSessionId: () => SESSION_ID,
    });

    return new PermissionManager(container);
  }

  /** The data points recorded so far, in call order. */
  const dataPoints = () =>
    fake.counter("wave.code_edit_tool.decision").add.mock.calls as Array<
      [number, Record<string, unknown>]
    >;

  /** A permission context for one tool call, with an optional dialog. */
  function contextOf(
    toolName: string,
    answers?: PermissionCallback,
    filePath?: string,
  ): ToolPermissionContext {
    return {
      toolName,
      permissionMode: "default",
      canUseToolCallback: answers,
      toolInput: filePath ? { file_path: filePath } : undefined,
    };
  }

  beforeEach(() => {
    standardAttributes.mockReset();
    standardAttributes.mockReturnValue({});
    beginUserWait.mockClear();
    endUserWait.mockClear();

    fake = fakeMeter();
    metrics.initMetrics(fake.meter);
    permissionManager = buildManager();
  });

  describe("accept", () => {
    it("should count an edit the user allowed once, with its language", async () => {
      const answers = vi.fn().mockResolvedValue({ behavior: "allow" });

      await permissionManager.checkPermission(
        contextOf("Edit", answers, "/repo/src/app.ts"),
      );

      expect(dataPoints()).toEqual([
        [
          1,
          {
            decision: "accept",
            source: "user_temporary",
            tool_name: "Edit",
            language: "typescript",
          },
        ],
      ]);
    });

    it("should call an answer that persists a rule permanent", async () => {
      const answers = vi.fn().mockResolvedValue({
        behavior: "allow",
        newPermissionRule: "Edit(/repo/src/**)",
      });

      await permissionManager.checkPermission(
        contextOf("Edit", answers, "/repo/src/app.ts"),
      );

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "accept",
        source: "user_permanent",
      });
    });

    it("should treat a mode switch as a session-wide answer", async () => {
      const answers = vi.fn().mockResolvedValue({
        behavior: "allow",
        newPermissionMode: "acceptEdits",
      });

      await permissionManager.checkPermission(
        contextOf("Write", answers, "/repo/notes.md"),
      );

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "accept",
        source: "user_temporary",
        tool_name: "Write",
        language: "markdown",
      });
    });

    it("should count an auto-approval as a config decision", async () => {
      // bypassPermissions never asks: the decision still counts, so the ratio
      // of prompted to automatic decisions stays visible.
      await permissionManager.checkPermission({
        ...contextOf("Edit", vi.fn(), "/repo/src/app.ts"),
        permissionMode: "bypassPermissions" as PermissionMode,
      });

      expect(dataPoints()).toEqual([
        [
          1,
          {
            decision: "accept",
            source: "config",
            tool_name: "Edit",
            language: "typescript",
          },
        ],
      ]);
      expect(beginUserWait).not.toHaveBeenCalled();
    });
  });

  describe("reject", () => {
    it("should count a rejection the user typed", async () => {
      const answers = vi
        .fn()
        .mockResolvedValue({ behavior: "deny", message: "not this file" });

      await permissionManager.checkPermission(
        contextOf("Edit", answers, "/repo/src/app.ts"),
      );

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "reject",
        source: "user_reject",
      });
    });

    it("should count a dismissed prompt as an abort", async () => {
      const answers = vi.fn().mockResolvedValue({
        behavior: "deny",
        message: OPERATION_CANCELLED_BY_USER,
      });

      await permissionManager.checkPermission(
        contextOf("Write", answers, "/repo/src/app.ts"),
      );

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "reject",
        source: "user_abort",
      });
    });

    it("should attribute a blocked call to the hook, not the user", async () => {
      // The PermissionRequest hook answers before the prompt exists and labels
      // itself; the label must survive and stay off the returned decision.
      const answers = vi.fn().mockResolvedValue({
        behavior: "deny",
        message: "denied by hook",
        source: "hook",
      });

      const decision = await permissionManager.checkPermission(
        contextOf("Edit", answers, "/repo/src/app.ts"),
      );

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "reject",
        source: "hook",
      });
      expect(decision).toEqual({ behavior: "deny", message: "denied by hook" });
    });

    it("should count a deny rule as config", async () => {
      const denied = new PermissionManager(new Container(), {
        deniedRules: ["Edit"],
      });

      await denied.checkPermission(contextOf("Edit", vi.fn()));

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "reject",
        source: "config",
      });
    });

    it("should count an auto-deny in dontAsk mode as config", async () => {
      await permissionManager.checkPermission({
        ...contextOf("Edit", vi.fn()),
        permissionMode: "dontAsk" as PermissionMode,
      });

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "reject",
        source: "config",
      });
    });

    it("should fall back to unknown when the callback itself fails", async () => {
      const answers = vi.fn().mockRejectedValue(new Error("dialog crashed"));

      await permissionManager.checkPermission(contextOf("Edit", answers));

      expect(dataPoints()[0]![1]).toMatchObject({
        decision: "reject",
        source: "unknown",
      });
    });
  });

  describe("scope", () => {
    it("should count Write as well as Edit", async () => {
      const answers = vi.fn().mockResolvedValue({ behavior: "allow" });

      await permissionManager.checkPermission(
        contextOf("Write", answers, "/repo/main.go"),
      );

      expect(dataPoints()[0]![1]).toMatchObject({
        tool_name: "Write",
        language: "go",
      });
    });

    it("should leave other tools' decisions out of this counter", async () => {
      const answers = vi.fn().mockResolvedValue({ behavior: "allow" });

      await permissionManager.checkPermission(
        contextOf("Bash", answers, "/repo/src/app.ts"),
      );
      await permissionManager.checkPermission(contextOf("Read", answers));

      expect(dataPoints()).toEqual([]);
    });

    it("should omit the language when the path cannot be named", async () => {
      const answers = vi.fn().mockResolvedValue({ behavior: "allow" });

      await permissionManager.checkPermission(
        contextOf("Edit", answers, "/repo/Makefile.am.unknown-ext"),
      );

      expect(dataPoints()[0]![1]).not.toHaveProperty("language");
    });
  });

  describe("active time while the dialog is up", () => {
    it("should close the session's interval around the prompt only", async () => {
      const answers = vi.fn().mockResolvedValue({ behavior: "allow" });

      await permissionManager.checkPermission(
        contextOf("Edit", answers, "/repo/src/app.ts"),
      );

      expect(beginUserWait).toHaveBeenCalledTimes(1);
      expect(endUserWait).toHaveBeenCalledTimes(1);
      // The wait carries the session it belongs to, so it closes that session's
      // interval and no one else's.
      expect(beginUserWait.mock.calls[0]![0]).toMatchObject({
        sessionId: SESSION_ID,
        workdir: "/repo",
      });
    });

    it("should close the interval even when the callback throws", async () => {
      const answers = vi.fn().mockRejectedValue(new Error("dialog crashed"));

      await permissionManager.checkPermission(contextOf("Edit", answers));

      expect(endUserWait).toHaveBeenCalledTimes(1);
    });
  });

  describe("attribution", () => {
    it("should attribute the decision to the session it was made in", async () => {
      metrics.initMetrics(fake.meter, {
        includeSessionId: true,
        includeRepository: false,
        includeEntrypoint: false,
        resourceAttributes: {},
      });

      await permissionManager.checkPermission(
        contextOf("Edit", vi.fn().mockResolvedValue({ behavior: "allow" })),
      );

      expect(standardAttributes).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        workdir: "/repo",
        includeRepository: false,
        entrypoint: undefined,
      });
    });
  });
});
