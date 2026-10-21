import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type { ConfigurationService } from "../../src/services/configurationService.js";
import type { PermissionMode } from "../../src/types/permissions.js";
import { BASH_TOOL_NAME } from "../../src/constants/tools.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const WORKDIR = "/fake/project";
/** Not covered by DEFAULT_ALLOWED_RULES, so only the sandbox gate can allow it. */
const COMMAND = "./scripts/deploy.sh --check";

function createManager(options: {
  autoAllowBashIfSandboxed?: boolean;
  withConfiguration?: boolean;
}): PermissionManager {
  const container = new Container();
  container.register("Workdir", WORKDIR);
  if (options.withConfiguration !== false) {
    const configurationService = {
      getCurrentConfiguration: () => ({
        sandbox: {
          autoAllowBashIfSandboxed: options.autoAllowBashIfSandboxed ?? false,
        },
      }),
    } as unknown as ConfigurationService;
    container.register("ConfigurationService", configurationService);
  }
  return new PermissionManager(container);
}

function bashContext(
  manager: PermissionManager,
  options: {
    sandboxed?: boolean;
    permissionMode?: PermissionMode;
  } = {},
) {
  return manager.createContext(
    BASH_TOOL_NAME,
    options.permissionMode ?? "default",
    undefined,
    {
      command: COMMAND,
      workdir: WORKDIR,
      ...(options.sandboxed === undefined
        ? {}
        : { sandboxed: options.sandboxed }),
    },
    "tool_1",
  );
}

describe("PermissionManager — sandboxed Bash auto-allow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a sandboxed command without asking when auto-allow is on", async () => {
    const manager = createManager({ autoAllowBashIfSandboxed: true });

    const decision = await manager.checkPermission(
      bashContext(manager, { sandboxed: true }),
    );

    expect(decision.behavior).toBe("allow");
  });

  it("still asks when the command is not going to be sandboxed", async () => {
    const manager = createManager({ autoAllowBashIfSandboxed: true });

    const decision = await manager.checkPermission(
      bashContext(manager, { sandboxed: false }),
    );

    // No callback in this context, so "ask" surfaces as a deny.
    expect(decision.behavior).toBe("deny");
  });

  it("keeps asking when auto-allow is off, even inside the sandbox", async () => {
    const manager = createManager({ autoAllowBashIfSandboxed: false });

    const decision = await manager.checkPermission(
      bashContext(manager, { sandboxed: true }),
    );

    expect(decision.behavior).toBe("deny");
  });

  it("does not let the sandbox bypass plan mode", async () => {
    const manager = createManager({ autoAllowBashIfSandboxed: true });

    const decision = await manager.checkPermission(
      bashContext(manager, { sandboxed: true, permissionMode: "plan" }),
    );

    expect(decision.behavior).toBe("deny");
  });

  it("keeps explicit deny rules winning over the sandbox", async () => {
    const container = new Container();
    container.register("Workdir", WORKDIR);
    container.register("ConfigurationService", {
      getCurrentConfiguration: () => ({
        sandbox: { autoAllowBashIfSandboxed: true },
      }),
    } as unknown as ConfigurationService);
    const manager = new PermissionManager(container, {
      deniedRules: [`${BASH_TOOL_NAME}(${COMMAND})`],
    });

    const decision = await manager.checkPermission(
      bashContext(manager, { sandboxed: true }),
    );

    expect(decision.behavior).toBe("deny");
  });

  it("tolerates a missing configuration service", async () => {
    const manager = createManager({ withConfiguration: false });

    const decision = await manager.checkPermission(
      bashContext(manager, { sandboxed: true }),
    );

    expect(decision.behavior).toBe("deny");
  });
});
