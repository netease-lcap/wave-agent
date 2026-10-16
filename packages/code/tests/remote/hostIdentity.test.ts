import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock("node:fs", () => ({
  readFileSync: (filePath: string) => {
    const content = store.files.get(filePath);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
    }
    return content;
  },
}));

const proc = vi.hoisted(() => ({
  execFileSync: vi.fn<(file: string) => string>(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: proc.execFileSync,
}));

const auth = vi.hoisted(() => ({
  getAuthUser: vi.fn<() => { id: string } | undefined>(),
}));

vi.mock("wave-agent-sdk", () => ({
  authService: { getAuthUser: auth.getAuthUser },
}));

import {
  deriveHostId,
  readMachineId,
  uuidv5,
} from "../../src/remote/hostIdentity.js";

/**
 * One machine id, spelled the way all three platforms report it: the Linux file
 * the `node:fs` mock serves, plus an `ioreg` line *and* a `reg query` line that
 * the single `execFileSync` mock returns. That keeps `deriveHostId` (which takes
 * no platform argument) asserting the same value whichever platform the suite
 * runs on, without pinning the derivation to one OS.
 */
const MACHINE_ID = "11111111-2222-3333-4444-555555555555";
const EXEC_OUTPUT = [
  `"IOPlatformUUID" = "${MACHINE_ID}"`,
  `    MachineGuid    REG_SZ    ${MACHINE_ID}`,
].join("\n");

describe("hostIdentity", () => {
  beforeEach(() => {
    store.files.clear();
    store.files.set("/etc/machine-id", `${MACHINE_ID}\n`);
    proc.execFileSync.mockReturnValue(EXEC_OUTPUT);
    auth.getAuthUser.mockReturnValue({ id: "user-42" });
  });

  describe("uuidv5", () => {
    it("should match the RFC 4122 example vector", () => {
      // The canonical DNS-namespace vector, so this pins the algorithm (SHA-1
      // over namespace bytes + UTF-8 name, version/variant bits) rather than
      // whatever this implementation happens to produce.
      expect(
        uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com"),
      ).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    });

    it("should keep the UUID shape the relay's column expects", () => {
      const id = uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "some-machine");
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(id).toHaveLength(36);
    });
  });

  describe("readMachineId", () => {
    it("should read the Linux machine id, trimmed", () => {
      expect(readMachineId("linux")).toBe(MACHINE_ID);
    });

    it("should fall back to the dbus location when the first file is missing", () => {
      store.files.clear();
      store.files.set("/var/lib/dbus/machine-id", MACHINE_ID);

      expect(readMachineId("linux")).toBe(MACHINE_ID);
    });

    it("should give nothing when neither Linux file is readable", () => {
      store.files.clear();

      expect(readMachineId("linux")).toBeUndefined();
    });

    it("should read the platform UUID via ioreg on macOS", () => {
      expect(readMachineId("darwin")).toBe(MACHINE_ID);
      expect(proc.execFileSync).toHaveBeenCalledWith(
        "ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        expect.objectContaining({ encoding: "utf8" }),
      );
    });

    it("should give nothing when ioreg reports no platform UUID", () => {
      proc.execFileSync.mockReturnValue("no uuid here");

      expect(readMachineId("darwin")).toBeUndefined();
    });

    it("should read the machine GUID from the registry on Windows", () => {
      expect(readMachineId("win32")).toBe(MACHINE_ID);
      expect(proc.execFileSync).toHaveBeenCalledWith(
        "reg",
        expect.arrayContaining(["MachineGuid"]),
        expect.objectContaining({ encoding: "utf8" }),
      );
    });

    it("should swallow a failing platform query instead of failing the caller", () => {
      proc.execFileSync.mockImplementation(() => {
        throw new Error("command not found");
      });

      expect(readMachineId("darwin")).toBeUndefined();
      expect(readMachineId("win32")).toBeUndefined();
    });
  });

  describe("deriveHostId", () => {
    it("should be stable for one machine and account, and different per account", () => {
      const first = deriveHostId();
      expect(first).toBeDefined();
      expect(deriveHostId()).toBe(first);

      auth.getAuthUser.mockReturnValue({ id: "another-user" });
      expect(deriveHostId()).not.toBe(first);
    });

    it("should give nothing without an account id", () => {
      // Two OS users on one machine would otherwise derive the same id and fight
      // over a single row, so the account is part of the derivation.
      auth.getAuthUser.mockReturnValue(undefined);
      expect(deriveHostId()).toBeUndefined();

      auth.getAuthUser.mockReturnValue({ id: "" });
      expect(deriveHostId()).toBeUndefined();
    });

    it("should give nothing without a machine id", () => {
      store.files.clear();
      proc.execFileSync.mockReturnValue("");

      expect(deriveHostId()).toBeUndefined();
    });
  });
});
