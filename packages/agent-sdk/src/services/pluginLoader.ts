import * as fs from "fs/promises";
import * as path from "path";
import {
  PluginManifest,
  CustomSlashCommand,
  Skill,
  LspConfig,
  McpConfig,
  McpServerConfig,
  PartialHookConfiguration,
  PluginWorkflow,
} from "../types/index.js";
import { scanCommandsDirectory } from "../utils/customCommands.js";
import { parseSkillFile } from "../utils/skillParser.js";
import {
  parseAgentFile,
  type SubagentConfiguration,
} from "../utils/subagentParser.js";
import { logger } from "../utils/globalLogger.js";
import { WORKFLOW_SCRIPT_EXTENSION } from "../workflow/workflowRegistry.js";
import { parseScript, validateScript } from "../workflow/scriptRuntime.js";
import { MOD_LIMITS, type PluginMod } from "../types/mods.js";

/** 能被编译成 mod 的扩展名（与 `mods/compile.ts` 的 loader 表一致）。 */
const MOD_LOADER_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

export class PluginLoader {
  /**
   * Load and validate a plugin manifest from a directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static async loadManifest(pluginPath: string): Promise<PluginManifest> {
    const dotWavePluginPath = path.join(pluginPath, ".wave-plugin");

    // Check if .wave-plugin/ directory exists
    let wavePluginDirExists = false;
    try {
      const entries = await fs.readdir(dotWavePluginPath);
      wavePluginDirExists = true;
      // T018: Ensure plugin.json is the only file in .wave-plugin/
      const misplaced = entries.filter((e) => e !== "plugin.json");
      if (misplaced.length > 0) {
        throw new Error(
          `Misplaced files/directories in .wave-plugin/: ${misplaced.join(", ")}. Only plugin.json should be in this directory.`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        // .wave-plugin/ doesn't exist, will try .claude-plugin/ fallback below
      } else {
        throw error;
      }
    }

    if (wavePluginDirExists) {
      const manifestPath = path.join(dotWavePluginPath, "plugin.json");
      try {
        const content = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(content) as PluginManifest;
        this.validateManifest(manifest);
        return manifest;
      } catch (error) {
        if (
          error instanceof Error &&
          (error as { code?: string }).code === "ENOENT"
        ) {
          throw new Error(`Plugin manifest not found at ${manifestPath}`);
        }
        throw new Error(
          `Failed to load plugin manifest at ${manifestPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Fallback to .claude-plugin/
    const dotClaudePluginPath = path.join(pluginPath, ".claude-plugin");
    const claudeManifestPath = path.join(dotClaudePluginPath, "plugin.json");
    try {
      const content = await fs.readFile(claudeManifestPath, "utf-8");
      const manifest = JSON.parse(content) as PluginManifest;
      this.validateManifest(manifest);
      return manifest;
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        throw new Error(
          `Plugin manifest not found at ${dotWavePluginPath} or ${dotClaudePluginPath}`,
        );
      }
      throw new Error(
        `Failed to load plugin manifest at ${claudeManifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Load commands from a plugin's commands directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static loadCommands(pluginPath: string): CustomSlashCommand[] {
    const commandsPath = path.join(pluginPath, "commands");
    // Stamp the root here, the way plugin skills get theirs: a command's
    // `${WAVE_PLUGIN_ROOT}` has no other source, and the scanner is shared with
    // user/project command directories that must stay rootless.
    return scanCommandsDirectory(commandsPath).map((command) => ({
      ...command,
      pluginRoot: pluginPath,
    }));
  }

  /**
   * Load skills from a plugin's skills directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static async loadSkills(pluginPath: string): Promise<Skill[]> {
    const skillsPath = path.join(pluginPath, "skills");
    const skills: Skill[] = [];

    try {
      const entries = await fs.readdir(skillsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = path.join(skillsPath, entry.name);
          const skillFilePath = path.join(skillDir, "SKILL.md");
          try {
            await fs.stat(skillFilePath);
            const parsed = parseSkillFile(skillFilePath, {
              basePath: skillDir,
              validateMetadata: true,
              pluginRoot: pluginPath,
            });
            if (parsed.isValid) {
              for (const warning of parsed.warnings) {
                logger?.warn(`Skill ${skillDir}: ${warning}`);
              }
              skills.push({
                ...parsed.skillMetadata,
                type: "project", // Plugin skills are treated as project skills
                pluginRoot: pluginPath,
                content: parsed.content,
                frontmatter: parsed.frontmatter,
                isValid: parsed.isValid,
                errors: parsed.validationErrors,
                warnings: parsed.warnings,
              });
            }
          } catch {
            // Skip directories without SKILL.md
          }
        }
      }
    } catch {
      // skills directory might not exist
    }

    return skills;
  }

  /**
   * Load LSP configuration from a plugin
   */
  static async loadLspConfig(
    pluginPath: string,
  ): Promise<LspConfig | undefined> {
    const lspPath = path.join(pluginPath, ".lsp.json");
    try {
      const content = await fs.readFile(lspPath, "utf-8");
      return JSON.parse(content) as LspConfig;
    } catch {
      return undefined;
    }
  }

  /**
   * Load MCP configuration from a plugin.
   *
   * Accepts both declaration shapes found in the wild (spec plugin A-023): the
   * wrapped `{"mcpServers": {…}}` and the flat `{"<serverName>": {…}}`, matching
   * Claude Code's `parsed.mcpServers || parsed`. A plugin manifest that declares
   * `mcpServers` inline is equivalent to a sibling `.mcp.json`; when both exist
   * they are merged by server name, the file winning.
   *
   * @param manifestMcpServers Inline declarations from the plugin manifest
   */
  static async loadMcpConfig(
    pluginPath: string,
    manifestMcpServers?: Record<string, McpServerConfig>,
  ): Promise<McpConfig | undefined> {
    const servers: Record<string, McpServerConfig> = {
      ...(manifestMcpServers ?? {}),
    };

    const mcpPath = path.join(pluginPath, ".mcp.json");
    try {
      const content = await fs.readFile(mcpPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      // Return raw config — let McpManager resolve templates and capture originalUrl
      Object.assign(servers, extractMcpServers(parsed));
    } catch {
      // no .mcp.json — inline declarations (if any) stand alone
    }

    if (Object.keys(servers).length === 0) return undefined;
    return { mcpServers: servers };
  }

  /**
   * Load hooks configuration from a plugin
   */
  static async loadHooksConfig(
    pluginPath: string,
  ): Promise<PartialHookConfiguration | undefined> {
    const hooksPath = path.join(pluginPath, "hooks", "hooks.json");
    try {
      const content = await fs.readFile(hooksPath, "utf-8");
      const parsed = JSON.parse(content);
      // Claude Code wrapper format: { "hooks": { "SessionStart": [...] } }
      // (optional "description" sibling key)
      if (parsed && typeof parsed === "object" && "hooks" in parsed) {
        return parsed.hooks as PartialHookConfiguration;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Load agent configurations from a plugin's agents directory
   */
  static async loadAgents(
    pluginPath: string,
  ): Promise<SubagentConfiguration[]> {
    const agentsPath = path.join(pluginPath, "agents");
    const agents: SubagentConfiguration[] = [];

    try {
      const entries = await fs.readdir(agentsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const agentFilePath = path.join(agentsPath, entry.name);
          try {
            const config = parseAgentFile(agentFilePath, "plugin", pluginPath);
            agents.push(config);
          } catch (parseError) {
            // Log error but continue with other files
            logger?.warn(
              `Warning: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
          }
        }
      }
    } catch {
      // agents directory might not exist
    }

    return agents;
  }

  /**
   * Load workflow scripts from a plugin's `workflows/` directory.
   *
   * Only `*.js` is accepted (what Claude Code ships); each file goes through the
   * same validation an inline script does — acorn parse, literal-only `meta` as
   * the first statement. A file that fails validation is skipped on its own: it
   * must not fail the plugin or the sibling workflows (spec workflow「调用插件携带
   * 的工作流」场景 1).
   *
   * The invocation name is the file stem, not `meta.name` (场景 2).
   *
   * @param pluginPath Absolute path to the plugin directory
   */
  static async loadWorkflows(pluginPath: string): Promise<PluginWorkflow[]> {
    const workflowsPath = path.join(pluginPath, "workflows");
    const workflows: PluginWorkflow[] = [];

    try {
      const entries = await fs.readdir(workflowsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          !entry.name.endsWith(WORKFLOW_SCRIPT_EXTENSION)
        ) {
          continue;
        }
        const scriptPath = path.join(workflowsPath, entry.name);
        try {
          const script = await fs.readFile(scriptPath, "utf-8");
          const validation = validateScript(script);
          if (!validation.valid) {
            logger?.warn(
              `Skipping plugin workflow ${scriptPath}: ${validation.errors.join("; ")}`,
            );
            continue;
          }
          const { meta } = parseScript(script);
          workflows.push({
            name: entry.name.slice(0, -WORKFLOW_SCRIPT_EXTENSION.length),
            description: meta.description,
            path: scriptPath,
            meta,
          });
        } catch (error) {
          logger?.warn(
            `Skipping plugin workflow ${scriptPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch {
      // workflows directory might not exist
    }

    return workflows;
  }

  /**
   * Collect the mod files of a plugin, from either layout.
   *
   * Two layouts are accepted (spec「兼容社区 mod」): our `<pluginRoot>/mods/`
   * directory, whose file stems are the mod names, and the community's
   * `<pluginRoot>/hooks/hooks.json` declaring `{ "modules": ["./register.tsx"] }`
   * — the entry paths are relative to the plugin root. Both end up in the same
   * list, sharing one id namespace, one set of limits and one set of checks.
   *
   * Only paths and sizes are gathered here — compilation needs esbuild, an
   * on-demand runtime dependency that may not be installed yet, so it happens
   * in `managers/modManager.ts` right before a session uses the mod.
   *
   * The entry names are the file stems and the ids are `<plugin>:<stem>`, the
   * same `<plugin>:<name>` shape commands and workflows use. Files are resolved
   * through `realpath` and dropped when the result escapes the plugin
   * directory (a symlink pointing outside must not become loadable code), and
   * the spec's per-file / total / count limits are enforced here so an
   * oversized mod never reaches the compiler.
   */
  static async loadMods(
    pluginPath: string,
    pluginName: string,
  ): Promise<PluginMod[]> {
    const mods: PluginMod[] = [];
    let realRoot: string;
    try {
      realRoot = await fs.realpath(pluginPath);
    } catch {
      return mods;
    }

    const entries = await this.collectModCandidates(pluginPath);
    const candidates = await PluginLoader.expandEntryImports(
      pluginPath,
      entries,
    );

    if (candidates.length === 0) return mods;

    let totalBytes = 0;
    const seenPaths = new Set<string>();
    const seenIds = new Set<string>();
    // 入口文件（真的会变成 mod 的那些）。入口之后收进来的是被 import 的兄弟
    // 文件，它们的 id 永远不会露出来（`ModRuntime.load()` 对没有导出
    // `register` 的文件直接跳过），所以允许同名的兄弟文件都留下 ——
    // 只按文件名去重会把多文件社区 mod 的 `features/a/index.ts` 与
    // `features/b/index.ts` 顶掉一个，随后入口 `require` 就报找不到模块。
    const entryPaths = new Set(entries.map((entry) => path.resolve(entry)));
    for (const filePath of candidates) {
      if (mods.length >= MOD_LIMITS.fileCount) {
        logger?.warn(
          `插件 ${pluginName} 的 mod 文件超过 ${MOD_LIMITS.fileCount} 个，其余被忽略`,
        );
        break;
      }
      try {
        const realPath = await fs.realpath(filePath);
        if (
          realPath !== realRoot &&
          !realPath.startsWith(realRoot + path.sep)
        ) {
          logger?.warn(`忽略越出插件目录的 mod 文件：${filePath}`);
          continue;
        }
        // 两种布局可能指向同一个文件（社区插件常常两处都放），也允许同一个
        // 目录被写两遍：同一个 realpath 只收一次。
        if (seenPaths.has(realPath)) continue;
        const stat = await fs.stat(realPath);
        if (stat.size > MOD_LIMITS.fileBytes) {
          logger?.warn(
            `忽略超过 ${MOD_LIMITS.fileBytes} 字节的 mod 文件：${filePath}`,
          );
          continue;
        }
        const stem = path.parse(filePath).name;
        let id = `${pluginName}:${stem}`;
        // id 是面板/命令的归属键，入口重名会让两个 mod 互相顶掉：先到先得，
        // 后来的记一条 warn 丢掉。兄弟文件只是编译集里的一项，给个唯一后缀留住。
        if (seenIds.has(id)) {
          if (entryPaths.has(path.resolve(filePath))) {
            logger?.warn(
              `插件 ${pluginName} 有两个同名 mod 文件（${stem}），跳过：${filePath}`,
            );
            continue;
          }
          let suffix = 2;
          while (seenIds.has(`${id}~${suffix}`)) suffix += 1;
          id = `${id}~${suffix}`;
        }
        totalBytes += stat.size;
        if (totalBytes > MOD_LIMITS.totalBytes) {
          logger?.warn(
            `插件 ${pluginName} 的 mod 文件总量超过 ${MOD_LIMITS.totalBytes} 字节，其余被忽略`,
          );
          break;
        }
        seenPaths.add(realPath);
        seenIds.add(id);
        mods.push({
          id,
          name: stem,
          path: realPath,
          pluginRoot: pluginPath,
        });
      } catch (error) {
        logger?.warn(
          `读取 mod 文件失败：${filePath}（${error instanceof Error ? error.message : String(error)}）`,
        );
      }
    }
    return mods;
  }

  /**
   * 两种布局下的候选入口文件（绝对路径，按稳定顺序）。
   *
   * 读失败一律当「这个布局没有 mod」：与 `loadSkills` / `loadAgents` 的口径
   * 一致 —— 插件加载不该因为一次目录/文件读取问题整体失败（那会连带丢掉命令、
   * 技能等已就绪的能力）。
   */
  private static async collectModCandidates(
    pluginPath: string,
  ): Promise<string[]> {
    const candidates: string[] = [];

    // 我们的布局：`mods/` 目录里的每个文件都是一个 mod，文件名排序即加载顺序。
    const modsPath = path.join(pluginPath, "mods");
    try {
      const entries = (
        await fs.readdir(modsPath, { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (
          !MOD_LOADER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ) {
          continue;
        }
        candidates.push(path.join(modsPath, entry.name));
      }
    } catch {
      // No mods directory — the common case.
    }

    // 社区的布局：`hooks/hooks.json` 声明模块入口。同一个文件里 `hooks` 段
    // （settings hook 事件）与 `modules` 段（mod 入口）互不相干，可以共存。
    // `modules` 里的路径**相对 `hooks/` 目录**（`./register.tsx` 就摆在
    // `hooks.json` 旁边），不是相对插件根 —— 社区抓取脚本同样是这么拼的。
    const hooksDir = path.join(pluginPath, "hooks");
    const hooksPath = path.join(hooksDir, "hooks.json");
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(hooksPath, "utf-8"));
      const modules =
        parsed && typeof parsed === "object" && "modules" in parsed
          ? (parsed as { modules?: unknown }).modules
          : undefined;
      if (Array.isArray(modules)) {
        for (const entry of modules) {
          if (typeof entry !== "string" || entry.length === 0) {
            logger?.warn(
              `插件 ${pluginPath} 的 hooks.json 里有非字符串的 modules 项，已忽略`,
            );
            continue;
          }
          candidates.push(path.resolve(hooksDir, entry));
        }
      }
    } catch {
      // 没有 hooks.json，或它不是合法 JSON：这个布局没有 mod。
    }

    return candidates;
  }

  /**
   * 把入口的相对 import 递归收进编译集。
   *
   * mod 的模块图由沙箱自己的 `require` 走（只认相对路径与 `wave-agent-sdk/mods`），
   * 而它只能在**已编译**的文件里找 —— 不把入口 import 的兄弟文件一起读进来，
   * `import { lineDelta } from "../lib/diff"` 就会当场报「找不到模块」。收进来的
   * 只是编译集：除了入口，其余文件在 `ModRuntime.load()` 里被判成「没有导出
   * `register`」，不会变成 mod（不占面板、不注册钩子 —— 见 `managers/modManager.ts`
   * 里那条 `continue`）。
   *
   * 解析规则与沙箱的 `require` 保持一致（同一张候选表：原样、`.tsx` / `.ts` /
   * `.jsx` / `.js`、`/index.*`），路径一律 `realpath` 之后再判是否越出插件目录：
   * 越界的不读也不收，与 `loadMods` 对入口的 realpath 校验同一条口径。
   * 总量受 `MOD_LIMITS.fileCount` 约束 —— 它本来就是「一个插件最多几个 mod 文件」。
   */
  private static async expandEntryImports(
    pluginPath: string,
    entries: string[],
  ): Promise<string[]> {
    const root = await realPathOr(pluginPath);
    const inside = (file: string) => file.startsWith(root + path.sep);
    const collected = [...entries];
    const seen = new Set<string>();
    for (const entry of collected) seen.add(await realPathOr(entry));

    for (
      let index = 0;
      index < collected.length && collected.length < MOD_LIMITS.fileCount;
      index += 1
    ) {
      const file = collected[index]!;
      let source: unknown;
      try {
        source = await fs.readFile(file, "utf-8");
      } catch {
        continue;
      }
      if (typeof source !== "string") continue;
      for (const specifier of relativeImportSpecifiers(source)) {
        const target = await resolveImportFile(
          path.resolve(path.dirname(file), specifier),
        );
        if (!target || seen.has(target) || !inside(target)) continue;
        seen.add(target);
        collected.push(target);
      }
    }
    return collected;
  }

  /**
   * Validate the plugin manifest structure
   */
  private static validateManifest(manifest: PluginManifest): void {
    if (!manifest.name) {
      throw new Error("Plugin manifest missing 'name'");
    }
    if (!manifest.description) {
      throw new Error("Plugin manifest missing 'description'");
    }
    // `version` is optional: the Claude Code ecosystem omits it freely and the
    // install path already defaults it (spec plugin A-022).
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      throw new Error(
        `Invalid plugin name: ${manifest.name}. Only lowercase letters, numbers, and hyphens are allowed.`,
      );
    }
  }
}

/**
 * 源文件里所有**相对**模块说明符（`import … from` / `export … from` /
 * `import(…)` / `require(…)` / 只求副作用的 `import "…"`），去重、按出现顺序。
 *
 * 正则会命中字符串与注释里的同形片段 —— 无害：解析出来不是文件就丢掉，真正
 * 找不到模块时的报错仍在沙箱的 `require` 那一步，这里不重复报。
 */
function relativeImportSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"\n]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]!;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
    if (!found.includes(specifier)) found.push(specifier);
  }
  return found;
}

/**
 * `./x` 解析成真实文件：候选表与沙箱 `require` 的 `moduleCandidates` 一致。
 * 返回 `realpath`（调用方按它判越界与去重），找不到就 `undefined`。
 */
async function resolveImportFile(target: string): Promise<string | undefined> {
  const candidates = [
    target,
    // TS 的 ESM 写法：源码里写 `import "./x.js"`，磁盘上只有 `x.ts` / `x.tsx`
    // （社区插件普遍这么写）。放在字面量之后 ⇒ 真有 `x.js` 时仍然它优先。
    ...sourceSuffixVariants(target),
    `${target}.tsx`,
    `${target}.ts`,
    `${target}.jsx`,
    `${target}.js`,
    path.join(target, "index.tsx"),
    path.join(target, "index.ts"),
    path.join(target, "index.jsx"),
    path.join(target, "index.js"),
  ];
  for (const candidate of candidates) {
    if (!MOD_LOADER_EXTENSIONS.has(path.extname(candidate).toLowerCase())) {
      continue;
    }
    try {
      if (!(await fs.stat(candidate)).isFile()) continue;
      return await realPathOr(candidate);
    } catch {
      // 换下一个候选。
    }
  }
  return undefined;
}

/**
 * `.js` / `.jsx` 说明符对应的 TS 源码文件（`./x.js` → `x.ts` / `x.tsx`）。
 *
 * 沙箱 `require` 里有一份同样的表（`runtime.ts` 的 `moduleCandidates`）——
 * 收编译集时不认这个映射，文件就不在编译集里，入口照样报找不到模块。
 */
export function sourceSuffixVariants(target: string): string[] {
  const ext = path.extname(target).toLowerCase();
  const withoutExt = target.slice(0, target.length - ext.length);
  if (ext === ".js") return [`${withoutExt}.ts`, `${withoutExt}.tsx`];
  if (ext === ".jsx") return [`${withoutExt}.tsx`];
  return [];
}

/** `realpath`，失败时退回 `path.resolve`（文件不在时后面会各自处理）。 */
async function realPathOr(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch {
    return path.resolve(file);
  }
}

/**
 * Normalizes an MCP declaration to a server map, accepting both the wrapped and
 * the flat shape (spec plugin A-023). Anything that is not an object of server
 * configs yields an empty map rather than throwing, so one malformed declaration
 * cannot fail the whole plugin.
 */
function extractMcpServers(parsed: unknown): Record<string, McpServerConfig> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const wrapped = record.mcpServers;
  const servers =
    wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
      ? (wrapped as Record<string, McpServerConfig>)
      : (record as Record<string, McpServerConfig>);
  return servers;
}
