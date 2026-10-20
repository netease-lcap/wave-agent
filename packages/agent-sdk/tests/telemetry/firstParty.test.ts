import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED,
  isTelemetryDisabledByEnv,
  resolveFirstPartyChannel,
  resolveFirstPartyEnabled,
} from "@/telemetry/firstParty.js";

/** Stand-in for the signed-in machine; each test sets what it needs. */
const authState: { token?: string; serverUrl?: string } = {};

vi.mock("@/services/authService.js", () => ({
  AuthService: {
    getInstance: () => ({
      getSSOToken: () => authState.token,
      getServerUrl: () => authState.serverUrl,
    }),
  },
}));

vi.mock("@/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ENV_KEYS = ["DISABLE_TELEMETRY"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  authState.token = undefined;
  authState.serverUrl = undefined;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("resolveFirstPartyEnabled", () => {
  it("没有环境变量时由代码常量决定，默认开启（服务端入口已在各环境就绪）", () => {
    expect(FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED).toBe(true);
    expect(resolveFirstPartyEnabled()).toBe(true);
  });

  it("DISABLE_TELEMETRY 是总闸：首方出口随之关闭（与 CC 同名同义）", () => {
    process.env.DISABLE_TELEMETRY = "1";
    expect(isTelemetryDisabledByEnv()).toBe(true);
    expect(resolveFirstPartyEnabled()).toBe(false);
  });

  it("总闸认 1 / true，不认其它取值", () => {
    process.env.DISABLE_TELEMETRY = "true";
    expect(resolveFirstPartyEnabled()).toBe(false);
    process.env.DISABLE_TELEMETRY = "0";
    expect(resolveFirstPartyEnabled()).toBe(true);
  });
});

describe("resolveFirstPartyChannel", () => {
  it("未登录时不产生任何首方流量", () => {
    authState.serverUrl = "https://codechat.example.com";
    expect(resolveFirstPartyChannel()).toBeUndefined();
  });

  it("没有服务端地址时同样不产生流量", () => {
    authState.token = "sso-token";
    expect(resolveFirstPartyChannel()).toBeUndefined();
  });

  it("登录后默认指向 {WAVE_SERVER_URL}/otel", () => {
    authState.token = "sso-token";
    authState.serverUrl = "https://codechat.codewave-test.163yun.com";
    expect(resolveFirstPartyChannel()?.endpoint).toBe(
      "https://codechat.codewave-test.163yun.com/otel",
    );
  });

  it("端点恒由服务端地址派生（去掉尾部斜杠），没有独立的 endpoint 旋钮", () => {
    authState.token = "sso-token";
    authState.serverUrl = "https://codechat.codewave-test.163yun.com/";
    expect(resolveFirstPartyChannel()?.endpoint).toBe(
      "https://codechat.codewave-test.163yun.com/otel",
    );
  });

  it("headers 每次读取当前 token，续期后无需重启", async () => {
    authState.token = "first";
    authState.serverUrl = "https://codechat.codewave-test.163yun.com";
    const channel = resolveFirstPartyChannel()!;

    expect(await channel.headers()).toEqual({ Authorization: "Bearer first" });
    authState.token = "second";
    expect(await channel.headers()).toEqual({ Authorization: "Bearer second" });
  });

  it("token 消失后返回空头而不是抛错（导出器按空头发送）", async () => {
    authState.token = "first";
    authState.serverUrl = "https://codechat.codewave-test.163yun.com";
    const channel = resolveFirstPartyChannel()!;

    authState.token = undefined;
    await expect(channel.headers()).resolves.toEqual({});
  });
});
