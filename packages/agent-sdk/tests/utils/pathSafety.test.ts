import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isCriticalSystemDirectory,
  isFilesystemRoot,
  isHomeDirectoryPath,
  isPathAtOrAbove,
  isPathInside,
} from "../../src/utils/pathSafety.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs");

const WINDOWS = process.platform === "win32";

/**
 * Stand in for `fs.realpathSync.native` — the call the guard makes.
 *
 * The JavaScript `realpathSync` leaves the 8.3 short spelling of a path alone,
 * so it could never be recognised as the directory it names; every resolution in
 * `pathSafety` goes through the native call, and that is what the tests mock.
 */
function mockRealPath(impl: (p: string) => string): void {
  vi.mocked(fs.realpathSync.native).mockImplementation((target) =>
    impl(target.toString()),
  );
}

/** The error both platforms raise for "nothing there". */
function absent(p: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${p}`), {
    code: "ENOENT",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRealPath((p) => p);
});

describe("pathSafety utils", () => {
  describe("isPathInside", () => {
    it("should return true if target is the same as parent", () => {
      expect(isPathInside("/a/b", "/a/b")).toBe(true);
    });

    it("should return true if target is a subdirectory of parent", () => {
      expect(isPathInside("/a/b/c", "/a/b")).toBe(true);
    });

    it("should return false if target is outside parent", () => {
      expect(isPathInside("/a/c", "/a/b")).toBe(false);
    });

    it("should return false if target is parent of parent", () => {
      expect(isPathInside("/a", "/a/b")).toBe(false);
    });

    it("should handle symlinks correctly", () => {
      mockRealPath((p) => (p === path.resolve("/link") ? "/a/b/c" : p));
      expect(isPathInside("/link", "/a/b")).toBe(true);
    });

    it("should return true if target doesn't exist but its parent is inside", () => {
      mockRealPath((p) => {
        if (p === path.resolve("/a/b/new")) throw absent(p);
        return p;
      });
      expect(isPathInside("/a/b/new", "/a/b")).toBe(true);
    });

    it("should return false if target doesn't exist and its parent is outside", () => {
      mockRealPath((p) => {
        if (p === path.resolve("/a/c/new")) throw absent(p);
        return p;
      });
      expect(isPathInside("/a/c/new", "/a/b")).toBe(false);
    });

    it("should handle relative paths", () => {
      // path.resolve will use current working directory for relative paths
      expect(isPathInside("child", ".")).toBe(true);
    });

    it("should return false for paths that look similar but are not inside", () => {
      expect(isPathInside("/a/foobar", "/a/foo")).toBe(false);
    });

    it("should resolve through the native realpath, not the JS one", () => {
      // The JS implementation leaves 8.3 short names alone, so a guard built on
      // it cannot recognise `C:\Users\LIUYIQ~1` as the profile. Only `.native`
      // is consulted; a fallback to the JS call would resolve the link here.
      mockRealPath((p) => (p === path.resolve("/link") ? "/a/b/c" : p));
      expect(isPathInside("/link", "/a/b")).toBe(true);
      expect(fs.realpathSync).not.toHaveBeenCalled();
    });

    it("should keep the spelling when the path cannot be probed at all", () => {
      // EACCES / ELOOP: guessing a parent here would turn an unreachable path
      // into an ordinary-looking one, and every caller compares real paths.
      mockRealPath((p) => {
        throw Object.assign(new Error(`EACCES: ${p}`), { code: "EACCES" });
      });
      expect(isPathInside("/a/b", "/a/b")).toBe(true);
      expect(isPathInside("/a/b/c", "/a/b")).toBe(true);
      expect(isPathInside("/a/c", "/a/b")).toBe(false);
    });

    it("should mirror the relation for isPathAtOrAbove", () => {
      expect(isPathAtOrAbove("/a/b", "/a/b/c")).toBe(true);
      expect(isPathAtOrAbove("/a/b/c", "/a/b")).toBe(false);
    });
  });

  describe("isFilesystemRoot", () => {
    it("should recognise the root of the current platform", () => {
      expect(isFilesystemRoot(path.parse(process.cwd()).root)).toBe(true);
      expect(
        isFilesystemRoot(path.join(path.parse(process.cwd()).root, "a")),
      ).toBe(false);
    });
  });

  describe("isHomeDirectoryPath", () => {
    it("should recognise the home directory it is given", () => {
      expect(isHomeDirectoryPath(os.homedir())).toBe(true);
      expect(isHomeDirectoryPath(path.join(os.homedir(), "project"))).toBe(
        false,
      );
    });

    it("should follow a symlink into the home directory", () => {
      // The comparison is on resolved paths, so the spelling of the link does
      // not matter — only what the filesystem says it points at.
      const home = process.env.USERPROFILE ?? os.homedir();
      const link = path.resolve(path.sep, "fake", "home-link");
      mockRealPath((p) => (p === link ? home : p));
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
      try {
        expect(isHomeDirectoryPath(link)).toBe(true);
      } finally {
        homedirSpy.mockRestore();
      }
    });

    it("should compare case-insensitively only where the platform does", () => {
      // `C:\USERS\ME` is the profile on Windows and a different directory on
      // POSIX. Asserted in both directions rather than skipped off Windows.
      const home = path.resolve(path.sep, "Users", "me");
      const shouted = path.resolve(path.sep, "USERS", "ME");
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
      try {
        expect(isHomeDirectoryPath(shouted)).toBe(WINDOWS);
      } finally {
        homedirSpy.mockRestore();
      }
    });

    it("should ignore a trailing separator on either side", () => {
      // realpath can hand back a trailing separator; without stripping it the
      // comparison would miss the home directory it just resolved.
      const home = path.resolve(path.sep, "Users", "me");
      mockRealPath((p) => (p === home ? home + path.sep : p));
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
      try {
        expect(isHomeDirectoryPath(home)).toBe(true);
      } finally {
        homedirSpy.mockRestore();
      }
    });
  });

  describe("isCriticalSystemDirectory", () => {
    it("should refuse a filesystem root", () => {
      expect(isCriticalSystemDirectory(path.parse(process.cwd()).root)).toBe(
        true,
      );
    });

    it("should refuse a first-level directory by name", () => {
      for (const name of ["etc", "usr/bin", "lib", "bin"]) {
        expect(
          isCriticalSystemDirectory(
            path.join(path.parse(process.cwd()).root, name),
          ),
        ).toBe(true);
      }
    });

    it("should refuse a first-level name that resolves elsewhere", () => {
      // The name list is written in first-level names, and those names are
      // symlinks on several systems: `/etc`, `/tmp` and `/var` point into
      // `/private` on macOS, and `/lib` into `/usr/lib` under usrmerge. Reading
      // only the resolved path loses the very entry it looks up. (On Windows
      // this case is answered by the drive-first-level rule before the name list
      // is reached, so it is the POSIX ladder that this pins.)
      const root = path.parse(process.cwd()).root;
      const etc = path.join(root, "etc");
      const lib = path.join(root, "lib");
      const link = path.join(root, "srv", "usr-link");
      mockRealPath((p) => {
        if (p === etc) return path.join(root, "private", "etc");
        if (p === lib) return path.join(root, "usr", "lib");
        if (p === link) return path.join(root, "usr");
        return p;
      });

      expect(isCriticalSystemDirectory(etc)).toBe(true);
      expect(isCriticalSystemDirectory(lib)).toBe(true);
      // The other half still answers: a link *into* a critical tree counts too.
      expect(isCriticalSystemDirectory(link)).toBe(true);
    });

    it("should allow a path below a first-level directory", () => {
      const deep = path.join("usr", "local", "lib", "x");
      expect(
        isCriticalSystemDirectory(
          path.join(path.parse(process.cwd()).root, deep),
        ),
      ).toBe(false);
    });

    it("should refuse any drive's first-level directory", () => {
      // Deliberate, and not a false positive: `D:\media` and `E:\tmp` are as
      // unrecoverable as `C:\Windows` when they are the only copy. This is also
      // why `rm -rf D:/myrepo` cannot be waved through as "some folder".
      for (const target of ["D:\\media", "E:\\tmp", "D:/media", "C:\\Users"]) {
        expect(isCriticalSystemDirectory(target)).toBe(true);
      }
    });

    it("should allow a directory below a drive's first level", () => {
      for (const target of ["D:\\media\\photos", "D:/myrepo/build"]) {
        expect(isCriticalSystemDirectory(target)).toBe(false);
      }
    });

    it("should refuse device and namespace paths", () => {
      // There is no directory behind `\\.\PhysicalDrive0`, so "what is the real
      // path of this" is the wrong question — it is refused, not resolved.
      for (const target of [
        "\\\\.\\PhysicalDrive0",
        "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1",
        "\\\\?\\D:\\media",
      ]) {
        expect(isCriticalSystemDirectory(target)).toBe(true);
      }
    });

    it("should refuse a share that is a whole disk", () => {
      // `<letter>$` / `admin$` name another machine's entire drive.
      for (const target of [
        "\\\\nas\\admin$\\data",
        "\\\\nas\\D$\\data",
        "//nas/D$/data",
      ]) {
        expect(isCriticalSystemDirectory(target)).toBe(true);
      }
      expect(isCriticalSystemDirectory("\\\\nas\\share\\data")).toBe(false);
    });
  });
});

describe("the 8.3 spelling of a directory", () => {
  it.runIf(WINDOWS)(
    "recognises the short form of the home directory as the home directory",
    () => {
      // `C:\Users\LIUYIQ~1` is what `%TEMP%` and `os.tmpdir()` can return. The
      // native realpath expands it; the JS one does not, and comparing the two
      // spellings as strings is how "delete the profile" gets through.
      const short = "C:\\Users\\LIUYIQ~1";
      const long = "C:\\Users\\liuyiqi02";
      mockRealPath((p) => (p.toLowerCase() === short.toLowerCase() ? long : p));
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(long);
      try {
        expect(isHomeDirectoryPath(short)).toBe(true);
      } finally {
        homedirSpy.mockRestore();
      }
    },
  );

  it.runIf(WINDOWS)("recognises a short form reached through a symlink", () => {
    const short = "C:\\proj\\WORKTR~1";
    const long = "C:\\proj\\worktree";
    mockRealPath((p) => (p.toLowerCase() === short.toLowerCase() ? long : p));
    expect(isPathInside(short, "C:\\proj")).toBe(true);
    expect(isPathAtOrAbove(short, "C:\\proj\\worktree\\repo")).toBe(true);
  });
});
