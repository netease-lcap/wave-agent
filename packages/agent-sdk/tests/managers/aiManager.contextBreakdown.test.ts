import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import { estimateTokens } from "../../src/utils/tokenEstimate.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../../src/utils/gitUtils.js", () => ({
  isGitRepository: vi.fn(),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));

import { existsSync } from "node:fs";

const WORKDIR = "/test/workdir";

const MODEL_CONFIG: ModelConfig = {
  model: "test-agent-model",
  fastModel: "test-fast-model",
} as ModelConfig;

/** 三档记忆文件与规则各一份正文：体积不同，便于看清差额被算到了哪一栏。 */
const PROJECT_MEMORY = "# Project\n\n- 共享团队约定，提交前跑 pnpm lint\n";
const USER_MEMORY = "# User\n\n- 用中文回答\n";
const LOCAL_MEMORY =
  "# Local\n\n- 本机私有备注：数据库口令走 1password，不要写进 AGENTS.md\n- 端口 5173\n";
const RULES = "- 先读 spec 再动实现\n- 提交信息用英文\n";

function createHarness() {
  const container = new Container();
  // 会话起点（记忆文件的锚点）与会漂的当前目录分开：分项必须报后者的兄弟、
  // 前者的路径 —— 注入侧读的也是会话起点。
  container.register("SessionWorkdir", WORKDIR);
  container.register("CurrentWorkdir", "/drifted/subdir");
  vi.mocked(existsSync).mockReturnValue(true);

  const messageManager = {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn().mockReturnValue([]),
    getLatestTotalTokens: vi.fn().mockReturnValue(0),
    // 注入侧的正文 = 三档记忆 + 无条件规则，与 SDK 的拼接顺序一致。
    getMemoryForInjection: vi.fn().mockResolvedValue({
      prependContent: `${PROJECT_MEMORY}\n${USER_MEMORY}\n${LOCAL_MEMORY}\n${RULES}`,
    }),
  } as unknown as MessageManager;

  container.register("ConfigurationService", {
    setOptions: vi.fn(),
    resolveGatewayConfig: vi.fn().mockReturnValue({
      apiKey: "test-api-key",
      baseURL: "https://test-gateway.com",
    } as GatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(MODEL_CONFIG),
    resolveContextWindow: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
    getEnvironmentVars: vi.fn().mockReturnValue({}),
  });
  container.register("MessageManager", messageManager);
  container.register("ToolManager", {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  } as unknown as ToolManager);
  container.register("TaskManager", {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
  });
  // 展开版三档：项目档 `readMemoryFile`、用户档 `getUserMemoryContent`、个人档
  // `readLocalMemoryFile` —— 分项必须把这三份都单列出去。
  const memoryService = {
    readMemoryFile: vi.fn().mockResolvedValue(PROJECT_MEMORY),
    getUserMemoryContent: vi.fn().mockResolvedValue(USER_MEMORY),
    readLocalMemoryFile: vi.fn().mockResolvedValue(LOCAL_MEMORY),
    readRawLocalMemory: vi.fn().mockResolvedValue(""),
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  };
  container.register("MemoryService", memoryService);
  container.register("PermissionManager", {
    getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    isToolDenied: vi.fn().mockReturnValue(false),
    clearTemporaryRules: vi.fn(),
    getPlanFilePath: vi.fn().mockReturnValue(undefined),
    setHasExitedPlanMode: vi.fn(),
    hasExitedPlanModeInSession: vi.fn(() => false),
    setNeedsPlanModeExitAttachment: vi.fn(),
    getNeedsPlanModeExitAttachment: vi.fn(() => false),
  });
  container.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  container.register("MessageQueue", {
    hasNotifications: vi.fn().mockReturnValue(false),
    drainNotifications: vi.fn().mockReturnValue([]),
  });
  container.register("McpManager", {});

  const aiManager = new AIManager(container, {
    workdir: WORKDIR,
    stream: false,
  });

  return { aiManager };
}

function tokensOf(
  files: Array<{ type: string; tokens: number }>,
  type: string,
): number | undefined {
  return files.find((file) => file.type === type)?.tokens;
}

describe("AIManager /context breakdown of memory files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the personal tier on its own instead of folding it into .wave/rules", async () => {
    const { aiManager } = createHarness();

    const breakdown = await aiManager.getContextBreakdown();

    expect(breakdown.errors).toEqual([]);
    const local = breakdown.memoryFiles.find((file) => file.type === "local");
    // 个人档有自己的路径与体积 —— 不单列就会把它的字数算进「规则」那一栏。
    expect(local).toEqual({
      type: "local",
      path: join(WORKDIR, "AGENTS.local.md"),
      tokens: estimateTokens(LOCAL_MEMORY),
    });
    // 三档都锚在会话起点，不跟着当前目录漂到 /drifted/subdir。
    expect(breakdown.memoryFiles.map((file) => file.path)).toContain(
      join(WORKDIR, "AGENTS.md"),
    );

    const total = estimateTokens(
      `${PROJECT_MEMORY}\n${USER_MEMORY}\n${LOCAL_MEMORY}\n${RULES}`,
    );
    expect(tokensOf(breakdown.memoryFiles, "rules")).toBe(
      Math.max(
        0,
        total -
          estimateTokens(PROJECT_MEMORY) -
          estimateTokens(USER_MEMORY) -
          estimateTokens(LOCAL_MEMORY),
      ),
    );
    // 差额里只剩规则本身：个人档的体积不能再被算第二遍。
    expect(tokensOf(breakdown.memoryFiles, "rules")).toBeLessThan(
      estimateTokens(RULES) + estimateTokens(LOCAL_MEMORY),
    );
  });
});
