import { test, expect, vi, beforeEach } from "vitest";

vi.mock("wave-agent-sdk", () => ({
  isRemoteControlEnabled: vi.fn(() => false),
}));

import { isRemoteControlEnabled } from "wave-agent-sdk";
import { createRemoteControlSinkFactory } from "../../src/remote/remoteControlSink.js";
import type { AgentBridge } from "../../src/stdio/agentBridge.js";

const enabled = vi.mocked(isRemoteControlEnabled);

beforeEach(() => {
  enabled.mockReset();
  enabled.mockReturnValue(false);
});

test("no factory at all while the switch is off", () => {
  // Leaving `createRemoteSink` undefined is what makes the `remoteControl*`
  // RPCs answer "not enabled" instead of pretending to serve.
  expect(createRemoteControlSinkFactory("/work")).toBeUndefined();
  expect(enabled).toHaveBeenCalledWith("/work");
});

test("with the switch on the sink is built but not dialled out", () => {
  enabled.mockReturnValue(true);
  const create = createRemoteControlSinkFactory("/work");
  expect(create).toBeDefined();

  const sink = create!({} as AgentBridge);
  // Neither the daemon nor the stdio child connects on its own — the user
  // naming a machine (`wave remote-control on`) is the signal.
  expect(sink.getSnapshot()).toEqual({ state: "off" });
  expect(typeof sink.connect).toBe("function");
  expect(typeof sink.disconnect).toBe("function");
});
