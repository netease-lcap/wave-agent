/**
 * `wave remote-control` — the operator's handle on the relay connection.
 *
 * These subcommands serve the **daemon**: it is the resident host (it owns
 * sessions across client detach/attach and keeps generating while nothing is
 * attached), and it is the process whose emit fan-out the relay subscribes to.
 * They are therefore a client of the daemon socket, exactly like `wave daemon …`
 * — `on` starts a daemon on demand, `off`/`status` never do.
 *
 * A session that lives in the *foreground* CLI process is out of reach from
 * here; that process serves itself through the TUI's `/remote-control` command
 * (see `remoteControlCliHost.ts`). The switch can be on for both at once without
 * either one covering the other's sessions.
 *
 * The page address a phone opens is assembled from this machine's channel key,
 * which the daemon got by registering with the relay (an HTTP call) — nothing is
 * pushed down the WebSocket for it. So `on` may have to wait for a registration
 * round trip, and everything it learned stays on the daemon, where `status` can
 * pick it up.
 *
 * All subcommands are non-interactive (stdout for results, stderr for
 * diagnostics, exit code set here) — yargs would otherwise fall through to the
 * Ink TUI.
 */

import { toString as qrToString } from "qrcode";
import type { RemoteControlSnapshot } from "wave-agent-sdk";
import {
  DEFAULT_DAEMON_SOCKET,
  connectDaemonIfRunning,
  connectDaemonOrExit,
} from "../daemon/commands.js";
import type { SocketClient } from "../daemon/socketClient.js";

/** How long `on` waits for the page address to come back from the daemon. */
export const PAGE_WAIT_MS = 5_000;
const PAGE_POLL_MS = 500;

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
 * Print the page the phone should open, and a QR of that page.
 *
 * The options are Claude Code's bridge-dialog pair (`type: "utf8"`,
 * `errorCorrectionLevel: "L"`) minus its `small: true`, which is inert here:
 * node-qrcode reads `small` only in the *terminal* renderer, and `utf8` is
 * already the compact half-block form (`▀▄█`) with no ANSI — so the code stays
 * copyable out of a terminal. Encoding is the only thing that can fail (and only
 * for absurd input), and the address printed above is the real contract — a
 * missing QR is not worth failing the command.
 */
async function printPageUrl(pageUrl: string): Promise<void> {
  console.log("");
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

/** Poll the daemon until the registration round trip hands back a page address. */
async function waitForPageUrl(
  client: SocketClient,
  initial: RemoteControlSnapshot,
): Promise<string | undefined> {
  const deadline = Date.now() + PAGE_WAIT_MS;
  let snapshot = initial;
  while (Date.now() < deadline) {
    if (snapshot.pageUrl) return snapshot.pageUrl;
    if (snapshot.state === "error") {
      printEnableHint(`远程控制连接失败：${snapshot.message ?? "未知错误"}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, PAGE_POLL_MS));
    snapshot = (await client.request(
      "remoteControlStatus",
      {},
    )) as RemoteControlSnapshot;
  }
  return snapshot.pageUrl;
}

/**
 * Turn remote control on for this machine and show the page a phone opens.
 * Idempotent: running it while already online re-reads the same address.
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

    const pageUrl = await waitForPageUrl(client, connecting);
    if (!pageUrl) {
      console.error("远程控制已连上，但没能从 daemon 拿到页面地址。");
      process.exit(1);
    }
    await printPageUrl(pageUrl);
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

/** Report the connection state, and the page address when there is one. */
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
    if (snapshot.message) console.log(`说明：${snapshot.message}`);
    if (snapshot.pageUrl) await printPageUrl(snapshot.pageUrl);
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
