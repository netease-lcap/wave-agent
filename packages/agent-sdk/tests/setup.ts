import { vi } from "vitest";

// Mock GitService globally
vi.mock("../src/services/GitService.js", () => {
  return {
    GitService: class {
      clone = vi.fn().mockResolvedValue(undefined);
      pull = vi.fn().mockResolvedValue(undefined);
      checkIsRepo = vi.fn().mockResolvedValue(true);
      fetch = vi.fn().mockResolvedValue(undefined);
      checkout = vi.fn().mockResolvedValue(undefined);
      isGitAvailable = vi.fn().mockResolvedValue(true);
    },
  };
});

// Mock MarketplaceService.autoUpdateAll globally to be a no-op
// This prevents background network/git operations during Agent.create in tests
vi.mock("../src/services/MarketplaceService.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/services/MarketplaceService.js")
    >();
  return {
    ...actual,
    MarketplaceService: class extends actual.MarketplaceService {
      override async autoUpdateAll() {
        // No-op by default in tests to prevent side effects during Agent.create
      }
    },
  };
});
