import { vi, afterEach } from "vitest";
import * as os from "os";

// Safety net: hint V8 to reclaim memory between tests. Leaked Agent resources
// (timers, watchers) from tests that forgot to call destroy() accumulate under
// coverage instrumentation. Forcing GC when available (--expose-gc) helps keep
// peak memory bounded within a single fork worker.
afterEach(() => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    gc();
  }
});

// Mock os.homedir globally to prevent tests from reading user settings
// Mock both "os" and "node:os" specifiers since Vitest treats them as different modules
// Also include default export for both since source code may use default or namespace imports
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  const mockedHomedir = vi.fn(() => "/tmp");
  return {
    ...(actual as typeof os),
    homedir: mockedHomedir,
    default: {
      ...(actual as typeof os),
      homedir: mockedHomedir,
    },
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os");
  const mockedHomedir = vi.fn(() => "/tmp");
  return {
    ...(actual as typeof os),
    homedir: mockedHomedir,
    default: {
      ...(actual as typeof os),
      homedir: mockedHomedir,
    },
  };
});
