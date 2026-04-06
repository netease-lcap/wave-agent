import { vi } from "vitest";
import * as os from "os";

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
