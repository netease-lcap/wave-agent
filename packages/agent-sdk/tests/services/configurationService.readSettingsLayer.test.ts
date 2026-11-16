import { describe, expect, it, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import * as configPaths from "../../src/utils/configPaths.js";
import { ConfigurationService } from "../../src/services/configurationService.js";

/**
 * `$.settings.read` 的取数点（spec ecosystem/plugin-mods.md「环境变量与设置
 * （只读）」）：`source` 缺省给合并后的当前配置，给了就只读那一层文件。
 *
 * 三层各自的文件路径由 `configPaths` 决定，所以这里把那个模块的路径钉死，
 * 断言的是「哪个 source 读哪个文件」，而不是某台机器上的真实布局。
 */

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/services/remoteSettingsService.js", () => ({
  getRemoteSettingsSync: vi.fn(() => null),
  mergeRemoteSettings: vi.fn((config: unknown) => config),
}));

const workdir = "/test/workdir";
const USER_FILE = "/user/settings.json";
const PROJECT_FILE = "/project/settings.json";
const LOCAL_FILE = "/project/settings.local.json";

describe("ConfigurationService.readSettingsLayer", () => {
  let service: ConfigurationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(configPaths, "getUserConfigPaths").mockReturnValue([USER_FILE]);
    vi.spyOn(configPaths, "getProjectConfigPaths").mockReturnValue([
      LOCAL_FILE,
      PROJECT_FILE,
    ]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(((file: string): string => {
      if (file === USER_FILE)
        return JSON.stringify({ model: "user-model", env: { A: "1" } });
      if (file === PROJECT_FILE)
        return JSON.stringify({ model: "project-model" });
      if (file === LOCAL_FILE) return JSON.stringify({ model: "local-model" });
      return "{}";
    }) as unknown as typeof readFileSync);
    service = new ConfigurationService();
  });

  it("不传 source 时给合并后的当前配置", () => {
    vi.spyOn(service, "getCurrentConfiguration").mockReturnValue({
      model: "merged-model",
      env: { A: "1" },
    });

    expect(service.readSettingsLayer()).toEqual({
      model: "merged-model",
      env: { A: "1" },
    });
    // 合并结果来自内存里的当前配置，不该再读一遍文件。
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("当前还没有配置时给空对象，而不是 null", () => {
    vi.spyOn(service, "getCurrentConfiguration").mockReturnValue(null);

    expect(service.readSettingsLayer()).toEqual({});
  });

  it("三层各读各的文件", () => {
    expect(service.readSettingsLayer("user", workdir)).toEqual({
      model: "user-model",
      env: { A: "1" },
    });
    expect(service.readSettingsLayer("project", workdir)).toEqual({
      model: "project-model",
    });
    expect(service.readSettingsLayer("local", workdir)).toEqual({
      model: "local-model",
    });
    // `project` 用传进来的会话工作根解析，不是进程 cwd。
    expect(configPaths.getProjectConfigPaths).toHaveBeenCalledWith(workdir);
  });

  it("文件不存在时给空对象（「这一层什么都没配」不是错误）", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(service.readSettingsLayer("project", workdir)).toEqual({});
  });

  it("给的是副本：mod 改它不影响下一次读", () => {
    const first = service.readSettingsLayer("project", workdir);
    first.model = "被改了";

    expect(service.readSettingsLayer("project", workdir).model).toBe(
      "project-model",
    );
  });
});
