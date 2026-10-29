import { describe, expect, it } from "vitest";
import { toAgentSelectorItems } from "../../src/utils/agentSelector.js";
import type { SubagentConfiguration } from "wave-agent-sdk";

const configuration = (
  name: string,
  description: string,
): SubagentConfiguration =>
  ({
    name,
    description,
    scope: "project",
    priority: 1,
    filePath: `/tmp/${name}.md`,
  }) as unknown as SubagentConfiguration;

describe("toAgentSelectorItems", () => {
  it("shapes a subagent as an @ candidate carrying the name as the judge", () => {
    expect(
      toAgentSelectorItems([configuration("Explore", "只读探索")], ""),
    ).toEqual([
      {
        path: "agent:Explore",
        type: "agent",
        agentName: "Explore",
        agentDescription: "只读探索",
      },
    ]);
  });

  it("filters by name and description, case-insensitively", () => {
    const configurations = [
      configuration("Explore", "只读探索代码库"),
      configuration("Plan", "出实现计划"),
    ];
    expect(
      toAgentSelectorItems(configurations, "expl").map(
        (item) => item.agentName,
      ),
    ).toEqual(["Explore"]);
    expect(
      toAgentSelectorItems(configurations, "计划").map(
        (item) => item.agentName,
      ),
    ).toEqual(["Plan"]);
    expect(toAgentSelectorItems(configurations, "zzz")).toEqual([]);
  });

  it("returns nothing when no subagent is loaded", () => {
    expect(toAgentSelectorItems(undefined, "")).toEqual([]);
  });
});
