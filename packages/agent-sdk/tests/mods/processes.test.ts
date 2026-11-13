import { describe, expect, it, vi } from "vitest";
import { ModProcessManager } from "../../src/mods/processes.js";
import { MOD_LIMITS } from "../../src/types/mods.js";
import type { ModProcessChunk, ModProcessExit } from "../../src/types/mods.js";

/**
 * `ModProcessManager` 是 `$.process.spawn` 的宿主实现。
 *
 * 这里起的是**真进程**（`process.execPath` 跑 `-e` 一行脚本）：流的分块、
 * 退出码、stdin 一次性写入、输出上限、提前 `break` 的收尸，全都在真 spawn
 * 上才有意义 —— 把 `node:child_process` mock 掉，测的就只剩我们自己造的假流。
 */

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CWD = process.cwd();

/** 一个会先打一行 `ready` 再挂着不退出的子进程：用它验限额。 */
const HANG_SCRIPT = "console.log('ready'); setInterval(function () {}, 1000);";

/**
 * 同上，但打的是自己的 pid。
 *
 * 「提前 break / dispose 有没有把进程杀掉」只能从**外部**观测：拿 pid 之后
 * 用 `kill(pid, 0)` 探活。
 */
const PID_HANG_SCRIPT =
  "console.log(process.pid); setInterval(function () {}, 1000);";

function manager(): ModProcessManager {
  return new ModProcessManager(() => CWD);
}

/** 手动驱动迭代器：`for await` 拿不到生成器的返回值（退出码）。 */
async function collect(
  gen: AsyncGenerator<ModProcessChunk, ModProcessExit>,
): Promise<{ chunks: ModProcessChunk[]; exit: ModProcessExit }> {
  const chunks: ModProcessChunk[] = [];
  while (true) {
    const step = await gen.next();
    if (step.done) return { chunks, exit: step.value };
    chunks.push(step.value);
  }
}

function textOf(chunks: ModProcessChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("");
}

describe("ModProcessManager.spawn", () => {
  it("逐块产出一条可迭代的输出流，迭代结束时返回退出码", async () => {
    const { chunks, exit } = await collect(
      manager().spawn("todo:panel", {
        argv: [process.execPath, "-e", "console.log('hi')"],
      }),
    );

    expect(textOf(chunks)).toBe("hi\n");
    expect(chunks.every((chunk) => chunk.stream === "stdout")).toBe(true);
    expect(exit).toEqual({ code: 0, signal: null });
  });

  it("stderr 进同一条流，靠 stream 区分", async () => {
    const { chunks } = await collect(
      manager().spawn("todo:panel", {
        argv: [process.execPath, "-e", "console.error('bad')"],
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ stream: "stderr", text: "bad\n" });
  });

  it("input 写进 stdin 后关闭（一次性输入）", async () => {
    const { chunks } = await collect(
      manager().spawn("todo:panel", {
        argv: [
          process.execPath,
          "-e",
          "let s = ''; process.stdin.on('data', (d) => s += d); process.stdin.on('end', () => console.log('got:' + s));",
        ],
        input: "hello",
      }),
    );

    expect(textOf(chunks)).toBe("got:hello\n");
  });

  it("非零退出码如实返回", async () => {
    const { exit } = await collect(
      manager().spawn("todo:panel", {
        argv: [process.execPath, "-e", "process.exit(3)"],
      }),
    );

    expect(exit).toEqual({ code: 3, signal: null });
  });

  it("进程起不来时抛错，而不是给一条空流", async () => {
    await expect(
      collect(
        manager().spawn("todo:panel", {
          argv: ["wave-definitely-not-a-command"],
        }),
      ),
    ).rejects.toThrow(/ENOENT/);
  });

  it(
    "累计输出超过上限后停止读取并结束该进程",
    { timeout: 20_000 },
    async () => {
      // 写够 4 MiB + 1 字节：`processTotalBytes` 是累计字节数的上限。
      const overflow = MOD_LIMITS.processTotalBytes + 1;
      await expect(
        collect(
          manager().spawn("todo:panel", {
            argv: [
              process.execPath,
              "-e",
              `const s = 'x'.repeat(65536); for (let i = 0; i < ${Math.ceil(
                overflow / 65536,
              )}; i++) process.stdout.write(s);`,
            ],
          }),
        ),
      ).rejects.toThrow(/输出超过/);
    },
  );

  it("消费者提前 break 也会把进程杀掉（不留孤儿）", async () => {
    const mgr = manager();
    const gen = mgr.spawn("todo:panel", {
      argv: [process.execPath, "-e", PID_HANG_SCRIPT],
    });
    const first = await gen.next();
    const pid = Number(textOf([first.value as ModProcessChunk]).trim());
    expect(pid).toBeGreaterThan(0);

    // 只读一块就走：这就是 `for await (...) { break; }`。
    await gen.return({ code: null, signal: null });

    await vi.waitFor(() => {
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it(
    "一个 mod 最多同时跑 4 个进程，第 5 个报错",
    { timeout: 20_000 },
    async () => {
      const mgr = manager();
      const running = [];
      for (let i = 0; i < MOD_LIMITS.maxProcessesPerMod; i++) {
        const gen = mgr.spawn("todo:panel", {
          argv: [process.execPath, "-e", HANG_SCRIPT],
        });
        // 拉到第一块「ready」= 进程已经起来了且登记在册。
        await gen.next();
        running.push(gen);
      }

      await expect(
        collect(
          mgr.spawn("todo:panel", {
            argv: [process.execPath, "-e", "console.log('over')"],
          }),
        ),
      ).rejects.toThrow(new RegExp(`上限 ${MOD_LIMITS.maxProcessesPerMod}`));

      // 另一个 mod 有自己的额度：限额是 per-mod 的。
      const other = await collect(
        mgr.spawn("todo:other", {
          argv: [process.execPath, "-e", "console.log('ok')"],
        }),
      );
      expect(textOf(other.chunks)).toBe("ok\n");

      mgr.dispose();
      await Promise.all(
        running.map((gen) => gen.return({ code: null, signal: null })),
      );
    },
  );
});

describe("ModProcessManager.dispose / killAll", () => {
  it("dispose 杀掉还活着的进程，之后 spawn 一律报错", async () => {
    const mgr = manager();
    const gen = mgr.spawn("todo:panel", {
      argv: [process.execPath, "-e", PID_HANG_SCRIPT],
    });
    const first = await gen.next();
    const pid = Number(textOf([first.value as ModProcessChunk]).trim());
    expect(pid).toBeGreaterThan(0);

    mgr.dispose();

    await vi.waitFor(() => {
      expect(() => process.kill(pid, 0)).toThrow();
    });
    await expect(
      collect(
        mgr.spawn("todo:panel", {
          argv: [process.execPath, "-e", "console.log('late')"],
        }),
      ),
    ).rejects.toThrow(/会话已结束/);
    await gen.return({ code: null, signal: null });
  });
});

describe("ModProcessManager.spawn 的参数校验", () => {
  const invalid: Array<[string, unknown, RegExp]> = [
    ["缺 argv", {}, /argv 必须是非空数组/],
    ["argv 是空数组", { argv: [] }, /argv 必须是非空数组/],
    ["argv 含非字符串", { argv: ["node", 1] }, /只能包含字符串/],
    ["env 不是对象", { argv: ["node"], env: "X=1" }, /env 必须是对象/],
    ["input 不是字符串", { argv: ["node"], input: 1 }, /input 必须是字符串/],
    ["整体不是对象", null, /需要一个 \{ argv \} 参数/],
  ];

  for (const [name, options, message] of invalid) {
    it(name, async () => {
      await expect(
        collect(manager().spawn("todo:panel", options)),
      ).rejects.toThrow(message);
    });
  }
});
