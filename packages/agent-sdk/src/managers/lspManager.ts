import { ChildProcess, spawn } from "child_process";
import {
  Logger,
  LspConfig,
  LspServerConfig,
  ILspManager,
  LspCallHierarchyItem,
} from "../types/index.js";
import { join, isAbsolute, extname } from "path";
import { promises as fs } from "fs";

interface LspProcess {
  process: ChildProcess;
  config: LspServerConfig;
  language: string;
  initialized: boolean;
  requestId: number;
  pendingRequests: Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >;
  openedFiles: Set<string>;
}

export class LspManager implements ILspManager {
  private processes: Map<string, LspProcess> = new Map();
  private workdir: string = "";
  private logger?: Logger;
  private config: LspConfig = {};

  constructor(options: { logger?: Logger } = {}) {
    this.logger = options.logger;
  }

  async initialize(workdir: string): Promise<void> {
    this.workdir = workdir;
    await this.loadConfig();
  }

  registerServer(language: string, config: LspServerConfig): void {
    this.config[language] = config;
    this.logger?.debug(`Registered LSP server for ${language}`);
  }

  private async loadConfig(): Promise<void> {
    const lspJsonPath = join(this.workdir, ".lsp.json");
    try {
      const content = await fs.readFile(lspJsonPath, "utf-8");
      const newConfig = JSON.parse(content);
      this.config = { ...this.config, ...newConfig };
      this.logger?.debug(`Loaded LSP config from ${lspJsonPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger?.error(`Failed to load .lsp.json: ${error}`);
      }
    }
  }

  async getProcessForFile(filePath: string): Promise<LspProcess | null> {
    const extension = extname(filePath);
    let language: string | null = null;

    for (const [lang, cfg] of Object.entries(this.config)) {
      if (cfg.extensionToLanguage[extension]) {
        language = lang;
        break;
      }
    }

    if (!language) return null;

    let lspProc = this.processes.get(language);
    if (!lspProc) {
      const serverConfig = this.config[language];
      const startedProc = await this.startServer(language, serverConfig);
      if (startedProc) {
        this.processes.set(language, startedProc);
        lspProc = startedProc;
      }
    }

    return lspProc || null;
  }

  private async startServer(
    language: string,
    config: LspServerConfig,
  ): Promise<LspProcess | null> {
    this.logger?.info(
      `Starting LSP server for ${language}: ${config.command} ${config.args?.join(" ") || ""}`,
    );

    try {
      const proc = spawn(config.command, config.args || [], {
        cwd: config.workspaceFolder || this.workdir,
        env: { ...process.env, ...config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const lspProc: LspProcess = {
        process: proc,
        config,
        language,
        initialized: false,
        requestId: 0,
        pendingRequests: new Map(),
        openedFiles: new Set(),
      };

      let buffer = Buffer.alloc(0);
      let contentLength = -1;

      proc.stdout!.on("data", (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);

        while (true) {
          const str = buffer.toString("utf-8");
          if (contentLength === -1) {
            const headerEnd = str.indexOf("\r\n\r\n");
            if (headerEnd === -1) break;

            const headers = str.substring(0, headerEnd).split("\r\n");
            const contentLengthHeader = headers.find((h) =>
              h.startsWith("Content-Length: "),
            );
            if (contentLengthHeader) {
              contentLength = parseInt(contentLengthHeader.substring(16), 10);
            }
            buffer = buffer.subarray(headerEnd + 4);
            continue;
          }

          if (buffer.length >= contentLength) {
            const content = buffer.subarray(0, contentLength).toString("utf-8");
            buffer = buffer.subarray(contentLength);
            contentLength = -1;

            try {
              const message = JSON.parse(content);
              this.handleMessage(lspProc, message);
            } catch (e) {
              this.logger?.error(`Failed to parse LSP message: ${e}`);
            }
          } else {
            break;
          }
        }
      });

      proc.stderr!.on("data", (data) => {
        this.logger?.debug(`LSP [${language}] stderr: ${data}`);
      });

      proc.on("close", (code) => {
        this.logger?.info(
          `LSP server for ${language} exited with code ${code}`,
        );
        this.processes.delete(language);
      });

      // Initialize
      await this.sendRequest(
        lspProc,
        "initialize",
        {
          processId: process.pid,
          rootUri: `file://${this.workdir}`,
          capabilities: {},
          initializationOptions: config.initializationOptions,
        },
        config.startupTimeout,
      );
      await this.sendNotification(lspProc, "initialized", {});
      lspProc.initialized = true;

      return lspProc;
    } catch (error) {
      this.logger?.error(
        `Failed to start LSP server for ${language}: ${error}`,
      );
      return null;
    }
  }

  private handleMessage(
    lspProc: LspProcess,
    message: { id?: number; error?: unknown; result?: unknown },
  ) {
    if (message.id !== undefined) {
      const pending = lspProc.pendingRequests.get(message.id);
      if (pending) {
        lspProc.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  private async sendRequest(
    lspProc: LspProcess,
    method: string,
    params: unknown,
    timeout?: number,
  ): Promise<unknown> {
    const id = lspProc.requestId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n`;

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      if (timeout) {
        timer = setTimeout(() => {
          lspProc.pendingRequests.delete(id);
          reject(
            new Error(`LSP request ${method} timed out after ${timeout}ms`),
          );
        }, timeout);
      }

      lspProc.pendingRequests.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          if (timer) clearTimeout(timer);
          reject(reason);
        },
      });
      lspProc.process.stdin!.write(header + json);
    });
  }

  private async sendNotification(
    lspProc: LspProcess,
    method: string,
    params: unknown,
  ): Promise<void> {
    const message = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n`;
    lspProc.process.stdin!.write(header + json);
  }

  async execute(args: {
    operation: string;
    filePath: string;
    line: number;
    character: number;
  }): Promise<{ success: boolean; content: string }> {
    const { operation, filePath, line, character } = args;
    const absolutePath = isAbsolute(filePath)
      ? filePath
      : join(this.workdir, filePath);
    const lspProc = await this.getProcessForFile(absolutePath);

    if (!lspProc) {
      return {
        success: false,
        content: `No LSP server configured for file: ${filePath}`,
      };
    }

    const uri = `file://${absolutePath}`;
    const position = { line: line - 1, character: character - 1 };

    if (!lspProc.openedFiles.has(absolutePath)) {
      try {
        const content = await fs.readFile(absolutePath, "utf-8");
        await this.sendNotification(lspProc, "textDocument/didOpen", {
          textDocument: {
            uri,
            languageId: lspProc.language,
            version: 1,
            text: content,
          },
        });
        lspProc.openedFiles.add(absolutePath);
      } catch (error) {
        this.logger?.error(`Failed to read file for LSP didOpen: ${error}`);
      }
    }

    try {
      let result: unknown;
      switch (operation) {
        case "goToDefinition":
          result = await this.sendRequest(lspProc, "textDocument/definition", {
            textDocument: { uri },
            position,
          });
          break;
        case "hover":
          result = await this.sendRequest(lspProc, "textDocument/hover", {
            textDocument: { uri },
            position,
          });
          break;
        case "findReferences":
          result = await this.sendRequest(lspProc, "textDocument/references", {
            textDocument: { uri },
            position,
            context: { includeDeclaration: true },
          });
          break;
        case "documentSymbol":
          result = await this.sendRequest(
            lspProc,
            "textDocument/documentSymbol",
            {
              textDocument: { uri },
            },
          );
          break;
        case "workspaceSymbol":
          result = await this.sendRequest(lspProc, "workspace/symbol", {
            query: "", // For now, use empty query to get all symbols or let server decide
          });
          break;
        case "goToImplementation":
          result = await this.sendRequest(
            lspProc,
            "textDocument/implementation",
            {
              textDocument: { uri },
              position,
            },
          );
          break;
        case "prepareCallHierarchy":
          result = await this.sendRequest(
            lspProc,
            "textDocument/prepareCallHierarchy",
            {
              textDocument: { uri },
              position,
            },
          );
          break;
        case "incomingCalls": {
          const items = (await this.sendRequest(
            lspProc,
            "textDocument/prepareCallHierarchy",
            {
              textDocument: { uri },
              position,
            },
          )) as LspCallHierarchyItem[];
          if (items && items.length > 0) {
            result = await this.sendRequest(
              lspProc,
              "callHierarchy/incomingCalls",
              {
                item: items[0],
              },
            );
          } else {
            result = [];
          }
          break;
        }
        case "outgoingCalls": {
          const items = (await this.sendRequest(
            lspProc,
            "textDocument/prepareCallHierarchy",
            {
              textDocument: { uri },
              position,
            },
          )) as LspCallHierarchyItem[];
          if (items && items.length > 0) {
            result = await this.sendRequest(
              lspProc,
              "callHierarchy/outgoingCalls",
              {
                item: items[0],
              },
            );
          } else {
            result = [];
          }
          break;
        }
        // Add more operations as needed
        default:
          return {
            success: false,
            content: `Unsupported LSP operation: ${operation}`,
          };
      }

      return { success: true, content: JSON.stringify(result) };
    } catch (error) {
      return { success: false, content: `LSP error: ${JSON.stringify(error)}` };
    }
  }

  async cleanup(): Promise<void> {
    for (const [language, lspProc] of this.processes.entries()) {
      try {
        // Try graceful shutdown
        const timeout = lspProc.config.shutdownTimeout || 2000;
        await this.sendRequest(lspProc, "shutdown", {}, timeout);
        await this.sendNotification(lspProc, "exit", {});
        // Give it a moment to exit
        if (timeout > 100) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        this.logger?.debug(
          `Failed to gracefully shutdown LSP for ${language}: ${error}`,
        );
      } finally {
        if (!lspProc.process.killed) {
          lspProc.process.kill();
        }
      }
    }
    this.processes.clear();
  }
}
