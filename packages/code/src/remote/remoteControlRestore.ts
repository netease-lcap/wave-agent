/**
 * 把远程控制开关带过 `wave daemon restart`（spec: daemon-command.md「停止与重启
 * daemon」场景 7、remote-control.md「开关语义」场景 6）。
 *
 * 为什么需要这一层：开关真正待的地方是 **daemon 进程内的 `RemoteControlService`
 * 实例**（`remoteControlSink.ts` 在 `--daemon` 启动时按 `enableRemoteControl`
 * 建出来、但不拨号；拨号是 `remoteControlConnect` 的动作）。所以 restart 换掉
 * 进程就等于把「已连接」这件事一起丢掉——升级 CLI 之后每次都要手动再
 * `wave remote-control on` 一次（2026-11-13 实际发生）。
 *
 * 两个动作，都只走 daemon 已有的 RPC：
 *
 * 1. **stop 之前采样**（`sampleRemoteControlState`）。必须在 stop 之前，因为
 *    stop 之后进程没了、状态已经不可得；也因此采样必须用
 *    `connectDaemonIfRunning` 那种「连不上就算了」的连接——采样绝不能顺手拉起
 *    一个 daemon。
 * 2. **新 daemon 起来之后恢复**（`restoreRemoteControl`）。走的正是
 *    `wave remote-control on` 用的那条 `remoteControlConnect` RPC，**不带**那
 *    条命令的页面地址 / 二维码输出——restart 的输出不该被横幅污染。
 *
 * **「用户想开着」这个意图刻意不落盘。** `~/.wave/remote-control.json` 只存
 * 机器身份（hostId / hostToken / name），它每次进程启动都会被读到；再往里塞一个
 * 「上次是开的」标记，等于给「进程启动时自动拨号」准备了一份持久化依据——那正是
 * 本功能绝不能带来的东西（用户刚把开机自启删掉，改成需要时手动开）。所以意图只
 * 从**当前这次 restart 的采样**得到，只活在这一次命令的局部变量里：开机、
 * 以及其它子命令「连接失败时按需拉起」的路径都不采样、也不恢复。
 *
 * 那个文件在这里**只被读一个 name 标签**（`readStoredRemoteControlName`，由调用
 * 方传进来）：name 只骑在 `hostHello` 帧上，fresh daemon 的 `RemoteControlService.name`
 * 是 undefined，不带上手机端那一行就掉了名字。读 name **不会**变成开机自启——
 * 读它的只有 `daemon restart` 这一条路径、读到的只是一个显示名，文件里既没有
 * 「上次是开的」标记，也没有任何进程启动路径读过它；本模块也不写这个文件。
 */

import type { RemoteControlSnapshot, RemoteControlState } from "wave-agent-sdk";
import type { SocketClient } from "../daemon/socketClient.js";

/**
 * 恢复动作的时间预算。**单次拨号**，最多等它 `attemptTimeoutMs`：daemon 自己已经
 * 有一轮有界退避重试（remote-channel.md），CLI 再叠一层没有意义，只会把
 * `wave daemon restart` 拖长。最坏约 4 秒，正常情况（中继通）是几百毫秒。
 * （可变是为了让测试缩短它。）
 */
export const remoteRestorePolicy = {
  /** 发一次拨号后，等它落到 `online` 的上限。 */
  attemptTimeoutMs: 4_000,
  /** 轮询间隔。 */
  pollIntervalMs: 200,
};

/**
 * stop 之前问一次「当时是什么状态」。读不出来（更旧的 daemon 不认识这个 RPC、
 * 或那个进程根本没开 `enableRemoteControl`）就当作「本来就没开」——restart 是主
 * 目标，采样只是加分项，绝不因此失败。
 */
export async function sampleRemoteControlState(
  client: SocketClient,
): Promise<RemoteControlState | undefined> {
  try {
    const snapshot = (await client.request(
      "remoteControlStatus",
      {},
    )) as RemoteControlSnapshot;
    return snapshot.state;
  } catch {
    return undefined;
  }
}

/**
 * 采样结果是否等于「用户上次把它打开了」。只认 `online` 与 `connecting`。
 *
 * `error` 刻意排除：这个功能的语义是**保持状态**，不是**重试修复**。`error` 常见于
 * hostToken 被吊销 / 过期（那对凭证只有 90 天生命，而且可撤销），此时替用户重拨只
 * 会变成「每升一次级报一次错」的噪音；真开着且健康的机器落不到 `error`。`off` 与
 * 读不到（`undefined`）同样不恢复——宁可不拨，也不要凭一个猜出来的意图把连接拨
 * 出去。
 */
export function shouldRestoreRemoteControl(
  state: RemoteControlState | undefined,
): boolean {
  return state === "online" || state === "connecting";
}

export interface RemoteRestoreResult {
  /** 是否以 `online` 收尾。 */
  ok: boolean;
  /** 没成功时的原因（给 stderr 告警用），成功时不存在。 */
  reason?: string;
  /**
   * 这一次拨号在预算内没有落定，仍是 `connecting`。这**不等于**拨号失败：服务自己
   * 还在一个有界重试窗口里继续拨（见 remote-channel.md 的退避规则），所以给出的
   * 建议是「查状态」而不是「重新开」——再拨一次会把一条可能正要连上的链路推倒。
   */
  retrying?: boolean;
}

/**
 * 让新起来的 daemon 重新连上中继。**只拨一次**——服务的退避重试归 daemon 自己
 * （remote-channel.md），CLI 陪着等只会把 `daemon restart` 拖长。
 *
 * `remoteControlConnect` 的应答是**拨号刚开始**的快照（`connecting`），所以真正的
 * 判定要看后续轮询；四种收尾：
 *
 * - `online` ⇒ 成功（应答已经是 `online` 时连一次轮询都不花）；
 * - 轮询到 `error` ⇒ 失败，用 daemon 给的那句话当原因（中继拒绝、登记失败）；
 * - 预算走完仍是 `connecting` ⇒ 标 `retrying`：既不是成功也不是确定的失败，服务
 *   还在自己的窗口里继续拨，调用方该建议「查状态」而不是「重新开」；
 * - RPC 本身失败（新 daemon 没开 `enableRemoteControl`、或更旧的 daemon 不认识
 *   这个方法）⇒ 立刻失败——这里没有重试，所以「立刻」是字面意思。
 *
 * `name` 是上次登记时发给中继的显示名（`readStoredRemoteControlName`）：fresh
 * daemon 还没有自己的 `name`，不带上的话手机端那一行会掉名字。
 */
export async function restoreRemoteControl(
  client: SocketClient,
  name?: string,
): Promise<RemoteRestoreResult> {
  let greeting: RemoteControlSnapshot;
  try {
    greeting = (await client.request(
      "remoteControlConnect",
      name ? { name } : {},
    )) as RemoteControlSnapshot;
  } catch (err) {
    return { ok: false, reason: describe(err) };
  }
  if (greeting.state === "online") return { ok: true };

  let settled = greeting;
  if (greeting.state === "connecting") {
    try {
      settled = await waitForSettled(client);
    } catch (err) {
      return { ok: false, reason: describe(err) };
    }
  }

  if (settled.state === "online") return { ok: true };
  if (settled.state === "connecting") {
    return {
      ok: false,
      reason: "no answer from the relay yet",
      retrying: true,
    };
  }
  return {
    ok: false,
    reason: settled.message ?? "the relay refused the connection",
  };
}

/** 轮询到这一次拨号落定（`online` / `error`），或把本次的预算走完。 */
async function waitForSettled(
  client: SocketClient,
): Promise<RemoteControlSnapshot> {
  let snapshot: RemoteControlSnapshot = { state: "connecting" };
  const deadline = Date.now() + remoteRestorePolicy.attemptTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(remoteRestorePolicy.pollIntervalMs);
    snapshot = (await client.request(
      "remoteControlStatus",
      {},
    )) as RemoteControlSnapshot;
    if (snapshot.state === "online" || snapshot.state === "error") {
      return snapshot;
    }
  }
  return snapshot;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
