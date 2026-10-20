import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  SlashCommandsPopup,
  orderSlashCommands,
} from "../../src/components/SlashCommandsPopup";

// Component imports its CSS directly; stub it so jsdom doesn't need to parse styles.
vi.mock("../../src/styles/SlashCommandsPopup.css", () => ({}));

type Command = {
  id: string;
  name: string;
  description: string;
  skillSource?: "builtin" | "user" | "project" | "plugin";
};

function renderPopup(commands: Command[], selectedIndex = 0) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <SlashCommandsPopup
      commands={commands}
      isVisible={true}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onClose={onClose}
      position={{ top: 0, left: 0 }}
    />,
  );
  return { ...utils, onSelect, onClose };
}

// Return the group container (.slash-group) whose title matches `title`.
function getGroup(title: string): HTMLElement {
  const titleEl = screen.getByText(title, { selector: ".slash-group-title" });
  const group = titleEl.closest(".slash-group");
  expect(group).not.toBeNull();
  return group as HTMLElement;
}

describe("SlashCommandsPopup grouping", () => {
  it("renders both group titles and assigns commands by skillSource", () => {
    const commands: Command[] = [
      { id: "plugin", name: "plugin", description: "插件市场" },
      { id: "config", name: "config", description: "配置" },
      {
        id: "settings",
        name: "settings",
        description: "设置技能",
        skillSource: "builtin",
      },
      {
        id: "deepwiki:ask",
        name: "deepwiki:ask",
        description: "DeepWiki",
        skillSource: "plugin",
      },
    ];

    renderPopup(commands);

    // 只有两个分组：系统指令在前、技能在后。
    expect(
      screen.getByText("系统指令", { selector: ".slash-group-title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("技能", { selector: ".slash-group-title" }),
    ).toBeInTheDocument();
    // 插件市场已是独立入口，弹窗不再单列「插件管理」分组。
    expect(
      screen.queryByText("插件管理", { selector: ".slash-group-title" }),
    ).not.toBeInTheDocument();

    // 无 skillSource → 系统指令
    const systemGroup = getGroup("系统指令");
    for (const id of ["plugin", "config"]) {
      expect(
        within(systemGroup).getByTestId(`slash-command-${id}`),
      ).toBeInTheDocument();
    }
    expect(
      within(systemGroup).queryByTestId("slash-command-settings"),
    ).not.toBeInTheDocument();

    // 带 skillSource → 技能
    const skillGroup = getGroup("技能");
    for (const id of ["settings", "deepwiki:ask"]) {
      expect(
        within(skillGroup).getByTestId(`slash-command-${id}`),
      ).toBeInTheDocument();
    }
    expect(
      within(skillGroup).queryByTestId("slash-command-config"),
    ).not.toBeInTheDocument();
  });

  it("groups host-local commands as system commands without any name whitelist", () => {
    // 宿主本地指令表（desktop / VSCE / JB 各自维护）加一条新命令时，弹窗这边不需要
    // 同步任何名单；曾经的 `SYSTEM_COMMANDS` 白名单漏登记就让它们掉进「技能」分组
    // （/hooks、/plan、/resume、/reload-plugins 都踩过）。
    const commands: Command[] = [
      { id: "hooks", name: "hooks", description: "钩子" },
      { id: "plan", name: "plan", description: "规划模式" },
      { id: "resume", name: "resume", description: "恢复对话" },
      { id: "reload-plugins", name: "reload-plugins", description: "重载插件" },
      // 插件命令（`插件名:` 前缀）与磁盘自定义命令同样不是技能
      { id: "deepwiki:ask", name: "deepwiki:ask", description: "DeepWiki" },
      { id: "project-info", name: "project-info", description: "自定义命令" },
    ];

    renderPopup(commands);

    const systemGroup = getGroup("系统指令");
    for (const id of [
      "hooks",
      "plan",
      "resume",
      "reload-plugins",
      "deepwiki:ask",
      "project-info",
    ]) {
      expect(
        within(systemGroup).getByTestId(`slash-command-${id}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByText("技能", { selector: ".slash-group-title" }),
    ).not.toBeInTheDocument();
  });

  it("groups /remote-control with the system commands, not with skills", () => {
    renderPopup([
      { id: "remote-control", name: "remote-control", description: "远程控制" },
      {
        id: "deepwiki:ask",
        name: "deepwiki:ask",
        description: "DeepWiki",
        skillSource: "plugin",
      },
    ]);

    expect(
      within(getGroup("系统指令")).getByTestId("slash-command-remote-control"),
    ).toBeInTheDocument();
    expect(
      within(getGroup("技能")).queryByTestId("slash-command-remote-control"),
    ).not.toBeInTheDocument();
  });

  it("renders groups in a fixed order: 系统指令 -> 技能", () => {
    const commands: Command[] = [
      {
        id: "settings",
        name: "settings",
        description: "设置技能",
        skillSource: "user",
      },
      { id: "config", name: "config", description: "配置" },
      { id: "plugin", name: "plugin", description: "插件市场" },
    ];

    const { container } = renderPopup(commands);

    const titles = Array.from(
      container.querySelectorAll(".slash-group-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["系统指令", "技能"]);
  });

  it("does not render empty group titles when only skill commands are present", () => {
    const commands: Command[] = [
      {
        id: "settings",
        name: "settings",
        description: "",
        skillSource: "builtin",
      },
      { id: "loop", name: "loop", description: "", skillSource: "user" },
    ];

    renderPopup(commands);

    expect(
      screen.queryByText("系统指令", { selector: ".slash-group-title" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("技能", { selector: ".slash-group-title" }),
    ).toBeInTheDocument();
  });

  it("selectedIndex follows display (grouped) order, not the raw backend array order", () => {
    // Backend array is NOT in group order: skills sit at raw index 0 and 3.
    // Display order is: 0 config(系统指令), 1 plugin(系统指令),
    //                   2 code-review(技能), 3 loop(技能).
    const commands: Command[] = [
      {
        id: "code-review",
        name: "code-review",
        description: "代码审查",
        skillSource: "builtin",
      },
      { id: "config", name: "config", description: "配置" },
      { id: "plugin", name: "plugin", description: "插件市场" },
      { id: "loop", name: "loop", description: "", skillSource: "user" },
    ];

    // selectedIndex 0 = first display item = config (系统指令), NOT code-review.
    renderPopup(commands, 0);
    expect(screen.getByTestId("slash-command-config")).toHaveClass("selected");
    expect(screen.getByTestId("slash-command-code-review")).not.toHaveClass(
      "selected",
    );
  });

  it("applies .selected to the item at the flat selectedIndex, including across groups", () => {
    // Flat order: 0 plugin(系统指令), 1 config(系统指令), 2 mcp(系统指令),
    //             3 settings(技能), 4 loop(技能)
    const commands: Command[] = [
      { id: "plugin", name: "plugin", description: "插件市场" },
      { id: "config", name: "config", description: "配置" },
      { id: "mcp", name: "mcp", description: "MCP" },
      {
        id: "settings",
        name: "settings",
        description: "",
        skillSource: "builtin",
      },
      { id: "loop", name: "loop", description: "", skillSource: "user" },
    ];

    const { container } = renderPopup(commands, 3);

    const selected = container.querySelectorAll(".slash-command-item.selected");
    // Exactly one selected item, and it is the 4th command (settings) in display order.
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(screen.getByTestId("slash-command-settings"));
  });

  it("marks the correct item when selectedIndex points into the first group", () => {
    const commands: Command[] = [
      { id: "plugin", name: "plugin", description: "插件市场" },
      { id: "config", name: "config", description: "配置" },
      {
        id: "settings",
        name: "settings",
        description: "",
        skillSource: "builtin",
      },
    ];

    renderPopup(commands, 0);

    expect(screen.getByTestId("slash-command-plugin")).toHaveClass("selected");
    expect(screen.getByTestId("slash-command-config")).not.toHaveClass(
      "selected",
    );
    expect(screen.getByTestId("slash-command-settings")).not.toHaveClass(
      "selected",
    );
  });

  it("renders the command name with a leading slash and its description", () => {
    const commands: Command[] = [
      { id: "settings", name: "settings", description: "打开设置" },
    ];

    renderPopup(commands);

    const item = screen.getByTestId("slash-command-settings");
    expect(
      within(item).getByText("/settings", { selector: ".slash-command-name" }),
    ).toBeInTheDocument();
    expect(
      within(item).getByText("打开设置", {
        selector: ".slash-command-description",
      }),
    ).toBeInTheDocument();
  });

  describe("skill source tags", () => {
    it("renders a source tag per skill command", () => {
      const commands: Command[] = [
        { id: "a", name: "a", description: "", skillSource: "builtin" },
        { id: "b", name: "b", description: "", skillSource: "user" },
        { id: "c", name: "c", description: "", skillSource: "project" },
        { id: "d", name: "d", description: "", skillSource: "plugin" },
      ];

      renderPopup(commands);

      const tagOf = (id: string) =>
        within(screen.getByTestId(`slash-command-${id}`)).getByTestId(
          `slash-command-source-${id}`,
        );
      expect(tagOf("a")).toHaveTextContent("内置");
      expect(tagOf("b")).toHaveTextContent("用户");
      expect(tagOf("c")).toHaveTextContent("项目");
      expect(tagOf("d")).toHaveTextContent("插件");
    });

    it("renders no tag for commands without skillSource (system/local)", () => {
      const commands: Command[] = [
        { id: "config", name: "config", description: "配置" },
        { id: "custom", name: "custom", description: "自定义" },
      ];

      renderPopup(commands);

      expect(
        within(screen.getByTestId("slash-command-config")).queryByTestId(
          "slash-command-source-config",
        ),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("slash-command-custom")).queryByTestId(
          "slash-command-source-custom",
        ),
      ).not.toBeInTheDocument();
    });

    it("renders mixed skills with their own tags side by side", () => {
      const commands: Command[] = [
        {
          id: "settings",
          name: "settings",
          description: "",
          skillSource: "builtin",
        },
        { id: "loop", name: "loop", description: "", skillSource: "user" },
      ];

      renderPopup(commands);

      expect(
        screen.getByTestId("slash-command-source-settings"),
      ).toHaveTextContent("内置");
      expect(screen.getByTestId("slash-command-source-loop")).toHaveTextContent(
        "用户",
      );
    });
  });
});

describe("orderSlashCommands", () => {
  it("reorders a raw backend list into 系统指令 -> 技能 display order", () => {
    const commands: Command[] = [
      {
        id: "code-review",
        name: "code-review",
        description: "代码审查",
        skillSource: "builtin",
      },
      { id: "config", name: "config", description: "配置" },
      { id: "plugin", name: "plugin", description: "插件市场" },
      { id: "loop", name: "loop", description: "", skillSource: "user" },
    ];

    expect(orderSlashCommands(commands).map((c) => c.id)).toEqual([
      "config",
      "plugin",
      "code-review",
      "loop",
    ]);
  });
});
