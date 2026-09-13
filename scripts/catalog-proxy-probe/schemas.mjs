/**
 * Tool schemas for the catalog-proxy admission-gate probe.
 *
 * Single source of truth for both sides of the experiment:
 * - `server.mjs` validates incoming arguments with `validateArgs` (strict).
 * - `catalog.mjs` renders the compact signature the model sees in the catalog.
 *
 * Three complexity levels:
 *   1. simple  - 3 required scalars
 *   2. medium  - nested object + enums + defaults + mixed required/optional
 *   3. complex - long description (800+ chars) + nested array of objects +
 *                several enums + defaults, two levels deep
 */

const LONG_DESCRIPTION_EN = [
  "Create a CI/CD pipeline definition for the release train and register it with the",
  "release orchestrator. A pipeline is an ordered list of stages that the orchestrator",
  "runs sequentially from the first element to the last one; every stage declares what",
  "kind of work it performs, which environment it targets, and optional tuning knobs.",
  "The kind of a stage decides which executor is used: build stages run the compile and",
  "packaging toolchain, test stages run the unit and integration suites against the",
  "artifact produced by the preceding build stage, deploy stages promote an already",
  "built artifact into the target environment, and rollback stages restore the previous",
  "known-good release for that environment. Environment names are part of the promotion",
  "ladder, so a pipeline that deploys to prod should normally contain a staging stage",
  "earlier in the list. Each stage may carry a params object to override executor",
  "defaults: timeoutSec bounds how long the orchestrator waits before marking the stage",
  "as failed, cache reuses the workspace cache between runs when the executor supports",
  "it, and tags are free-form labels forwarded to the telemetry backend for filtering",
  "and dashboards. The parallelism knob controls how many independent jobs a single",
  "stage may fan out into, and is ignored by executors that cannot parallelise. The",
  "artifactName is the name under which the produced artifact is archived and later",
  "resolved by deploy and rollback stages, so it must be unique within the release",
  "train; the orchestrator rejects duplicates at registration time. The optional notify",
  "block subscribes a set of channels to pipeline events: email delivers to the address",
  "configured for the release train, im posts into the release room, and webhook POSTs a",
  "signed JSON payload to the endpoint registered for the pipeline. Setting level to",
  "info forwards every stage transition, warn forwards only failures and retries (the",
  "default), and error forwards nothing but hard failures. Registration is idempotent",
  "for identical definitions and returns the canonical pipeline identifier, so the same",
  "call may be repeated safely after a network timeout.",
].join(" ");

const LONG_DESCRIPTION_ZH = [
  "为发布列车创建一条 CI/CD 流水线定义，并注册到发布编排服务。流水线是一个有序的阶段列表，",
  "编排服务会从第一个元素依次执行到最后一个；每个阶段都要声明它执行什么类型的工作、面向哪个环境，",
  "以及可选的调优参数。阶段类型决定使用哪个执行器：build 阶段运行编译与打包工具链，test 阶段针对",
  "前一个 build 阶段产出的制品运行单元与集成测试，deploy 阶段把已经构建好的制品晋升到目标环境，",
  "rollback 阶段把该环境回滚到上一个已知可用的版本。环境名称是晋升阶梯的一部分，因此一个会部署到",
  "prod 的流水线通常应该在列表中更靠前的位置包含 staging 阶段。每个阶段都可以携带 params 对象覆盖",
  "执行器默认值：timeoutSec 限定编排服务在把该阶段标记为失败之前等待多久，cache 在执行器支持时复用",
  "工作区缓存，tags 是转发给遥测后端的自由标签，用于过滤和看板。parallelism 控制单个阶段最多可以",
  "拆分成多少个并行作业，不支持并行的执行器会忽略它。artifactName 是制品归档时使用的名称，",
  "后续 deploy 与 rollback 阶段会按这个名字解析它，因此在发布列车内必须唯一，编排服务在注册时会拒绝",
  "重名。可选的 notify 段把一组通知渠道订阅到流水线事件：email 投递到发布列车配置的邮箱，im 发送到",
  "发布房间，webhook 把带签名的 JSON 载荷 POST 到流水线注册的地址。level 设为 info 会转发每一次阶段",
  "状态变化，warn 只转发失败与重试（默认值），error 只转发硬失败。对于完全相同的定义，注册是幂等的，",
  "会返回规范化的流水线标识，因此在网络超时后可以安全地重复调用。",
].join("");

/** @typedef {{code: string, path: string, message: string}} ValidationError */

/**
 * Validate `value` against a JSON-Schema subset used by the probe tools.
 *
 * Deliberately strict: unknown fields are rejected everywhere, enums are
 * closed, and optional fields carrying a `default` are filled in.
 *
 * `depth` in the helpers below counts *container* nesting (top-level object = 0,
 * values of its properties are still at depth 0), which is what separates
 * "top-level type error" from "nested structure error" in the taxonomy.
 *
 * @param {Record<string, unknown>} schema
 * @param {unknown} value
 * @returns {{ok: true, value: Record<string, unknown>} | {ok: false, error: ValidationError}}
 */
export function validateArgs(schema, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: {
        code: "TYPE_MISMATCH",
        path: "$",
        message: `expected object, got ${describe(value)}`,
      },
    };
  }
  const result = validateObject(schema, value, [], 0);
  return result;
}

/**
 * @param {Record<string, unknown>} schema
 * @param {Record<string, unknown>} value
 * @param {string[]} pathParts
 * @param {number} depth
 */
function validateObject(schema, value, pathParts, depth) {
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = /** @type {Record<string, Record<string, unknown>>} */ (
    schema.properties || {}
  );

  for (const key of required) {
    if (!(key in value)) {
      return fail(
        "MISSING_REQUIRED",
        pathParts,
        key,
        "required field is missing",
      );
    }
  }

  const extra = Object.keys(value).filter((key) => !(key in properties));
  if (extra.length > 0) {
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      for (const key of extra) {
        const nested = validateValue(
          /** @type {Record<string, unknown>} */ (schema.additionalProperties),
          value[key],
          [...pathParts, key],
          depth,
        );
        if (!nested.ok) return nested;
      }
    } else {
      return fail(
        "UNKNOWN_FIELD",
        pathParts,
        extra[0],
        `unexpected field (allowed: ${Object.keys(properties).join(", ")})`,
      );
    }
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in value)) {
      if ("default" in propSchema) out[key] = propSchema.default;
      continue;
    }
    const nested = validateValue(
      propSchema,
      value[key],
      [...pathParts, key],
      depth,
    );
    if (!nested.ok) return nested;
    out[key] = nested.value;
  }
  // keep unknown-but-allowed extra fields (map-style properties)
  for (const key of extra) out[key] = value[key];
  return { ok: true, value: out };
}

/**
 * @param {Record<string, unknown>} schema
 * @param {unknown} value
 * @param {string[]} pathParts
 * @param {number} depth
 */
function validateValue(schema, value, pathParts, depth) {
  const type = schema.type;

  if (Array.isArray(type)) {
    for (const candidate of type) {
      const attempt = validateValue(
        { ...schema, type: candidate },
        value,
        pathParts,
        depth,
      );
      if (attempt.ok) return attempt;
    }
    return {
      ok: false,
      error: {
        code: "TYPE_MISMATCH",
        path: formatPath(pathParts),
        message: `expected one of ${type.join("|")}, got ${describe(value)}`,
      },
    };
  }

  if (type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false,
        error: {
          code: depth >= 1 ? "NESTED_STRUCTURE" : "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `expected object, got ${describe(value)}`,
        },
      };
    }
    return validateObject(
      schema,
      /** @type {Record<string, unknown>} */ (value),
      pathParts,
      depth,
    );
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      return {
        ok: false,
        error: {
          code: depth >= 1 ? "NESTED_STRUCTURE" : "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `expected array, got ${describe(value)}`,
        },
      };
    }
    const min = typeof schema.minItems === "number" ? schema.minItems : 0;
    const max =
      typeof schema.maxItems === "number" ? schema.maxItems : Infinity;
    if (value.length < min || value.length > max) {
      return {
        ok: false,
        error: {
          code: "NESTED_STRUCTURE",
          path: formatPath(pathParts),
          message: `array length ${value.length} out of range [${min}, ${max}]`,
        },
      };
    }
    /** @type {unknown[]} */
    const items = [];
    for (let i = 0; i < value.length; i++) {
      const itemSchema = /** @type {Record<string, unknown>} */ (
        schema.items || {}
      );
      const nested = validateValue(
        itemSchema,
        value[i],
        [...pathParts, String(i)],
        depth + 1,
      );
      if (!nested.ok) return nested;
      items.push(nested.value);
    }
    return { ok: true, value: items };
  }

  if (type === "string") {
    if (typeof value !== "string") {
      return {
        ok: false,
        error: {
          code: depth >= 1 ? "NESTED_STRUCTURE" : "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `expected string, got ${describe(value)}`,
        },
      };
    }
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      return {
        ok: false,
        error: {
          code: "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `string shorter than minLength ${schema.minLength}`,
        },
      };
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      return {
        ok: false,
        error: {
          code: "ENUM_INVALID",
          path: formatPath(pathParts),
          message: `value ${JSON.stringify(value)} is not one of ${schema.enum.join("|")}`,
        },
      };
    }
    return { ok: true, value };
  }

  if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return {
        ok: false,
        error: {
          code: depth >= 1 ? "NESTED_STRUCTURE" : "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `expected integer, got ${describe(value)}`,
        },
      };
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      return {
        ok: false,
        error: {
          code: "ENUM_INVALID",
          path: formatPath(pathParts),
          message: `value ${value} is not one of ${schema.enum.join("|")}`,
        },
      };
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return {
        ok: false,
        error: {
          code: "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `value ${value} below minimum ${schema.minimum}`,
        },
      };
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return {
        ok: false,
        error: {
          code: "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `value ${value} above maximum ${schema.maximum}`,
        },
      };
    }
    return { ok: true, value };
  }

  if (type === "boolean") {
    if (typeof value !== "boolean") {
      return {
        ok: false,
        error: {
          code: depth >= 1 ? "NESTED_STRUCTURE" : "TYPE_MISMATCH",
          path: formatPath(pathParts),
          message: `expected boolean, got ${describe(value)}`,
        },
      };
    }
    return { ok: true, value };
  }

  return { ok: true, value };
}

/**
 * @param {string} code
 * @param {string[]} pathParts
 * @param {string} key
 * @param {string} message
 */
function fail(code, pathParts, key, message) {
  return {
    ok: false,
    error: { code, path: formatPath([...pathParts, key]), message },
  };
}

/** @param {string[]} pathParts */
function formatPath(pathParts) {
  return pathParts.length === 0 ? "$" : `$.${pathParts.join(".")}`;
}

/** @param {unknown} value */
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string")
    return `string(${JSON.stringify(value).slice(0, 40)})`;
  return `${typeof value}(${value})`;
}

export const SIMPLE_REPORT = {
  name: "simple_report",
  level: "simple",
  description: {
    en: "Create a simple operations report entry with a title, a count and an enabled flag.",
    zh: "创建一条简单的运维报告记录，包含标题、数量与启用开关。",
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "count", "enabled"],
    properties: {
      title: { type: "string", minLength: 2 },
      count: { type: "integer", minimum: 1, maximum: 1000 },
      enabled: { type: "boolean" },
    },
  },
};

export const COMPOSE_CONFIG = {
  name: "compose_config",
  level: "medium",
  description: {
    en: "Compose a deployment configuration for a named service, including its target platform.",
    zh: "为指定服务组装一份部署配置，包含目标平台信息。",
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "target"],
    properties: {
      name: { type: "string" },
      target: {
        type: "object",
        additionalProperties: false,
        required: ["os", "arch"],
        properties: {
          os: { type: "string", enum: ["linux", "macos", "windows"] },
          arch: { type: "string", enum: ["x64", "arm64"] },
          retries: { type: "integer", minimum: 0, maximum: 10, default: 3 },
        },
      },
      labels: { type: "object", additionalProperties: { type: "string" } },
      dryRun: { type: "boolean", default: false },
    },
  },
};

export const BUILD_PIPELINE = {
  name: "build_pipeline",
  level: "complex",
  description: {
    en: LONG_DESCRIPTION_EN,
    zh: LONG_DESCRIPTION_ZH,
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["artifactName", "pipeline"],
    properties: {
      artifactName: { type: "string", minLength: 3 },
      pipeline: {
        type: "object",
        additionalProperties: false,
        required: ["stages"],
        properties: {
          stages: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "kind", "env"],
              properties: {
                id: { type: "string" },
                kind: {
                  type: "string",
                  enum: ["build", "test", "deploy", "rollback"],
                },
                env: { type: "string", enum: ["dev", "staging", "prod"] },
                params: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    timeoutSec: {
                      type: "integer",
                      minimum: 5,
                      maximum: 3600,
                      default: 60,
                    },
                    cache: { type: "boolean", default: true },
                    tags: { type: "array", items: { type: "string" } },
                  },
                },
                parallelism: {
                  type: "integer",
                  minimum: 1,
                  maximum: 8,
                  default: 1,
                },
              },
            },
          },
        },
      },
      notify: {
        type: "object",
        additionalProperties: false,
        required: ["channels"],
        properties: {
          channels: {
            type: "array",
            minItems: 1,
            items: { type: "string", enum: ["email", "im", "webhook"] },
          },
          level: {
            type: "string",
            enum: ["info", "warn", "error"],
            default: "warn",
          },
        },
      },
    },
  },
};

export const PROBE_TOOLS = [SIMPLE_REPORT, COMPOSE_CONFIG, BUILD_PIPELINE];

/**
 * Per-tool natural-language task used by every group/round. Identical across
 * groups so the only difference is how the tool is exposed to the model.
 */
export const TASKS = {
  simple_report:
    "请创建一条运维报告记录：标题为「月度巡检」，数量 12，并启用该记录。完成后简短说明你调用了什么。",
  compose_config:
    "请为服务 web-gateway 组装部署配置：目标平台是 macOS（Apple 芯片），其余参数使用默认值。完成后简短说明你调用了什么。",
  build_pipeline:
    "请创建一条流水线：制品名为 release-check.tar.gz；包含两个阶段，先 build 到 dev，再 test 到 staging；通知渠道使用 im。其余参数使用默认值。完成后简短说明你调用了什么。",
};

/**
 * Build the OpenAI-style function config for one probe tool, as an MCP server
 * would declare it (name prefixed with the namespace).
 *
 * @param {{name: string, description: Record<string, string>, inputSchema: Record<string, unknown>}} tool
 * @param {string} namespace
 * @param {"en"|"zh"} lang
 */
export function toOpenAITool(tool, namespace, lang) {
  return {
    type: "function",
    function: {
      name: `mcp__${namespace}__${tool.name}`,
      description: `${tool.description[lang]} (MCP: ${namespace})`,
      parameters: tool.inputSchema,
    },
  };
}
