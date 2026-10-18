/**
 * 两条通道的 temporality 契约（首方 DELTA / 客户 CUMULATIVE）。
 *
 * `instrumentation.test.ts` 里的断言只证明「装配时参数传对了」——那一份用 mock
 * 的 SDK，证明不了 SDK 是否真的允许同一个 MeterProvider 下两个 reader 各按各的
 * temporality 出点，也证明不了 delta 在「本区间没有新增」时到底上报什么。这两
 * 件事决定了服务端的聚合语义，所以这里用**真的** @opentelemetry/sdk-metrics：
 * 不联网、不 mock SDK，只把 exporter 换成 `InMemoryMetricExporter`。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  InstrumentType,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from "@opentelemetry/exporter-metrics-otlp-http";
import {
  initMetrics,
  recordSession,
  resetMetrics,
} from "@/telemetry/metrics.js";

/**
 * 记录路径会为了 `user.id` 读身份、未登录时落到匿名 id（会读写 ~/.wave 下的
 * 配置），测试里换成固定值。
 */
vi.mock("@/services/authService.js", () => ({
  AuthService: {
    getInstance: () => ({ getAuthUser: () => undefined }),
  },
  getOrCreateAnonymousId: () => "anon-id-test",
}));

/** 比导出间隔长得多：保证只有 `forceFlush()` 才会导出，不靠定时器。 */
const NEVER = 60 * 60 * 1000;
const SESSION = "session-1";

/** 每次导出里的指标（按导出顺序）。 */
function snapshotsOf(exports: ResourceMetrics[]): MetricData[][] {
  return exports.map((resourceMetrics) =>
    resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics),
  );
}

function metricIn(
  snapshot: MetricData[],
  name: string,
): MetricData | undefined {
  return snapshot.find((metric) => metric.descriptor.name === name);
}

function temporalityOf(
  exports: ResourceMetrics[],
  name: string,
): AggregationTemporality[] {
  return snapshotsOf(exports).map(
    (snapshot) => metricIn(snapshot, name)!.aggregationTemporality,
  );
}

/**
 * 每次导出里 `session.id=session-1` 那条序列的值。某次导出没有这条序列（或整次
 * 导出都没发生）时表现为数组变短，调用方据长度判断「这一窗有没有上报」。
 */
function sessionSeriesValues(
  exports: ResourceMetrics[],
  name: string,
): (number | undefined)[] {
  return snapshotsOf(exports).map(
    (snapshot) =>
      (
        metricIn(snapshot, name)?.dataPoints as
          | { attributes: Record<string, unknown>; value: number }[]
          | undefined
      )?.find((point) => point.attributes["session.id"] === SESSION)?.value,
  );
}

describe("同一 MeterProvider 下首方 DELTA 与客户 CUMULATIVE 并存", () => {
  let provider: MeterProvider;
  /** 第一方通道（DELTA）。 */
  let firstParty: InMemoryMetricExporter;
  /** 客户自建收集器通道（CUMULATIVE）。 */
  let collector: InMemoryMetricExporter;

  beforeEach(() => {
    firstParty = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    collector = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter: firstParty,
          exportIntervalMillis: NEVER,
        }),
        new PeriodicExportingMetricReader({
          exporter: collector,
          exportIntervalMillis: NEVER,
        }),
      ],
    });
    initMetrics(provider.getMeter("wave"), {
      includeSessionId: true,
      includeRepository: false,
      includeEntrypoint: false,
      resourceAttributes: {},
    });
  });

  afterEach(async () => {
    resetMetrics();
    await provider.shutdown();
  });

  it("同一份聚合出两份载荷：首方是区间增量，客户是累计值", async () => {
    recordSession({ sessionId: SESSION });
    await provider.forceFlush();

    recordSession({ sessionId: SESSION });
    await provider.forceFlush();

    expect(
      sessionSeriesValues(firstParty.getMetrics(), "wave.sessions"),
    ).toEqual([1, 1]);
    expect(
      sessionSeriesValues(collector.getMetrics(), "wave.sessions"),
    ).toEqual([1, 2]);
  });

  it("delta 的载荷标 DELTA、cumulative 的标 CUMULATIVE（同一进程同一 meter）", async () => {
    recordSession({ sessionId: SESSION });
    await provider.forceFlush();

    expect(temporalityOf(firstParty.getMetrics(), "wave.sessions")).toEqual([
      AggregationTemporality.DELTA,
    ]);
    expect(temporalityOf(collector.getMetrics(), "wave.sessions")).toEqual([
      AggregationTemporality.CUMULATIVE,
    ]);
  });

  /**
   * 这条是服务端语义的依据：delta 下「本区间没有新增」不是一个值为 0 的点，而是
   * **什么点都没有**（SDK 连整次导出都跳过）。所以服务端不能把「收到了点」当心跳，
   * 「最后上报时间」表示的是「最后一次有活动」。
   */
  it("delta 下无活动的区间不上报任何点，客户侧则继续重发累计值", async () => {
    recordSession({ sessionId: SESSION });
    await provider.forceFlush();

    // 第二个区间完全空闲
    await provider.forceFlush();

    expect(firstParty.getMetrics()).toHaveLength(1);
    expect(collector.getMetrics()).toHaveLength(2);
    expect(collector.getMetrics().at(-1)).toBeDefined();
    expect(
      sessionSeriesValues(collector.getMetrics(), "wave.sessions").at(-1),
    ).toBe(1);
  });
});

describe("显式 temporality 优先于全局环境变量", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * 首方 exporter 的 `temporalityPreference` 是构造参数；环境变量只在它缺席时兜
   * 底。这条把顺序钉死：接入方为自己的 collector 设了 `cumulative`，也翻不动首方
   * 通道。
   */
  it("OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative 覆盖不了显式 DELTA", () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE =
      "cumulative";

    const explicit = new OTLPMetricExporter({
      url: "http://127.0.0.1:9/v1/metrics",
      temporalityPreference: AggregationTemporalityPreference.DELTA,
    });
    expect(explicit.selectAggregationTemporality(InstrumentType.COUNTER)).toBe(
      AggregationTemporality.DELTA,
    );
    expect(
      explicit.selectAggregationTemporality(InstrumentType.HISTOGRAM),
    ).toBe(AggregationTemporality.DELTA);

    // 对照组：不传显式偏好时环境变量生效 —— 这正是客户通道今天的行为
    const fromEnv = new OTLPMetricExporter({
      url: "http://127.0.0.1:9/v1/metrics",
    });
    expect(fromEnv.selectAggregationTemporality(InstrumentType.COUNTER)).toBe(
      AggregationTemporality.CUMULATIVE,
    );
  });
});
