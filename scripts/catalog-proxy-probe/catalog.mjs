/**
 * Compact-signature catalog renderer for the admission-gate probe.
 *
 * This is a throwaway stand-in for the catalog module an implementation would
 * introduce: the gate only needs "what the model sees when a tool is exposed
 * as one catalog line instead of a full JSON Schema declaration". The rules
 * below are deliberately conservative (types + required/optional + enum values
 * + defaults + two levels of nesting) — a more aggressive renderer would make
 * the gate's conclusion weaker, not stronger.
 */

/**
 * @param {Record<string, unknown>} schema
 * @param {{maxDepth?: number}} [options]
 * @returns {string}
 */
export function renderSignature(schema, options = {}) {
  const maxDepth = options.maxDepth ?? 2;
  return renderObject(schema, 0, maxDepth);
}

/**
 * @param {Record<string, unknown>} schema
 * @param {number} depth
 * @param {number} maxDepth
 * @returns {string}
 */
function renderObject(schema, depth, maxDepth) {
  const properties = /** @type {Record<string, Record<string, unknown>>} */ (
    schema.properties || {}
  );
  const required = Array.isArray(schema.required) ? schema.required : [];
  const parts = [];
  for (const [key, propSchema] of Object.entries(properties)) {
    const optional = required.includes(key) ? "" : "?";
    const defaultSuffix =
      "default" in propSchema ? `=${JSON.stringify(propSchema.default)}` : "";
    parts.push(
      `${key}${optional}: ${renderType(propSchema, depth, maxDepth)}${defaultSuffix}`,
    );
  }
  return `{${parts.join(", ")}}`;
}

/**
 * @param {Record<string, unknown>} schema
 * @param {number} depth
 * @param {number} maxDepth
 * @returns {string}
 */
function renderType(schema, depth, maxDepth) {
  const type = schema.type;
  if (Array.isArray(type)) {
    return type
      .map((candidate) =>
        renderType({ ...schema, type: candidate }, depth, maxDepth),
      )
      .join("|");
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join("|");
  }
  if (type === "object") {
    const properties = /** @type {Record<string, unknown>} */ (
      schema.properties || {}
    );
    if (
      Object.keys(properties).length === 0 &&
      typeof schema.additionalProperties === "object"
    ) {
      return `map<string, ${renderType(
        /** @type {Record<string, unknown>} */ (schema.additionalProperties),
        depth,
        maxDepth,
      )}>`;
    }
    if (depth >= maxDepth) {
      const keys = Object.keys(properties);
      return `{${keys.length > 0 ? keys.join(", ") + ", ..." : "..."}}`;
    }
    return renderObject(schema, depth + 1, maxDepth);
  }
  if (type === "array") {
    const itemSchema = /** @type {Record<string, unknown>} */ (
      schema.items || {}
    );
    const bounds = [
      typeof schema.minItems === "number" ? `minItems=${schema.minItems}` : "",
      typeof schema.maxItems === "number" ? `maxItems=${schema.maxItems}` : "",
    ]
      .filter(Boolean)
      .join(",");
    return `array<${renderType(itemSchema, depth, maxDepth)}${bounds ? ", " + bounds : ""}>`;
  }
  if (type === "string" && schema.minLength)
    return `string(minLength=${schema.minLength})`;
  if (type === "integer") {
    const bounds = [
      typeof schema.minimum === "number" ? `min=${schema.minimum}` : "",
      typeof schema.maximum === "number" ? `max=${schema.maximum}` : "",
    ]
      .filter(Boolean)
      .join(",");
    return bounds ? `integer(${bounds})` : "integer";
  }
  return String(type);
}

/**
 * Render one catalog entry: `<namespace>.<tool>(签名) // 描述`.
 *
 * Description clipping is token-denominated on purpose: the resident budget is
 * a token budget, and the same character cap truncates a Chinese description
 * roughly four times as hard as an English one (CJK 1 char/token vs 4).
 * `descMaxTokens` therefore clips with the same estimator the budget uses.
 *
 * @param {{name: string, description: Record<string, string>, inputSchema: Record<string, unknown>}} tool
 * @param {string} namespace
 * @param {{lang?: "en"|"zh", maxDepth?: number, descMaxChars?: number, descMaxTokens?: number,
 *   signature?: "full"|"none", estimateTokens?: (text: string) => number}} [options]
 */
export function renderEntry(tool, namespace, options = {}) {
  const lang = options.lang ?? "en";
  let description = tool.description[lang];
  if (options.descMaxTokens && options.estimateTokens) {
    if (options.estimateTokens(description) > options.descMaxTokens) {
      let low = 0;
      let high = description.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (
          options.estimateTokens(description.slice(0, mid)) <=
          options.descMaxTokens
        )
          low = mid;
        else high = mid - 1;
      }
      description = description.slice(0, low) + "…";
    }
  } else if (
    options.descMaxChars &&
    description.length > options.descMaxChars
  ) {
    description = description.slice(0, options.descMaxChars) + "…";
  }
  // signature: "none" is the ablation arm — it keeps the tool list (names and
  // descriptions) but drops the argument signature, which is what tells us
  // whether the gate's 100% actually depends on the signature.
  if (options.signature === "none") {
    return `${namespace}.${tool.name} // ${description}`;
  }
  const signature = renderSignature(tool.inputSchema, {
    maxDepth: options.maxDepth,
  });
  return `${namespace}.${tool.name}(${signature.slice(1, -1)}) // ${description}`;
}

/**
 * Render a catalog with a resident token budget, round-robin across
 * namespaces and at least one line per namespace.
 *
 * @param {Array<{namespace: string, line: string, tokens: number}>} entries
 * @param {{budgetTokens: number, estimateTokens: (text: string) => number}} options
 * @returns {{text: string, shown: number, total: number, truncated: boolean, tokens: number}}
 */
export function renderCatalog(entries, options) {
  const { budgetTokens, estimateTokens } = options;
  const lines = [];
  let used = 0;
  const byNamespace = new Map();
  for (const entry of entries) {
    if (!byNamespace.has(entry.namespace)) byNamespace.set(entry.namespace, []);
    byNamespace.get(entry.namespace).push(entry);
  }
  const queues = [...byNamespace.values()];
  // Contract: every connected namespace keeps at least one line, even when the
  // budget is already exhausted — a server the model cannot see at all is
  // indistinguishable from a server that is not connected.
  for (const queue of queues) {
    const entry = queue.shift();
    if (!entry) continue;
    lines.push(entry.line);
    used += entry.tokens + 1;
  }
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const entry = queue.shift();
      if (!entry) continue;
      const cost = entry.tokens + 1;
      if (used + cost > budgetTokens) continue;
      lines.push(entry.line);
      used += cost;
    }
  }
  const shown = lines.length;
  const total = entries.length;
  const truncated = shown < total;
  const status = truncated
    ? `PARTIAL - ${shown} of ${total} shown`
    : "COMPLETE";
  const text = [`# Tools available via ToolInvoke (${status})`, ...lines].join(
    "\n",
  );
  return { text, shown, total, truncated, tokens: estimateTokens(text) };
}

/**
 * Build entries (line + token cost) for a set of tools under one namespace.
 *
 * @param {Array<{name: string, description: Record<string, string>, inputSchema: Record<string, unknown>}>} tools
 * @param {string} namespace
 * @param {{lang?: "en"|"zh", maxDepth?: number, descMaxChars?: number, estimateTokens: (text: string) => number}} options
 */
export function buildEntries(tools, namespace, options) {
  return tools.map((tool) => {
    const line = renderEntry(tool, namespace, options);
    return { namespace, line, tokens: options.estimateTokens(line) };
  });
}

/**
 * Synthetic MCP tool used to find the truncation point of a large pool.
 *
 * @param {number} index
 * @param {"en"|"zh"} lang
 */
export function makeSyntheticTool(index, lang) {
  const description = {
    en:
      `Query resource number ${index} from the inventory service. Returns the current ` +
      `allocation, owner team, region and lifecycle state for the resource.`,
    zh: `查询编号 ${index} 的资源。返回该资源当前的分配情况、归属团队、地域与生命周期状态。`,
  };
  return {
    name: `query_resource_${index}`,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["resourceId", "scope"],
      properties: {
        resourceId: { type: "string" },
        scope: { type: "string", enum: ["team", "region", "org"] },
        includeHistory: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
  };
}
