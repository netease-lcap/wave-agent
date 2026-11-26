import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compileMods } from "../../src/mods/compile.js";
import { getEsbuild, withEsbuildBatch } from "../../src/utils/esbuild.js";

/**
 * 编译批次是排队的：批次之间串行，每批结束就释放 esbuild 的常驻服务。
 *
 * 两件事都必须钉住 ——
 *  - **串行**：所有批次共用**一个** esbuild 服务（进程里只有一份），一批
 *    释放服务时另一批的 `transform()` 还在飞，那一批会拿到
 *    "The service was stopped"（桌面端两个 pane 同时建 Agent 就是这种局面）。
 *  - **释放**：那个服务把 cwd 钉在会话目录上，Windows 下会锁住 worktree，
 *    退出时删不掉（`RemoveDirectoryW` → `EBUSY`）。
 *
 * 顺序用注入的 `release` 精确断言；真实编译能力再用真 esbuild 端到端跑一遍
 * （拿不到 esbuild 的环境整体跳过，与 `compile.test.ts` 同策）。
 */
const esbuild = getEsbuild();
const requireEsbuild = esbuild ? it : it.skip;

const ROOT = path.resolve("/fake/plugin/mods");
const MOD_SOURCE = `
  export function register() {
    return <Box gap={2}><Text>hi</Text></Box>;
  }
`;

describe("withEsbuildBatch", () => {
  it("一批跑完才释放，释放完才轮到下一批", async () => {
    const events: string[] = [];
    const release = vi.fn(async () => {
      events.push("release");
    });

    const first = withEsbuildBatch(async () => {
      events.push("a:start");
      await Promise.resolve();
      events.push("a:end");
      return "a";
    }, release);
    const second = withEsbuildBatch(async () => {
      events.push("b:start");
      events.push("b:end");
      return "b";
    }, release);

    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
    expect(events).toEqual([
      "a:start",
      "a:end",
      "release",
      "b:start",
      "b:end",
      "release",
    ]);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("编译失败也释放，下一批照常跑", async () => {
    const events: string[] = [];
    const release = vi.fn(async () => {
      events.push("release");
    });

    const failing = withEsbuildBatch(async () => {
      events.push("broken");
      throw new Error("boom");
    }, release);
    await expect(failing).rejects.toThrow("boom");

    await expect(
      withEsbuildBatch(async () => {
        events.push("ok");
        return "ok";
      }, release),
    ).resolves.toBe("ok");

    expect(events).toEqual(["broken", "release", "ok", "release"]);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("三批同时来，任务体不重叠", async () => {
    let inFlight = 0;
    let peak = 0;
    const task = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    };
    const release = async () => {};

    await Promise.all(
      Array.from({ length: 3 }, () => withEsbuildBatch(task, release)),
    );

    expect(peak).toBe(1);
  });

  requireEsbuild("三批真编译都能成功，谁也不打断谁", async () => {
    const batches = [0, 1, 2].map((index) =>
      withEsbuildBatch(() =>
        compileMods(esbuild!, [
          { path: path.join(ROOT, `mod${index}.tsx`), source: MOD_SOURCE },
        ]),
      ),
    );

    const outcomes = await Promise.all(batches);

    for (const byPath of outcomes) {
      const outcome = [...byPath.values()][0];
      expect(outcome.error).toBeUndefined();
      expect(outcome.code).toContain("__wave.h(");
    }
  });
});
