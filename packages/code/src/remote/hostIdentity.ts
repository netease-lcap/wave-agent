/**
 * This machine's stable identity on the relay — the id it registers itself with.
 *
 * The channel is keyed by the machine. The old scheme let the relay mint that key
 * on first registration and kept it only in `~/.wave/remote-control.json`, so
 * losing that file (reinstall, fresh home, read-only home, another OS user)
 * registered a **second row for the same machine**: the phone then lists one
 * computer twice, and the page URL — the id is in it — changes with it. Deriving
 * the id here instead makes the same machine + same account always name the same
 * row, so registration is idempotent and a lost state file just re-claims it.
 *
 * Why the OS machine id and not the hostname: hostnames are renameable, shared,
 * and only ever a display label here (the `name` field). Why not a MAC address
 * (the intuition is "it should be stable like a MAC address"): modern systems
 * randomize it per network, a machine has several, and containers get a fresh
 * one — none of that is stable enough to key a database row on.
 *
 * When the machine id cannot be read (unsupported platform, permissions, a
 * container hiding it) this yields nothing and registration falls back to the
 * old path — the relay mints the id. Nothing fails; the machine merely stops
 * keeping its identity across a lost state file.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { authService } from "wave-agent-sdk";

/**
 * Namespace for every derived host id. **Changing it changes the identity of
 * every machine** — each one would register as a fresh row — so it only ever
 * moves together with a deliberate migration. Never add an input to the derived
 * name for the same reason.
 */
const HOST_ID_NAMESPACE = "9f0e1c72-1a9a-4e1c-8f4d-2b6d3c5a7e10";

/** Reading the platform's machine id must never hang a registration. */
const READ_TIMEOUT_MS = 2_000;

/** RFC 4122 version 5 (SHA-1) UUID over the UTF-8 name. */
export function uuidv5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(name, "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The id this machine should register with, or undefined when it cannot be
 * derived. Both inputs are required: without a machine id there is nothing
 * stable to derive from, and without the account id two OS users sharing one
 * machine would derive the *same* id and fight over one row (the row belongs to
 * an account, which is also how the relay scopes them).
 */
export function deriveHostId(): string | undefined {
  const machineId = readMachineId();
  const userId = authService.getAuthUser()?.id;
  if (!machineId || !userId) return undefined;
  return uuidv5(HOST_ID_NAMESPACE, `${machineId}\n${userId}`);
}

/** Best-effort read of the platform's machine id; never throws. */
export function readMachineId(
  platform: string = process.platform,
): string | undefined {
  try {
    if (platform === "darwin") return readDarwinMachineId();
    if (platform === "win32") return readWindowsMachineId();
    return readLinuxMachineId();
  } catch {
    // An unreadable / missing source is not an error worth surfacing: the
    // caller falls back to letting the relay mint the id.
    return undefined;
  }
}

/** Linux: the conventional systemd / dbus files, first one that reads. */
function readLinuxMachineId(): string | undefined {
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // Try the next location — neither file is guaranteed to exist.
    }
  }
  return undefined;
}

/** macOS: the platform UUID, which survives reboots and OS updates. */
function readDarwinMachineId(): string | undefined {
  const output = execFileSync(
    "ioreg",
    ["-rd1", "-c", "IOPlatformExpertDevice"],
    {
      encoding: "utf8",
      timeout: READ_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output)?.[1];
}

/** Windows: the registry's machine GUID. */
function readWindowsMachineId(): string | undefined {
  const output = execFileSync(
    "reg",
    ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
    {
      encoding: "utf8",
      timeout: READ_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(output)?.[1];
}
