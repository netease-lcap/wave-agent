/**
 * Bash 沙箱示例（`settings.json` 顶层 `sandbox` 段）
 *
 * 分两段，第一段不需要任何模型凭据，第二段需要：
 *
 *   1. 直接驱动 `SandboxManager`，让命令真的进 bwrap / sandbox-exec 跑一遍，
 *      逐条验证「哪些写被判掉、哪些读被判掉、出网通不通」。这一段的配置写在
 *      内存里，不读也不写你的 `settings.json`。
 *   2. 建一个临时工作目录并写 `.wave/settings.local.json`，让一个真实的 Agent
 *      去跑命令：沙箱内的 Bash 走「免确认」放行（`autoAllowBashIfSandboxed`），
 *      权限回调不该响，而边界照样在。
 *
 * 运行：`cd packages/agent-sdk && pnpm exec tsx examples/features/bash-sandbox-demo.ts`
 * 只跑第一段：加 `--boundary-only`（不需要模型凭据）。
 *
 * 前置：macOS 自带 `sandbox-exec`；Linux 需要 `bwrap` + `socat`（有 `rg` 更好，
 * read-deny 的通配要靠它展开）；Windows 不支持——与 Claude Code 保持一致，命令
 * 照常走普通权限流程。缺依赖时这段示例会先把「不可用原因」打出来。
 *
 * 另有一种「依赖齐、沙箱却起不来」：`sandbox-runtime` 在 Linux 上会先用一个
 * seccomp 辅助进程（`apply-seccomp`）建嵌套 user namespace 来挡住 AF_UNIX 套接字，
 * 有些内核不允许这一步（写 `/proc/self/setgroups` 被拒），于是所有命令在启动前
 * 就失败。此时所有探针都会「失败」，看起来像边界生效而其实命令没执行——示例会先
 * 做预检并说明白，不把它当成边界结论；想看边界可以加 `--allow-unix-sockets`
 * （不装那个过滤器，只读挂载 / 读写 deny / 断网照旧，代价是 AF_UNIX 不拦）。
 *
 * 开关归属：主开关 `sandbox.enabled` 只认用户自己的 `~/.wave/settings.json`（或
 * 服务端下发层）。工作目录里的 `settings.local.json` 只能补别的字段，仓库被克隆
 * 之后改不动你的边界；本示例的临时目录里没有用户级配置，所以它能生效。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../../src/index.js";
import { SandboxManager } from "../../src/sandbox/SandboxManager.js";
import { getRgPath } from "../../src/utils/ripgrep.js";
import type { WaveConfiguration } from "../../src/types/configuration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Probe {
  /** 打印在结果行前面的说明。 */
  label: string;
  command: string;
  /** 沙箱正常工作时这条命令该是什么结果。 */
  expect: "run" | "blocked";
}

/** 一条命令在沙箱里的实测结果。 */
interface ProbeResult {
  probe: Probe;
  exitCode: number | null;
  output: string;
}

function printProbe(result: ProbeResult): void {
  const { probe, exitCode, output } = result;
  const ran = exitCode === 0;
  const ok = probe.expect === "run" ? ran : !ran;
  const verdict = ran ? "跑通了" : `被挡下（exit ${exitCode}）`;
  console.log(`${ok ? "✅" : "❌"} ${probe.label} — ${verdict}`);
  const firstLine = output
    .trim()
    .split("\n")
    .find((line) => line.trim());
  if (firstLine) console.log(`     ↳ ${firstLine.trim().slice(0, 160)}`);
}

/**
 * 包装器自己还没跑起来就失败时的特征串。
 *
 * 容器 / CI 里常见「嵌套 user namespace 被限制」：`bwrap` 能起，但沙箱自带的
 * `apply-seccomp` 拿不到 `CAP_SYS_ADMIN`。这时候所有探针都会失败，看起来像
 * 「边界生效」，其实是命令根本没执行 —— 必须说清楚，别让人把环境问题当结论。
 */
function isEnvironmentLimit(output: string): boolean {
  return /apply-seccomp|nested userns|setgroups|Operation not permitted/i.test(
    output,
  );
}

interface PreflightResult {
  /** 包装器能否真的把命令跑起来。 */
  started: boolean;
  /** 失败时的第一行报错。 */
  detail: string;
}

/**
 * 预检：先在沙箱里跑一条 `true`。
 *
 * 包装器自己起不来时，后面所有探针都会失败，看起来像「边界生效」，其实是命令
 * 根本没执行。必须先问一句「沙箱能不能起」，再谈边界。
 */
async function preflightSandbox(
  manager: SandboxManager,
  workdir: string,
): Promise<PreflightResult> {
  const wrapped = await manager.wrap("true", "/bin/bash", "preflight");
  if (!wrapped) return { started: false, detail: "包装失败" };

  const tempDir = manager.prepareTempDir();
  const result = spawnSync(wrapped, {
    shell: "/bin/bash",
    cwd: workdir,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir },
  });
  manager.cleanup();
  if (result.status === 0) return { started: true, detail: "" };
  const firstLine = (result.stderr || result.stdout || "")
    .trim()
    .split("\n")[0];
  return { started: false, detail: firstLine ?? `exit ${result.status}` };
}

/**
 * 在沙箱里跑一批命令。
 *
 * 与 Bash 工具的生产路径一致：`SandboxManager.wrap()` 产出包装后的命令，交给
 * shell 执行，并把 `TMPDIR` 指到沙箱专用临时目录（沙箱只对那个目录开放写）。
 */
async function runInSandbox(
  manager: SandboxManager,
  workdir: string,
  probes: Probe[],
): Promise<void> {
  const tempDir = manager.prepareTempDir();

  for (const [index, probe] of probes.entries()) {
    const commandId = `demo_${index}`;
    const wrapped = await manager.wrap(probe.command, "/bin/bash", commandId);
    if (!wrapped) {
      console.log(`⚠️  包装失败，跳过「${probe.label}」`);
      continue;
    }
    const result = spawnSync(wrapped, {
      shell: "/bin/bash",
      cwd: workdir,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir },
    });
    printProbe({
      probe,
      exitCode: result.status,
      // 违规回注：生产路径里这段会被拼进工具结果，模型才知道是沙箱拦的。
      output: manager.annotate(commandId, result.stderr ?? ""),
    });
    manager.cleanup();
  }
}

/** 第一段：不碰模型，只看边界。 */
async function demoBoundary(allowUnixSockets: boolean): Promise<void> {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-sandbox-demo-"));
  const secretDir = path.join(workdir, "secret");
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(secretDir, "credentials.txt"), "DEMO_SECRET\n");
  fs.mkdirSync(path.join(workdir, ".wave"), { recursive: true });

  const escapePath = path.join(os.homedir(), "wave-sandbox-demo-escape.txt");
  fs.rmSync(escapePath, { force: true });

  const configuration: WaveConfiguration = {
    sandbox: {
      enabled: true,
      network: { allowedDomains: [], allowAllUnixSockets: allowUnixSockets },
      filesystem: {
        // 相对路径按工作目录解析。
        denyRead: ["secret"],
        allowWrite: ["scratch"],
      },
    },
  };
  const manager = new SandboxManager({
    getConfiguration: () => configuration,
    workdir,
    getRgPath: () => getRgPath(),
  });

  console.log(`工作目录：${workdir}\n`);

  const unavailable = manager.getUnavailableReason();
  if (unavailable) {
    console.log(`⚠️  沙箱当前不可用：${unavailable}`);
    console.log(
      "   这段示例需要真机依赖（macOS 自带；Linux: apt install bubblewrap socat）。\n",
    );
    fs.rmSync(workdir, { recursive: true, force: true });
    return;
  }

  const decision = await manager.decide("echo hi");
  console.log(
    `判定：${decision.sandboxed ? "进沙箱" : `不进沙箱（${decision.reason}）`}`,
  );
  if (!decision.sandboxed) {
    fs.rmSync(workdir, { recursive: true, force: true });
    return;
  }

  // 预检：先跑一条 `true`。包装器自己起不来时所有探针都会失败，看起来像
  // 「边界生效」，所以必须先把这种情况识别出来、直接收工。
  const preflight = await preflightSandbox(manager, workdir);
  if (!preflight.started && isEnvironmentLimit(preflight.detail)) {
    console.log(
      "\n⚠️  当前环境跑不了沙箱：seccomp 辅助进程起不来（内核不允许它建嵌套 user namespace）。",
    );
    console.log("   这不常见，也不是本仓的边界结论。");
    console.log(`   原始报错：${preflight.detail}`);
    if (!allowUnixSockets) {
      console.log(
        "\n   想看边界可以加 `--allow-unix-sockets`：不装那个过滤器，沙箱照旧",
      );
      console.log(
        "   （只读挂载 / 读写 deny / 断网都在），代价是 AF_UNIX 套接字不拦。",
      );
    }
    fs.rmSync(workdir, { recursive: true, force: true });
    return;
  }
  if (!preflight.started) {
    console.log(`\n⚠️  沙箱起不来，跳过探针：${preflight.detail}`);
    fs.rmSync(workdir, { recursive: true, force: true });
    return;
  }

  console.log("\n--- 沙箱内实测 ---");
  await runInSandbox(manager, workdir, [
    {
      label: "写工作目录",
      command: "echo ok > inside.txt",
      expect: "run",
    },
    {
      label: "写工作目录下的 allowWrite 目录（scratch/）",
      command: "mkdir -p scratch && echo ok > scratch/note.txt",
      expect: "run",
    },
    {
      label: "写工作目录之外（~ 下的普通路径）",
      command: `echo leak > "${escapePath}"`,
      expect: "blocked",
    },
    {
      label: "改本目录的 sandbox 配置（.wave/settings.json 在 denyWrite 里）",
      command: `echo '{"sandbox":{"enabled":false}}' > .wave/settings.json`,
      expect: "blocked",
    },
    {
      label: "读 denyRead 里的 secret/credentials.txt（文件其实存在）",
      command: "cat secret/credentials.txt",
      expect: "blocked",
    },
    {
      label: "出网（allowedDomains 为空 = 全禁）",
      command:
        'curl -sS -m 5 -o /dev/null -w "%{http_code}" https://example.com',
      expect: "blocked",
    },
  ]);

  // 白名单是「域名 + 端口逐个放行」：放开一个域名不会顺带放开别的。
  console.log("\n--- 同一个工作目录，把 example.com 加进白名单 ---");
  configuration.sandbox!.network = {
    ...configuration.sandbox!.network,
    allowedDomains: ["example.com"],
  };
  manager.refresh();
  await runInSandbox(manager, workdir, [
    {
      label: "访问白名单域名 example.com",
      command:
        'curl -sS -m 8 -o /dev/null -w "%{http_code}" https://example.com',
      expect: "run",
    },
    {
      label: "访问白名单之外的 api.github.com",
      command:
        'curl -sS -m 8 -o /dev/null -w "%{http_code}" https://api.github.com',
      expect: "blocked",
    },
  ]);

  // 判定层的两条旁路：不进沙箱，但决定命令怎么跑。
  console.log("\n--- 判定层（policy） ---");
  const policyAndSandbox = new SandboxManager({
    getConfiguration: () => ({
      sandbox: { enabled: true, excludedCommands: ["docker *"] },
    }),
    workdir,
  });
  for (const command of ["docker ps", "npm test"]) {
    const result = await policyAndSandbox.decide(command);
    console.log(
      `• ${command} → ${result.sandboxed ? "进沙箱" : `不进沙箱（${result.reason}）`}`,
    );
  }
  const modelAsked = await manager.decide("echo hi", true);
  console.log(
    `• echo hi（带 dangerouslyDisableSandbox）→ ${
      modelAsked.sandboxed ? "仍进沙箱" : `不进沙箱（${modelAsked.reason}）`
    }`,
  );

  fs.rmSync(escapePath, { force: true });
  fs.rmSync(workdir, { recursive: true, force: true });
}

/** 第二段：让真实 Agent 去跑，验证「沙箱内免确认 + 边界仍在」。 */
async function demoAgent(allowUnixSockets: boolean): Promise<void> {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-sandbox-agent-"));
  const escapePath = path.join(os.homedir(), "wave-sandbox-demo-escape.txt");
  fs.rmSync(escapePath, { force: true });
  fs.mkdirSync(path.join(workdir, ".wave"), { recursive: true });
  fs.writeFileSync(
    path.join(workdir, ".wave", "settings.local.json"),
    `${JSON.stringify(
      {
        sandbox: {
          enabled: true,
          // 沙箱内的 Bash 不再弹确认：这才是沙箱真正省下来的东西。
          autoAllowBashIfSandboxed: true,
          network: {
            allowedDomains: [],
            allowAllUnixSockets: allowUnixSockets,
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  let agent: Agent | undefined;
  let prompted = 0;
  let answer = "";
  let finishTurn: (() => void) | undefined;
  let sawLoading = false;
  const errors: string[] = [];

  try {
    agent = await Agent.create({
      workdir,
      permissionMode: "default",
      // 故意不给 Bash 预置 allow 规则：这一段的看点是「沙箱内的 Bash 凭什么
      // 免确认」——只会从沙箱门（autoAllowBashIfSandboxed）放行。
      canUseTool: async (context) => {
        prompted += 1;
        console.log(`   🔐 权限回调：${context.toolName} 请求确认`);
        return { behavior: "allow" };
      },
      callbacks: {
        onAssistantContentUpdated: ({ chunk }) => {
          answer += chunk;
        },
        onToolBlockUpdated: ({ name, stage, success, error }) => {
          if (stage === "running") console.log(`   🔧 ${name} 运行中`);
          if (stage === "end") {
            console.log(
              `   ${success === false ? "⛔" : "✅"} ${name}：${
                error?.slice(0, 140) ?? "执行完成"
              }`,
            );
          }
        },
        onErrorBlockAdded: (error) => {
          errors.push(error);
        },
        onLoadingChange: (loading) => {
          if (loading) sawLoading = true;
          else if (sawLoading) finishTurn?.();
        },
      },
      logger: {
        debug: () => {},
        info: () => {},
        warn: (message) => console.log(`   ⚠️  ${message}`),
        error: (message) => console.log(`   ❌ ${message}`),
      },
    });

    const turnDone = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("模型在 180 秒内没有跑完")),
        180_000,
      );
      finishTurn = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    // 与上面写进 `.wave/settings.local.json` 的配置一致：先预检一次，用来判断
    // 「文件没被创建」是边界生效，还是沙箱在这台机器上根本起不来。
    const preflight = await preflightSandbox(
      new SandboxManager({
        getConfiguration: () => ({
          sandbox: { enabled: true, network: { allowedDomains: [] } },
        }),
        workdir,
        getRgPath: () => getRgPath(),
      }),
      workdir,
    );

    // `sendMessage` 返回的是「已经交给 Agent」，一轮跑完要等 loading 落地。
    await agent.sendMessage(
      [
        "请用 Bash 工具依次执行这两条命令，然后把两次的退出码告诉我：",
        "1) echo ok > inside.txt",
        `2) echo leak > "${escapePath}"`,
        "不要使用其他工具，也不要解释命令内容。",
      ].join("\n"),
    );
    await turnDone;

    console.log(`\n模型回复：${answer.trim().slice(0, 400)}`);
    if (errors.length > 0) {
      console.log(`错误块：${errors.join(" / ").slice(0, 300)}`);
    }
    console.log(
      `\n权限回调命中次数：${prompted}（期望 0：沙箱内的 Bash 直接放行）`,
    );
    console.log(
      `工作目录内 inside.txt：${
        fs.existsSync(path.join(workdir, "inside.txt")) ? "已创建" : "没创建"
      }`,
    );
    console.log(
      `工作目录外 escape 文件：${
        fs.existsSync(escapePath)
          ? "被创建了（边界失效！）"
          : "没创建（边界生效）"
      }`,
    );
    if (!preflight.started) {
      console.log(
        `\n⚠️  但这台机器上沙箱起不来（${preflight.detail}），所以「没创建」不能算边界生效的证据。`,
      );
      if (isEnvironmentLimit(preflight.detail)) {
        console.log(
          "   seccomp 辅助进程起不来：加 `--allow-unix-sockets` 再看一遍。",
        );
      }
    }
  } catch (error) {
    console.log(
      `\n⏭️  跳过这一段（需要可用的模型凭据）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    finishTurn = undefined;
    await agent?.destroy();
    fs.rmSync(escapePath, { force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  // `--boundary-only`：只跑第一段。没有模型凭据时用它，或者只想看边界时用它。
  const boundaryOnly = process.argv.includes("--boundary-only");
  // `--allow-unix-sockets`：不装 seccomp 过滤器。有些内核上这个过滤器的辅助进程
  // 起不来（写不了 /proc/self/setgroups），整条沙箱就都跑不了；打开它沙箱照旧，
  // 只是不再拦 AF_UNIX 套接字。
  const allowUnixSockets = process.argv.includes("--allow-unix-sockets");

  console.log("🧪 Wave Agent SDK — Bash 沙箱示例\n");

  console.log("=== 1. 边界实测（不需要模型） ===");
  await demoBoundary(allowUnixSockets);

  if (boundaryOnly) {
    process.exit(0);
  }

  console.log("\n=== 2. Agent 落地（需要模型凭据） ===");
  await demoAgent(allowUnixSockets);

  process.exit(0);
}

void main();
