import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
  getMaxSubagentSpawnDepth,
  parseMaxSubagentSpawnDepth,
} from "../../src/utils/subagentDepth.js";

describe("子代理委派深度上限（spec multi-agent/subagent「子代理嵌套委派」）", () => {
  it("只接受正整数", () => {
    expect(parseMaxSubagentSpawnDepth("3")).toBe(3);
    expect(parseMaxSubagentSpawnDepth(" 5 ")).toBe(5);
    expect(parseMaxSubagentSpawnDepth(2)).toBe(2);
    for (const bad of ["0", "-1", "2.5", "abc", "", "   ", "3px"]) {
      expect(parseMaxSubagentSpawnDepth(bad)).toBeUndefined();
    }
    expect(parseMaxSubagentSpawnDepth(0)).toBeUndefined();
    expect(parseMaxSubagentSpawnDepth(2.5)).toBeUndefined();
    expect(parseMaxSubagentSpawnDepth(undefined)).toBeUndefined();
  });

  it("没配置时用默认值 3（对齐 Claude Code 的 AI()）", () => {
    expect(DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH).toBe(3);
    const original = process.env.WAVE_MAX_SUBAGENT_SPAWN_DEPTH;
    delete process.env.WAVE_MAX_SUBAGENT_SPAWN_DEPTH;
    try {
      expect(getMaxSubagentSpawnDepth()).toBe(DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH);
    } finally {
      if (original !== undefined) {
        process.env.WAVE_MAX_SUBAGENT_SPAWN_DEPTH = original;
      }
    }
  });

  it("读进程环境变量，非法值退回默认而不是抛", () => {
    vi.stubEnv("WAVE_MAX_SUBAGENT_SPAWN_DEPTH", "5");
    expect(getMaxSubagentSpawnDepth()).toBe(5);

    vi.stubEnv("WAVE_MAX_SUBAGENT_SPAWN_DEPTH", "nope");
    expect(getMaxSubagentSpawnDepth()).toBe(DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH);

    vi.stubEnv("WAVE_MAX_SUBAGENT_SPAWN_DEPTH", "0");
    expect(getMaxSubagentSpawnDepth()).toBe(DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH);
    vi.unstubAllEnvs();
  });
});
