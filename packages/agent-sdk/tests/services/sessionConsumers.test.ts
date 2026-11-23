import { describe, it, expect } from "vitest";
import {
  SessionConsumers,
  baseConsumersOf,
  isSessionConsumerKind,
} from "../../src/services/sessionConsumers.js";

/**
 * 会话消费者（spec `core/session-consumers.md`）：基础集由入口推导，附加集由持有
 * relay 的那一层上报，两者是并集；「能渲染富产物」是唯一谓词。
 */
describe("baseConsumersOf", () => {
  it("trusts the declared surfaces over the entrypoint", () => {
    // `wave` and `wave -p` share `entrypoint: "cli"`; only the TUI declares
    // `["terminal"]`, so the declaration has to win (spec 故事 4 场景 1).
    expect(baseConsumersOf("cli", ["terminal"])).toEqual(["terminal"]);
    expect(baseConsumersOf("cli", [])).toEqual([]);
  });

  it("derives the rest from the entrypoint", () => {
    expect(baseConsumersOf("desktop", undefined)).toEqual(["desktop"]);
    // VS Code and JetBrains share one surface name — both ends run the same
    // webview (spec 故事 3 场景 2).
    expect(baseConsumersOf("vscode", undefined)).toEqual(["vscode"]);
    expect(baseConsumersOf("jetbrains", undefined)).toEqual(["vscode"]);
  });

  it("answers with nothing where there is no surface", () => {
    // A session created from the phone carries `entrypoint: "remote"` and no
    // declared surface: the page is not a mod surface, it is an *attached*
    // consumer, reported by the relay layer (spec 故事 1 场景 4).
    expect(baseConsumersOf("remote", undefined)).toEqual([]);
    expect(baseConsumersOf("cli", undefined)).toEqual([]);
    expect(baseConsumersOf(undefined, undefined)).toEqual([]);
  });

  it("drops surfaces that are not consumers", () => {
    expect(baseConsumersOf("desktop", ["desktop", "mobile"])).toEqual([
      "desktop",
    ]);
  });
});

describe("isSessionConsumerKind", () => {
  it("keeps only the four kinds", () => {
    expect(isSessionConsumerKind("remote-page")).toBe(true);
    expect(isSessionConsumerKind("terminal")).toBe(true);
    // Anything else a host might send is dropped rather than trusted.
    expect(isSessionConsumerKind("browser")).toBe(false);
    expect(isSessionConsumerKind(undefined)).toBe(false);
    expect(isSessionConsumerKind(1)).toBe(false);
  });
});

describe("SessionConsumers", () => {
  it("unions the base set with the attached one", () => {
    const consumers = new SessionConsumers(["terminal"]);
    expect(consumers.current()).toEqual(["terminal"]);

    consumers.setAttached(["remote-page"]);
    // Base first, appended after: the order is what a log line reads.
    expect(consumers.current()).toEqual(["terminal", "remote-page"]);
  });

  it("only counts a non-terminal viewer as able to render", () => {
    // A terminal is somebody watching, but it cannot draw a card.
    expect(new SessionConsumers(["terminal"]).hasRenderable()).toBe(false);
    expect(new SessionConsumers([]).hasRenderable()).toBe(false);
    expect(new SessionConsumers(["desktop"]).hasRenderable()).toBe(true);
    expect(new SessionConsumers(["vscode"]).hasRenderable()).toBe(true);

    const consumers = new SessionConsumers(["terminal"]);
    consumers.setAttached(["remote-page"]);
    expect(consumers.hasRenderable()).toBe(true);
  });

  it("reports whether the attached set actually moved", () => {
    const consumers = new SessionConsumers(["terminal"]);
    // Every relay frame re-reports, so an unchanged set must stay silent —
    // otherwise the change callback fires once per frame (spec 非功能需求
    // 「变化要有通知」), and the very first "nobody attached yet" is no change
    // either: the initial state already is that.
    expect(consumers.setAttached([])).toBe(false);

    expect(consumers.setAttached(["remote-page"])).toBe(true);
    expect(consumers.setAttached(["remote-page"])).toBe(false);
    expect(consumers.setAttached(["remote-page", "remote-page"])).toBe(false);
    expect(consumers.setAttached([])).toBe(true);
  });

  it("covers rather than merges", () => {
    const consumers = new SessionConsumers(["desktop"]);
    consumers.setAttached(["remote-page"]);
    // The reporter says who is on it *now*; it does not send diffs.
    consumers.setAttached([]);
    expect(consumers.current()).toEqual(["desktop"]);
  });
});
