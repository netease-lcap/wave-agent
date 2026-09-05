import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";

/**
 * Regression for Bug 3466449778535424 layout follow-up: the skill source tag
 * (内置/用户/项目/插件) sits on the command-name line, directly above the
 * description line. When the host font line-height differs, the pill must NOT
 * touch or overlap the description's first line. Guarded with an explicit
 * inter-line margin + min-height name row (slashCommandsPopup.css), measured
 * here with real-browser geometry so a future font/padding change that
 * collapses the pill back onto the description fails CI.
 */
const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    fastModel: "claude-haiku-4-20250514",
  },
  permissionMode: "default",
};

interface RowBox {
  name: string;
  tagBottom: number | null;
  descTop: number | null;
  clearance: number | null; // descTop - tagBottom for tagged rows
}

async function openPopupWithSkills(
  webviewPage: import("@playwright/test").Page,
): Promise<RowBox[]> {
  const injector = new MessageInjector(webviewPage);
  await webviewPage.setViewportSize({ width: 700, height: 600 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
    host: "local",
    hosts: ["local"],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);

  await webviewPage.focus('[data-testid="message-input"]');
  await webviewPage.keyboard.type("/");
  await webviewPage.waitForFunction(() => {
    const messages = window.getTestMessages ? window.getTestMessages() : [];
    return messages.some((m) => m.command === "requestSlashCommands");
  });
  await injector.simulateExtensionMessage("slashCommandsResponse", {
    commands: [
      { id: "model", name: "model", description: "切换 AI 模型" },
      {
        id: "artifact",
        name: "artifact",
        description: "发布本地 HTML 为可分享网页",
        skillSource: "builtin",
      },
      {
        id: "loop",
        name: "loop",
        description: "按固定间隔反复执行提示词",
        skillSource: "user",
      },
    ],
  });
  await webviewPage.waitForSelector(".slash-command-item", {
    state: "visible",
  });

  return webviewPage.evaluate<RowBox[]>(() =>
    Array.from(document.querySelectorAll(".slash-command-item")).map((item) => {
      const name = item.querySelector(".slash-command-name");
      const tag = item.querySelector(".slash-command-tag");
      const desc = item.querySelector(".slash-command-description");
      const tagRect = tag ? tag.getBoundingClientRect() : null;
      const descRect = desc ? desc.getBoundingClientRect() : null;
      return {
        name: name?.textContent ?? "",
        tagBottom: tagRect ? tagRect.bottom : null,
        descTop: descRect ? descRect.top : null,
        clearance: tagRect && descRect ? descRect.top - tagRect.bottom : null,
      };
    }),
  );
}

test.describe("Slash popup skill tag spacing", () => {
  test("tag bottom stays clear of the description line below it", async ({
    webviewPage,
  }) => {
    const rows = await openPopupWithSkills(webviewPage);
    // 桌面端 /clear 已移除（2026-09-05），popup 不再含 /clear 条目。
    expect(rows.map((r) => r.name)).toEqual(["/model", "/artifact", "/loop"]);

    const tagged = rows.filter((r) => r.tagBottom !== null);
    expect(tagged.map((r) => r.name)).toEqual(["/artifact", "/loop"]);

    // Explicit inter-line margin (2px) + the pill's centered clearance inside
    // the min-height name row keep at least ~2.5px between pill bottom and
    // description top. Anything below 2px means the pill visually presses on
    // (or overlaps) the description again.
    for (const row of tagged) {
      expect(
        row.clearance!,
        `${row.name} tag overlaps description`,
      ).toBeGreaterThanOrEqual(2);
    }

    // System rows (no tag) still keep their name line off the description.
    for (const row of rows) expect(row.descTop).not.toBeNull();
  });
});
