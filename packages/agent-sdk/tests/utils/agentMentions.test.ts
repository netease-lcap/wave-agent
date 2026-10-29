import { describe, expect, it } from "vitest";
import {
  buildAgentMentionReminder,
  parseAgentMentions,
} from "../../src/utils/agentMentions.js";

describe("parseAgentMentions", () => {
  it("reads the webview label spelling `[@agent:<name>]`", () => {
    expect(parseAgentMentions("帮我看看 [@agent:Explore] 这段")).toEqual([
      "Explore",
    ]);
  });

  it("reads the CLI spelling `@agent:<name>`", () => {
    expect(parseAgentMentions("@agent:code-reviewer 看下这次改动")).toEqual([
      "code-reviewer",
    ]);
  });

  it("keeps the plugin-scoped name, colon included", () => {
    expect(parseAgentMentions("[@agent:asana:project-status-updater]")).toEqual(
      ["asana:project-status-updater"],
    );
  });

  it("collects several names in order without duplicates", () => {
    expect(
      parseAgentMentions(
        "@agent:Explore 和 [@agent:Plan] 都看一下，再让 @agent:Explore 复查",
      ),
    ).toEqual(["Explore", "Plan"]);
  });

  it("ignores things that are not agent mentions", () => {
    expect(
      parseAgentMentions("@Explore @agent: @agent:9lives mail@agent:x.com"),
    ).toEqual([]);
  });
});

describe("buildAgentMentionReminder", () => {
  it("asks for delegation with the exact subagent_type", () => {
    const text = buildAgentMentionReminder(["Explore"], ["Explore", "Plan"]);
    expect(text).toContain('"Explore"');
    expect(text).toContain("subagent_type=");
    expect(text).toContain("delegate");
  });

  it("lists the available names when the mentioned one is not loaded", () => {
    const text = buildAgentMentionReminder(["ghost"], ["Explore", "Plan"]);
    expect(text).toContain('"ghost"');
    expect(text).toContain("Explore, Plan");
  });

  it("says none are available when the list is empty", () => {
    const text = buildAgentMentionReminder(["ghost"], []);
    expect(text).toContain("Available subagents: none");
  });

  it("covers both sides when only some names match", () => {
    const text = buildAgentMentionReminder(["Explore", "ghost"], ["Explore"]);
    expect(text).toContain('"Explore"');
    expect(text).toContain('"ghost"');
  });

  it("returns null when nothing was mentioned", () => {
    expect(buildAgentMentionReminder([], ["Explore"])).toBeNull();
  });
});
