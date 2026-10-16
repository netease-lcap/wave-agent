import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED,
  isFirstPartyTelemetryDisabledByEnv,
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

const ENV_KEYS = ["WAVE_DISABLE_TELEMETRY", "WAVE_OTEL_URL"];
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
  it("没有配置时由代码常量决定，默认开启（服务端入口已在各环境就绪）", () => {
    expect(FIRST_PARTY_TELEMETRY_DEFAULT_ENABLED).toBe(true);
    expect(resolveFirstPartyEnabled()).toBe(true);
  });

  it("配置里的 firstPartyEnabled: true 与默认一致（显式打开仍生效）", () => {
    expect(resolveFirstPartyEnabled({ firstPartyEnabled: true })).toBe(true);
  });

  it("配置里的显式关闭生效（托管配置按整队关掉这条出口的路径）", () => {
    expect(resolveFirstPartyEnabled({ firstPartyEnabled: false })).toBe(false);
  });

  it("WAVE_DISABLE_TELEMETRY 压过配置里的显式打开", () => {
    process.env.WAVE_DISABLE_TELEMETRY = "1";
    expect(isFirstPartyTelemetryDisabledByEnv()).toBe(true);
    expect(resolveFirstPartyEnabled({ firstPartyEnabled: true })).toBe(false);
  });

  it("WAVE_DISABLE_TELEMETRY 也压过默认开启（无任何配置时）", () => {
    process.env.WAVE_DISABLE_TELEMETRY = "1";
    expect(resolveFirstPartyEnabled()).toBe(false);
  });

  it("退出开关认 true，不认其它取值", () => {
    process.env.WAVE_DISABLE_TELEMETRY = "true";
    expect(resolveFirstPartyEnabled({ firstPartyEnabled: true })).toBe(false);
    process.env.WAVE_DISABLE_TELEMETRY = "0";
    expect(resolveFirstPartyEnabled({ firstPartyEnabled: true })).toBe(true);
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

  it("WAVE_OTEL_URL 覆盖推导出的地址，并去掉尾部斜杠", () => {
    authState.token = "sso-token";
    authState.serverUrl = "https://codechat.codewave-test.163yun.com";
    process.env.WAVE_OTEL_URL = "http://127.0.0.1:4318/";
    expect(resolveFirstPartyChannel()?.endpoint).toBe("http://127.0.0.1:4318");
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
