import type { SubagentConfiguration } from "wave-agent-sdk";
import type { FileSelectorItem } from "../managers/inputReducer.js";

/**
 * `@` 候选里的子代理条目（spec `multi-agent/subagent.md`「用户故事：显式子代理调用」）。
 *
 * 判据与 webview 同一份：条目带 `agentName`，点击后插入 `@agent:<名称>`；
 * 名字/描述的过滤也在调用方做一次，和文件搜索互不影响。子代理列表来自
 * `Agent.getSubagentConfigurations()`（已过 vision 门），本函数只做整形。
 */
export const toAgentSelectorItems = (
  configurations: SubagentConfiguration[] | undefined,
  filterText: string,
): FileSelectorItem[] => {
  const filter = filterText.toLowerCase();
  return (configurations ?? [])
    .filter(
      (configuration) =>
        !filter ||
        configuration.name.toLowerCase().includes(filter) ||
        (configuration.description ?? "").toLowerCase().includes(filter),
    )
    .map((configuration) => ({
      path: `agent:${configuration.name}`,
      type: "agent" as const,
      agentName: configuration.name,
      agentDescription: configuration.description,
    }));
};
