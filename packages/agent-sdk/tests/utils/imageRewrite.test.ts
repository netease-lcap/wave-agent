import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OUTBOUND_IMAGE_MAX_DIMENSION_PX,
  OUTBOUND_IMAGE_TARGET_RAW_BYTES,
} from "../../src/utils/imageBudget.js";
import { getImageDimensionsFromDataUrl } from "../../src/utils/imageDimensions.js";
import type { OutboundImagePlan } from "../../src/utils/imageRewrite.js";
import type {
  SharpFactory,
  SharpMetadata,
} from "../../src/utils/imageProcessor.js";

/** Injectable codec: `undefined` stands for "no codec on this host". */
const probe = vi.hoisted(() => ({
  processor: undefined as unknown,
  resolveCount: 0,
}));

vi.mock("../../src/utils/imageProcessor.js", () => ({
  getImageProcessor: () => {
    probe.resolveCount += 1;
    return probe.processor;
  },
}));

/** Records the in-turn install kick the degraded path fires. */
const runtimeDepsProbe = vi.hoisted(() => ({ ensure: vi.fn() }));

vi.mock("../../src/utils/runtimeDeps.js", () => ({
  ensureRuntimeDeps: runtimeDepsProbe.ensure,
}));

import {
  __resetImageRewriteCacheForTesting,
  planOutboundImage,
} from "../../src/utils/imageRewrite.js";

/** Just over the raw-byte budget, so no rung that returns it can win. */
const TOO_BIG = OUTBOUND_IMAGE_TARGET_RAW_BYTES + 1;
/** Comfortably under the raw-byte budget. */
const SMALL = 5000;

const PNG_HEADER_BYTES = 24;

/** Bytes that `getImageDimensions` reads as a PNG of the given size. */
function pngBytes(width: number, height: number, totalLength: number): Buffer {
  const bytes = Buffer.alloc(Math.max(PNG_HEADER_BYTES, totalLength));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(0x0d, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function pngDataUrl(
  width: number,
  height: number,
  totalLength: number,
): string {
  return `data:image/png;base64,${pngBytes(width, height, totalLength).toString("base64")}`;
}

interface EncodeCall {
  /** Which `sharp()` call produced these bytes — one per rung, never reused. */
  instanceId: number;
  /** Encoder chain, e.g. `resize+png+palette` or `resize+flatten+jpeg:80`. */
  chain: string;
  target: { width: number; height: number };
  fit: string | undefined;
  withoutEnlargement: boolean;
  dimensions: { width: number; height: number };
  bytes: number;
}

interface FakeConfig {
  metadata: SharpMetadata;
  /** Encoded length for a rung, keyed by its chain label and resize target. */
  sizeFor: (label: string, target: { width: number; height: number }) => number;
  failOn?: (label: string) => boolean;
}

/**
 * A fake `sharp` that records every rung it is asked to produce, and — like the
 * real thing — preserves the aspect ratio only when `fit: "inside"` is passed,
 * so dropping that option shows up as wrong output dimensions rather than
 * passing unnoticed.
 */
function fakeSharp(config: FakeConfig) {
  const source = {
    width: config.metadata.width ?? 1,
    height: config.metadata.height ?? 1,
  };
  const calls: EncodeCall[] = [];
  let instances = 0;

  const factory = Object.assign(
    (_input: Buffer) => {
      const instanceId = instances++;
      const chain: string[] = [];
      let target: { width: number; height: number } | undefined;
      let fit: string | undefined;
      let withoutEnlargement = false;

      const image = {
        metadata: async () => ({ ...config.metadata }),
        resize(
          width: number,
          height: number,
          options?: { fit?: "inside"; withoutEnlargement?: boolean },
        ) {
          chain.push("resize");
          target = { width, height };
          fit = options?.fit;
          withoutEnlargement = options?.withoutEnlargement === true;
          return image;
        },
        png: (options?: { palette?: boolean }) => {
          chain.push(options?.palette ? "png+palette" : "png");
          return image;
        },
        webp: (options?: { quality?: number }) => {
          chain.push(`webp:${options?.quality}`);
          return image;
        },
        jpeg: (options?: { quality?: number }) => {
          chain.push(`jpeg:${options?.quality}`);
          return image;
        },
        flatten: () => {
          chain.push("flatten");
          return image;
        },
        async toBuffer() {
          const label = chain.join("+");
          if (config.failOn?.(label)) throw new Error(`fake sharp: ${label}`);
          const box = target ?? source;
          const ratio = Math.min(
            box.width / source.width,
            box.height / source.height,
            ...(fit === "inside" && withoutEnlargement ? [1] : []),
          );
          const dimensions =
            fit === "inside"
              ? {
                  width: Math.max(1, Math.round(source.width * ratio)),
                  height: Math.max(1, Math.round(source.height * ratio)),
                }
              : box;
          const output = pngBytes(
            dimensions.width,
            dimensions.height,
            config.sizeFor(label, box),
          );
          calls.push({
            instanceId,
            chain: label,
            target: box,
            fit,
            withoutEnlargement,
            dimensions,
            bytes: output.length,
          });
          return output;
        },
      };
      return image;
    },
    { versions: { vips: "fake" } },
  );

  return { factory: factory as unknown as SharpFactory, calls };
}

function asSend(plan: OutboundImagePlan) {
  if (plan.kind !== "send") {
    throw new Error(`expected a send plan, got omit: ${plan.note}`);
  }
  return plan;
}

function asOmit(plan: OutboundImagePlan) {
  if (plan.kind !== "omit") {
    throw new Error("expected an omit plan, got a send plan");
  }
  return plan;
}

afterEach(() => {
  __resetImageRewriteCacheForTesting();
  probe.processor = undefined;
  probe.resolveCount = 0;
  runtimeDepsProbe.ensure.mockClear();
});

describe("planOutboundImage", () => {
  it("sends an image inside the budget byte-for-byte, without resolving the codec", async () => {
    const fake = fakeSharp({
      metadata: { width: 1200, height: 800, format: "png" },
      sizeFor: () => SMALL,
    });
    probe.processor = fake.factory;
    const dataUrl = pngDataUrl(1200, 800, SMALL);

    const plan = await planOutboundImage({ dataUrl, cacheKey: dataUrl });

    expect(plan).toEqual({ kind: "send", dataUrl });
    expect(probe.resolveCount).toBe(0);
    expect(fake.calls).toHaveLength(0);
    // Inside the budget: no codec needed, so nothing to install either.
    expect(runtimeDepsProbe.ensure).not.toHaveBeenCalled();
  });

  it("shrinks an over-dimension image into the budget, keeping the aspect ratio", async () => {
    const fake = fakeSharp({
      metadata: { width: 3000, height: 2000, format: "png" },
      sizeFor: (label) => (label.includes("jpeg") ? SMALL : TOO_BIG),
    });
    probe.processor = fake.factory;

    const plan = asSend(
      await planOutboundImage({
        dataUrl: pngDataUrl(3000, 2000, SMALL),
        cacheKey: "dims",
      }),
    );

    const displayed = getImageDimensionsFromDataUrl(plan.dataUrl);
    expect(displayed).toEqual({ width: 2000, height: 1333 });
    expect(displayed!.width).toBeLessThanOrEqual(
      OUTBOUND_IMAGE_MAX_DIMENSION_PX,
    );
    expect(displayed!.height).toBeLessThanOrEqual(
      OUTBOUND_IMAGE_MAX_DIMENSION_PX,
    );
    expect(displayed!.width / displayed!.height).toBeCloseTo(3000 / 2000, 2);

    // The resize box is the budget-clamped source, not a hardcoded square.
    expect(fake.calls[0].target).toEqual({ width: 2000, height: 2000 });
    expect(fake.calls[0].fit).toBe("inside");

    expect(plan.note).toContain("original 3000x2000");
    expect(plan.note).toContain("displayed at 2000x1333");
    expect(plan.note).toContain("Multiply coordinates by 1.50");
  });

  it("compresses an over-budget image without changing its dimensions", async () => {
    const fake = fakeSharp({
      metadata: { width: 1200, height: 800, format: "png" },
      sizeFor: (label) => (label.includes("webp") ? SMALL : TOO_BIG),
    });
    probe.processor = fake.factory;

    const plan = asSend(
      await planOutboundImage({
        dataUrl: pngDataUrl(1200, 800, TOO_BIG),
        cacheKey: "bytes",
      }),
    );

    // Dimensions are inside the budget — only the payload had to shrink, so the
    // image keeps its resolution and needs no coordinate-mapping note.
    expect(fake.calls[0].target).toEqual({ width: 1200, height: 800 });
    expect(getImageDimensionsFromDataUrl(plan.dataUrl)).toEqual({
      width: 1200,
      height: 800,
    });
    expect(plan.dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    expect(plan.note).toBeUndefined();
  });

  it("tries every transparency-preserving encoder before flattening to JPEG", async () => {
    const fake = fakeSharp({
      metadata: { width: 3000, height: 3000, format: "png", hasAlpha: true },
      sizeFor: (label) => (label.includes("flatten") ? SMALL : TOO_BIG),
    });
    probe.processor = fake.factory;

    const plan = asSend(
      await planOutboundImage({
        dataUrl: pngDataUrl(3000, 3000, SMALL),
        cacheKey: "alpha",
      }),
    );

    expect(fake.calls.map((call) => call.chain)).toEqual([
      "resize+png",
      "resize+png+palette",
      "resize+webp:80",
      "resize+webp:60",
      "resize+flatten+jpeg:80",
    ]);
    // The data URL names the container that was actually produced.
    expect(plan.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("goes straight to JPEG for a JPEG source", async () => {
    const fake = fakeSharp({
      metadata: { width: 3000, height: 2000, format: "jpeg" },
      sizeFor: (label) => (label.includes("jpeg:60") ? SMALL : TOO_BIG),
    });
    probe.processor = fake.factory;

    const plan = asSend(
      await planOutboundImage({
        dataUrl: pngDataUrl(3000, 2000, SMALL),
        cacheKey: "jpeg-source",
      }),
    );

    expect(fake.calls.map((call) => call.chain)).toEqual([
      "resize+jpeg:80",
      "resize+jpeg:60",
    ]);
    expect(plan.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("downscales further when no encoder fits at the current size", async () => {
    const fake = fakeSharp({
      metadata: { width: 3000, height: 2000, format: "png" },
      sizeFor: (_label, target) => (target.width < 2000 ? SMALL : TOO_BIG),
    });
    probe.processor = fake.factory;

    const plan = asSend(
      await planOutboundImage({
        dataUrl: pngDataUrl(3000, 2000, SMALL),
        cacheKey: "scales",
      }),
    );

    expect(fake.calls.at(-1)!.target).toEqual({ width: 1500, height: 1500 });
    expect(getImageDimensionsFromDataUrl(plan.dataUrl)).toEqual({
      width: 1500,
      height: 1000,
    });
    expect(plan.note).toContain("Multiply coordinates by 2.00");
  });

  it("uses a fresh image instance for every rung", async () => {
    const fake = fakeSharp({
      metadata: { width: 3000, height: 2000, format: "png", hasAlpha: true },
      sizeFor: (label) => (label.includes("flatten") ? SMALL : TOO_BIG),
    });
    probe.processor = fake.factory;

    await planOutboundImage({
      dataUrl: pngDataUrl(3000, 2000, SMALL),
      cacheKey: "instances",
    });

    const ids = fake.calls.map((call) => call.instanceId);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sends an over-budget but sendable image when there is no codec", async () => {
    probe.processor = undefined;
    const dataUrl = pngDataUrl(1200, 800, TOO_BIG);

    expect(await planOutboundImage({ dataUrl, cacheKey: "no-codec" })).toEqual({
      kind: "send",
      dataUrl,
    });
    // Degrading this turn must still try to install for the next one — fired
    // without awaiting, so the request is not held up by a download.
    expect(runtimeDepsProbe.ensure).toHaveBeenCalledTimes(1);
  });

  it("omits an image past the gateway bound when there is no codec, keeping its path", async () => {
    probe.processor = undefined;
    const dataUrl = pngDataUrl(9000, 300, SMALL);

    const plan = asOmit(
      await planOutboundImage({
        dataUrl,
        cacheKey: "no-codec-oversized",
        sourcePath: "/tmp/wave-image-long.png",
      }),
    );

    expect(plan.note).toContain("9000x300");
    expect(plan.note).toContain("8192");
    expect(plan.note).toContain("Crop");
    expect(plan.note).toContain("Path: /tmp/wave-image-long.png");
    expect(runtimeDepsProbe.ensure).toHaveBeenCalledTimes(1);
  });

  it("degrades to sending when the codec itself fails", async () => {
    const fake = fakeSharp({
      metadata: { width: 1200, height: 800, format: "png" },
      sizeFor: () => SMALL,
      failOn: () => true,
    });
    probe.processor = fake.factory;

    const sendable = pngDataUrl(1200, 800, TOO_BIG);
    expect(
      await planOutboundImage({ dataUrl: sendable, cacheKey: "broken" }),
    ).toEqual({ kind: "send", dataUrl: sendable });

    const oversized = pngDataUrl(9000, 300, TOO_BIG);
    expect(
      asOmit(
        await planOutboundImage({ dataUrl: oversized, cacheKey: "broken2" }),
      ).note,
    ).toContain("8192");
  });

  it("omits an image no rung can fit, with the same note", async () => {
    const fake = fakeSharp({
      metadata: { width: 3000, height: 3000, format: "png" },
      sizeFor: () => TOO_BIG,
    });
    probe.processor = fake.factory;

    const plan = asOmit(
      await planOutboundImage({
        dataUrl: pngDataUrl(3000, 3000, SMALL),
        cacheKey: "exhausted",
      }),
    );

    expect(plan.note).toContain("3000x3000");
    expect(plan.note).toContain("Crop");
    // Eight encoders across four downscale steps — the whole ladder, then give up.
    expect(fake.calls).toHaveLength(32);
  });

  it("does not drop an image whose size cannot be determined", async () => {
    const fake = fakeSharp({
      metadata: { format: "png" },
      sizeFor: () => SMALL,
    });
    probe.processor = fake.factory;
    const dataUrl = `data:image/png;base64,${Buffer.alloc(TOO_BIG).toString("base64")}`;

    expect(await planOutboundImage({ dataUrl, cacheKey: "unknown" })).toEqual({
      kind: "send",
      dataUrl,
    });
  });

  it("rewrites a repeated image only once", async () => {
    const fake = fakeSharp({
      metadata: { width: 3000, height: 2000, format: "png" },
      sizeFor: (label) => (label.includes("jpeg") ? SMALL : TOO_BIG),
    });
    probe.processor = fake.factory;
    const dataUrl = pngDataUrl(3000, 2000, SMALL);
    const cacheKey = "/tmp/screenshot.png:4096:1730000000000";

    const first = await planOutboundImage({ dataUrl, cacheKey });
    const rungs = fake.calls.length;
    expect(rungs).toBeGreaterThan(0);

    const second = await planOutboundImage({ dataUrl, cacheKey });

    expect(second).toEqual(first);
    expect(fake.calls).toHaveLength(rungs);
    expect(probe.resolveCount).toBe(1);
  });
});
