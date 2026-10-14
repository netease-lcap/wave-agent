/**
 * `wave remote-control` — the operator's handle on the relay connection.
 *
 * Remote control is served by the **daemon**, not by whatever process the user
 * is typing in: the daemon is the resident host (it owns sessions across
 * client detach/attach and keeps generating while nothing is attached), and it
 * is the process whose emit fan-out the relay subscribes to. These subcommands
 * are therefore a client of the daemon socket, exactly like `wave daemon …` —
 * `on` starts a daemon on demand, `off`/`status` never do.
 *
 * The pairing code comes from registering this machine with the relay (an HTTP
 * call the daemon makes), not from a frame pushed down the WebSocket — the relay
 * never pushes one. So `on` may have to wait for a registration round trip and
 * everything it learned stays on the daemon, where `status` can pick it up.
 *
 * All subcommands are non-interactive (stdout for results, stderr for
 * diagnostics, exit code set here) — yargs would otherwise fall through to the
 * Ink TUI.
 */

import { toString as qrToString } from "qrcode";
import type { PairingInfo, RemoteControlSnapshot } from "wave-agent-sdk";
import {
  DEFAULT_DAEMON_SOCKET,
  connectDaemonIfRunning,
  connectDaemonOrExit,
} from "../daemon/commands.js";
import type { SocketClient } from "../daemon/socketClient.js";
import {
  buildPairingPageUrl,
  getRemoteControlStatePath,
} from "./remoteControlConfig.js";

/** How long `on` waits for the registration round trip to deliver a code. */
export const PAIRING_WAIT_MS = 5_000;
const PAIRING_POLL_MS = 500;

/**
 * A code is issued once, at registration, and expires in ten minutes. There is
 * no "show me another one" call, so the recovery is to register afresh.
 */
const PAIRING_RECOVERY_HINT = `配对码只在注册这台电脑时下发一次（10 分钟内有效）。需要重新配对时删除 ${getRemoteControlStatePath()} 后重跑 \`wave remote-control on\` —— 这会在中继上登记成一台新电脑（旧的那台仍留在中继的电脑列表里，可在电脑列表里吊销）。`;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The switch lives in settings, so a daemon started before it was turned on
 * cannot serve — and the error it returns says which key to set but not that
 * the running daemon has to be replaced for the change to take effect.
 */
function hintFor(message: string): string | undefined {
  if (!message.includes("enableRemoteControl")) return undefined;
  return 'Set "enableRemoteControl": true in ~/.wave/settings.json (or .wave/settings.json in the project), then run `wave daemon restart` — a daemon that was already running keeps its old settings.';
}

function printEnableHint(message: string): void {
  console.error(message);
  const hint = hintFor(message);
  if (hint) console.error(hint);
}

/**
 * Print the code, the page the phone should open, and a QR of that page.
 *
 * The options are Claude Code's bridge-dialog pair (`type: "utf8"`,
 * `errorCorrectionLevel: "L"`) minus its `small: true`, which is inert here:
 * node-qrcode reads `small` only in the *terminal* renderer, and `utf8` is
 * already the compact half-block form (`▀▄█`) with no ANSI — so the code stays
 * copyable out of a terminal. Encoding is the only thing that can fail (and only
 * for absurd input), and the code and the URL above are the real contract — a
 * missing QR is not worth failing the command.
 */
async function printPairing(pairing: PairingInfo): Promise<void> {
  console.log("");
  console.log(`配对码：${pairing.code}`);
  if (pairing.expiresAt) console.log(`有效期至：${pairing.expiresAt}`);

  const pageUrl = pairing.url ?? buildPairingPageUrl(pairing.code);
  if (!pageUrl) {
    console.log("在浏览器打开远程控制页并输入上面的配对码。");
    return;
  }
  console.log(`Web 页：${pageUrl}`);
  try {
    console.log(
      await qrToString(pageUrl, {
        type: "utf8",
        errorCorrectionLevel: "L",
      }),
    );
  } catch {
    // Nothing to add: the line above already carries the address.
  }
}

/** Poll the daemon until the registration round trip hands back a code. */
async function waitForPairing(
  client: SocketClient,
  initial: RemoteControlSnapshot,
): Promise<PairingInfo | undefined> {
  const deadline = Date.now() + PAIRING_WAIT_MS;
  let snapshot = initial;
  while (Date.now() < deadline) {
    if (snapshot.pairing) return snapshot.pairing;
    if (snapshot.state === "error") {
      printEnableHint(`远程控制连接失败：${snapshot.message ?? "未知错误"}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, PAIRING_POLL_MS));
    snapshot = (await client.request(
      "remoteControlStatus",
      {},
    )) as RemoteControlSnapshot;
  }
  return snapshot.pairing;
}

/**
 * Turn remote control on for this machine and show how to pair a phone.
 * Idempotent: running it while already online re-reads the current code.
 */
export async function remoteControlOnCommand(name?: string): Promise<void> {
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(DEFAULT_DAEMON_SOCKET);
    const connecting = (await client.request(
      "remoteControlConnect",
      name ? { name } : {},
    )) as RemoteControlSnapshot;

    if (connecting.state === "error") {
      printEnableHint(`远程控制开启失败：${connecting.message ?? "未知错误"}`);
      process.exit(1);
    }
    if (connecting.url) console.log(`远程控制中继：${connecting.url}`);

    const pairing = await waitForPairing(client, connecting);
    if (!pairing) {
      console.log("没有拿到配对码。");
      console.log(PAIRING_RECOVERY_HINT);
      process.exit(0);
    }
    await printPairing(pairing);
    console.log("");
    console.log("关闭远程控制：`wave remote-control off`");
  } catch (err) {
    printEnableHint(`wave remote-control on 失败：${describe(err)}`);
    process.exit(1);
  } finally {
    client?.dispose();
  }
  process.exit(0);
}

/**
 * Disconnect. Idempotent, and like `wave daemon stop` it never starts a daemon
 * — with nothing running there is nothing to turn off.
 */
export async function remoteControlOffCommand(): Promise<void> {
  const client = await connectDaemonIfRunning(DEFAULT_DAEMON_SOCKET);
  if (!client) {
    console.log("远程控制未开启（wave daemon 未运行）");
    process.exit(0);
  }
  try {
    await client.request("remoteControlDisconnect", {});
    console.log("远程控制已断开");
  } catch (err) {
    // "Not enabled" lands here too: the daemon has no relay at all, which is
    // the same end state the user asked for, so it is reported as success —
    // with the switch hint on stderr, because turning it on would change that.
    const message = describe(err);
    console.log(`远程控制已关闭（${message}）`);
    const hint = hintFor(message);
    if (hint) console.error(hint);
  } finally {
    client.dispose();
  }
  process.exit(0);
}

/** Report the connection state, and the pairing code when the relay gave one. */
export async function remoteControlStatusCommand(): Promise<void> {
  const client = await connectDaemonIfRunning(DEFAULT_DAEMON_SOCKET);
  if (!client) {
    console.log("状态：未开启（wave daemon 未运行）");
    process.exit(0);
  }
  let ok = true;
  try {
    const snapshot = (await client.request(
      "remoteControlStatus",
      {},
    )) as RemoteControlSnapshot;
    console.log(`状态：${snapshot.state}`);
    if (snapshot.url) console.log(`中继：${snapshot.url}`);
    if (snapshot.message) console.log(`说明：${snapshot.message}`);
    if (snapshot.pairing) await printPairing(snapshot.pairing);
    else if (snapshot.state !== "off") {
      console.log("配对码：无（注册时下发，10 分钟内有效）");
    }
  } catch (err) {
    // Unlike `off`, a status we could not read is a real failure: the daemon
    // may be an older build that predates this method.
    ok = false;
    printEnableHint(`读取远程控制状态失败：${describe(err)}`);
  } finally {
    client.dispose();
  }
  process.exit(ok ? 0 : 1);
}
