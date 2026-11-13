import { describe, expect, it, vi } from "vitest";
import { Container } from "../../src/utils/container.js";
import { notifyModPermissionRequest } from "../../src/utils/containerSetup.js";
import type { ModManager } from "../../src/managers/modManager.js";
import type { ModPermissionRequestEvent } from "../../src/types/mods.js";

/**
 * `classic.PermissionRequest`（spec ecosystem/plugin-mods.md「完成与审批的观
 * 察」）：审批卡片即将出现时，mod 收到一条只读通知，用来往自己的服务端上报。
 *
 * 只钉这条接线本身：容器里有 mods 宿主就通知它，没有就什么都不做；名字用
 * Claude Code 的 `classic.<Event>`，载荷是那份 hook stdin JSON。整个
 * `setupAgentContainer` 太重，而这段逻辑的全部就是这个转发。
 */

function event(
  overrides: Partial<ModPermissionRequestEvent> = {},
): ModPermissionRequestEvent {
  return {
    session_id: "s1",
    transcript_path: "/fake/transcript.jsonl",
    cwd: "/fake/project",
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "rm -rf build" },
    ...overrides,
  };
}

describe("notifyModPermissionRequest", () => {
  it("用 classic.PermissionRequest 这个名字把载荷原样交给 mods 宿主", () => {
    const container = new Container();
    const notifyMods = vi.fn();
    container.register("ModManager", { notifyMods } as unknown as ModManager);

    notifyModPermissionRequest(container, event());

    expect(notifyMods).toHaveBeenCalledWith("classic.PermissionRequest", {
      session_id: "s1",
      transcript_path: "/fake/transcript.jsonl",
      cwd: "/fake/project",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "rm -rf build" },
    });
  });

  it("容器里还没有 mods 宿主时什么都不做（不是缺陷）", () => {
    const container = new Container();

    expect(() =>
      notifyModPermissionRequest(container, event({ tool_name: "Write" })),
    ).not.toThrow();
  });
});
