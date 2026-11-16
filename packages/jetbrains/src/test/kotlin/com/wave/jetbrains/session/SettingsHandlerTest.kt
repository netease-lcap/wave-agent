package com.wave.jetbrains.session

import com.intellij.openapi.project.Project
import com.wave.jetbrains.stdio.AgentCallbacks
import com.wave.jetbrains.stdio.NotificationRouter
import com.wave.jetbrains.stdio.StdioAgent
import com.wave.jetbrains.stdio.StdioClient
import com.wave.jetbrains.stdio.StdioClientException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.lang.reflect.Proxy
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Tests for the settings-page commands handled by [MessageHandler]: the write
 * commands that must reach a live agent over stdio ([MessageHandler.dispatch],
 * branches `deleteSkill` / `deleteHook` / `removeMcpServer` / `setAgentsContent` /
 * `setBuiltinPluginEnabled`) and the "no live session" fallback (agent == null).
 *
 * Harness: the handler is a normal class, so the test wires one up directly with
 * a real [WaveSession] whose `agent` is a real [StdioAgent] talking over a real
 * [StdioClient] to a tiny fake `wave --stdio` server (`node`, spawned per test).
 * That exercises the genuine path — coroutine dispatch → StdioAgent → JSON-RPC wire
 * → reply handling → `postMessage` — without the IntelliJ application.
 *
 * Why the two test doubles:
 *  - `Project` is a reflective proxy: the settings handlers only touch it through
 *    [com.wave.jetbrains.ide.IdeService] / `WaveBackendService`, and the JUnit5-only
 *    test classpath has no mockk/Mockito and no usable project fixture.
 *  - `WaveSession.agent` has a private setter with no public seam, so the fake
 *    backend's real `StdioAgent` is injected reflectively.
 *
 * [com.wave.jetbrains.ide.IdeService] (an `object` calling platform statics) has no
 * seam, so its showInfo/showError branch is NOT observable from a unit test — the
 * commands that emit no `postMessage` (`deleteSkill`, `removeMcpServer`) are asserted
 * on the RPC the fake CLI actually received.
 */
class SettingsHandlerTest {

    @TempDir
    lateinit var tempDir: Path

    private val openClients = mutableListOf<StdioClient>()

    @AfterEach
    fun closeFakeClients() {
        openClients.forEach { runCatching { it.close() } }
        openClients.clear()
    }

    // ── 成功路径 ────────────────────────────────────────────────────

    @Test
    fun `setAgentsContent forwards the edit to the agent and reports ok`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("project"),
            "content" to JsonPrimitive("# AGENTS.md"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )

        val payload = fx.awaitPosted("agentsContentSaved")
        assertEquals("project", payload["scope"]?.jsonPrimitive?.content)
        assertTrue(
            payload["ok"]?.jsonPrimitive?.booleanOrNull == true,
            "a live agent must report ok=true, payload was $payload",
        )

        val rpc = fx.awaitRpc("setAgentsContent")
        assertEquals("project", rpc.params()["scope"]?.jsonPrimitive?.content)
        assertEquals("# AGENTS.md", rpc.params()["content"]?.jsonPrimitive?.content)
        assertEquals("/tmp/wave-wd", rpc.params()["workdir"]?.jsonPrimitive?.content)
    }

    @Test
    fun `deleteHook deletes the hook then re-pushes the scope-scoped hooks`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "deleteHook",
            "scope" to JsonPrimitive("user"),
            "hookName" to JsonPrimitive("PreToolUse"),
        )

        // Success path re-reads the scope and answers with hooksResponse.
        val payload = fx.awaitPosted("hooksResponse")
        assertEquals("user", payload["scope"]?.jsonPrimitive?.content)
        assertEquals(
            "user",
            payload["hooks"]?.jsonObject?.get("scopedTo")?.jsonPrimitive?.content,
            "hooks must be re-read from the same scope that was deleted",
        )
        assertEquals("/fake/settings.json", payload["configPath"]?.jsonPrimitive?.content)

        val delete = fx.awaitRpc("deleteHook")
        assertEquals("user", delete.params()["scope"]?.jsonPrimitive?.content)
        assertEquals("PreToolUse", delete.params()["hookName"]?.jsonPrimitive?.content)
        // The refresh is a second RPC, not a cached payload.
        assertEquals("user", fx.awaitRpc("getHooksByScope").params()["scope"]?.jsonPrimitive?.content)
    }

    @Test
    fun `deleteSkill forwards the skill name to the agent`() {
        val fx = Fixture(connectAgent = true)

        fx.send("deleteSkill", "name" to JsonPrimitive("my-skill"))

        val rpc = fx.awaitRpc("deleteSkill")
        assertEquals("my-skill", rpc.params()["name"]?.jsonPrimitive?.content)
    }

    @Test
    fun `removeMcpServer forwards scope and server name to the agent`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "removeMcpServer",
            "scope" to JsonPrimitive("user"),
            "serverName" to JsonPrimitive("github"),
        )

        val rpc = fx.awaitRpc("removeMcpServer")
        assertEquals("user", rpc.params()["scope"]?.jsonPrimitive?.content)
        assertEquals("github", rpc.params()["serverName"]?.jsonPrimitive?.content)
    }

    @Test
    fun `setBuiltinPluginEnabled pushes projectSettings with the new toggle state`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "setBuiltinPluginEnabled",
            "pluginId" to JsonPrimitive("sdd"),
            "enabled" to JsonPrimitive(true),
            "scope" to JsonPrimitive("project"),
        )

        val payload = fx.awaitPosted("projectSettings")
        assertTrue(
            payload["enabledPlugins"]?.jsonObject?.get("sdd")?.jsonPrimitive?.booleanOrNull == true,
            "enabledPlugins must carry the toggled plugin, payload was $payload",
        )
        // No live workdir on the agent → the handler falls back to the JVM cwd
        // (project.basePath is null for the test double).
        val workdir = System.getProperty("user.dir")
        assertEquals(workdir, payload["workdir"]?.jsonPrimitive?.content)

        val rpc = fx.awaitRpc("setBuiltinPluginEnabled")
        assertEquals("sdd", rpc.params()["pluginId"]?.jsonPrimitive?.content)
        assertTrue(rpc.params()["enabled"]?.jsonPrimitive?.booleanOrNull == true)
        assertEquals("project", rpc.params()["scope"]?.jsonPrimitive?.content)
        assertEquals(workdir, rpc.params()["workdir"]?.jsonPrimitive?.content)
    }

    @Test
    fun `reloadPlugins forwards the in-place reload to the CLI`() {
        val fx = Fixture(connectAgent = true)

        fx.send("reloadPlugins")

        // 插件变更的就地重载（spec ecosystem/plugin.md）：宿主只把命令转发给 CLI，
        // 由 CLI 对全部 live 会话就地换装，不做任何重建。IdeService 的成功/失败
        // 提示无测试缝（见类 KDoc），因此断言落在真正走到的 RPC 上。
        val rpc = fx.awaitRpc("reloadPlugins")
        assertTrue(rpc.params().isEmpty(), "params must be empty, was ${rpc.params()}")
    }

    // ── 无 live session 回退（settings tab 独立打开、聊天会话未初始化）──────
    //
    // spec core/memory-management「设置页三档记忆编辑器」场景 5：没有活跃会话时三档读写
    // 仍必须工作（无会话时直读直写文件）。插件端因此和桌面端 / VSCE 同形 —— 经共享
    // CLI 进程发同名 RPC，CLI 侧在没有 session id 时直读直写磁盘。

    @Test
    fun `setAgentsContent without a live agent still saves through the shared CLI process`() {
        val fx = Fixture(connectAgent = false)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("user"),
            "content" to JsonPrimitive("# AGENTS.md"),
        )

        val payload = fx.awaitPosted("agentsContentSaved")
        assertEquals("user", payload["scope"]?.jsonPrimitive?.content)
        assertTrue(
            payload["ok"]?.jsonPrimitive?.booleanOrNull == true,
            "no live agent must still save (spec 场景 5), payload was $payload",
        )

        val rpc = fx.awaitRpc("setAgentsContent")
        assertEquals("# AGENTS.md", rpc.params()["content"]?.jsonPrimitive?.content)
        // 没有会话 ⇒ 不发会话 id，CLI 走直写文件那条分支（假 CLI 把缺失记成 JSON null）。
        assertNull(
            rpc["sessionId"]?.jsonPrimitive?.contentOrNull,
            "no session must mean no sessionId on the envelope",
        )
    }

    @Test
    fun `getAgentsContent without a live agent reads through the shared CLI process`() {
        val fx = Fixture(connectAgent = false)

        fx.send(
            "getAgentsContent",
            "scope" to JsonPrimitive("project"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )

        val payload = fx.awaitPosted("agentsContentResponse")
        assertEquals("project", payload["scope"]?.jsonPrimitive?.content)
        assertEquals(
            "# from disk",
            payload["content"]?.jsonPrimitive?.content,
            "a read with no live agent must return the file content, not a silent empty string",
        )
        val rpc = fx.awaitRpc("getAgentsContent")
        assertEquals("/tmp/wave-wd", rpc.params()["workdir"]?.jsonPrimitive?.content)
        assertNull(rpc["sessionId"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun `setAgentsContent without a reachable CLI reports why instead of a vague failure`() {
        val fx = Fixture(connectAgent = false, utilityAvailable = false)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("local"),
            "content" to JsonPrimitive("# x"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )

        val payload = fx.awaitPosted("agentsContentSaved")
        assertTrue(payload["ok"]?.jsonPrimitive?.booleanOrNull == false)
        // 失败原因原样带出来（写盘失败 / CLI 连不上），不是笼统的「智能体未初始化」。
        assertEquals(
            "wave --stdio process is not running",
            payload["error"]?.jsonPrimitive?.content,
        )
    }

    @Test
    fun `getAgentsContent without a reachable CLI still settles the editor`() {
        val fx = Fixture(connectAgent = false, utilityAvailable = false)

        fx.send(
            "getAgentsContent",
            "scope" to JsonPrimitive("project"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )

        // 回包必须到（否则设置页的编辑器停在「尚未加载」）；失败本身经 IdeService 的
        // IDE 错误气泡告知（那个 object 没有测试缝，见类 KDoc），回包里的空白因此
        // **不是**「读到空文件」的证据。
        val payload = fx.awaitPosted("agentsContentResponse")
        assertEquals("", payload["content"]?.jsonPrimitive?.content)
        // 「读不到」要和「文件是空的」可区分（spec 场景 10）：readable:false + 原因，
        // 形状与 CLI 自己读不到时一致（exists 占位 true、hash null）。两个布尔值都
        // 必须在 —— 缺了它们 webview 会把回包当成「老宿主」并退回「可编辑、不校验」。
        assertTrue(
            payload["readable"]?.jsonPrimitive?.booleanOrNull == false,
            "a failed read must not look like an empty file, payload was $payload",
        )
        assertTrue(payload["exists"]?.jsonPrimitive?.booleanOrNull == true)
        assertEquals(JsonNull, payload["hash"])
        assertEquals(
            "wave --stdio process is not running",
            payload["error"]?.jsonPrimitive?.content,
        )
    }

    // ── 并发保护 / 读状态透传（spec 场景 8/10/12/13）──────────────────────
    //
    // 判定全在 CLI（hash 是否一致、要不要拒绝写入），宿主只搬字段。但三态必须
    // 原样过去：字符串 / 显式 null（编辑时文件不存在）/ 字段缺失（不校验）。

    @Test
    fun `getAgentsContent forwards the read state verbatim`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "getAgentsContent",
            "scope" to JsonPrimitive("project"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )

        val payload = fx.awaitPosted("agentsContentResponse")
        assertEquals("# from disk", payload["content"]?.jsonPrimitive?.content)
        assertEquals("/tmp/wave-wd/AGENTS.md", payload["path"]?.jsonPrimitive?.content)
        assertTrue(payload["exists"]?.jsonPrimitive?.booleanOrNull == true)
        assertTrue(payload["readable"]?.jsonPrimitive?.booleanOrNull == true)
        assertEquals("sha256:abc123", payload["hash"]?.jsonPrimitive?.content)
    }

    @Test
    fun `getAgentsContent keeps a null hash as JSON null instead of dropping it`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "getAgentsContent",
            "scope" to JsonPrimitive("local"),
            "workdir" to JsonPrimitive("/tmp/wave-wd-missing"),
        )

        // 文件不存在但读成功：exists=false + `hash: null`（不是缺 hash）。
        val payload = fx.awaitPosted("agentsContentResponse")
        assertTrue(payload["exists"]?.jsonPrimitive?.booleanOrNull == false)
        assertTrue(payload.containsKey("hash"), "hash must be present, was $payload")
        assertEquals(JsonNull, payload["hash"])
    }

    @Test
    fun `setAgentsContent forwards the expectedHash it was given`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("project"),
            "content" to JsonPrimitive("# new rules"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
            "expectedHash" to JsonPrimitive("sha256:abc123"),
        )

        fx.awaitPosted("agentsContentSaved")
        val rpc = fx.awaitRpc("setAgentsContent")
        assertEquals("sha256:abc123", rpc.params()["expectedHash"]?.jsonPrimitive?.content)
        assertTrue(rpc.params()["expectedHash"] !is JsonNull)
    }

    @Test
    fun `setAgentsContent sends an explicit null expectedHash as JSON null`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("local"),
            "content" to JsonPrimitive("# mine"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
            "expectedHash" to JsonNull,
        )

        fx.awaitPosted("agentsContentSaved")
        val rpc = fx.awaitRpc("setAgentsContent")
        // 显式 null = 「编辑时文件还不存在」：字段必须在，值是 JSON null。
        assertTrue(
            rpc.params().containsKey("expectedHash"),
            "expectedHash:null must not be dropped, was ${rpc.params()}",
        )
        assertEquals(JsonNull, rpc.params()["expectedHash"])
    }

    @Test
    fun `setAgentsContent omits expectedHash when the webview sent none`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("local"),
            "content" to JsonPrimitive("# mine"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )

        fx.awaitPosted("agentsContentSaved")
        val rpc = fx.awaitRpc("setAgentsContent")
        // 省略 = 不校验（老 webview / 未升级调用方，spec 场景 13）。
        assertFalse(
            rpc.params().containsKey("expectedHash"),
            "an omitted hash must stay omitted, was ${rpc.params()}",
        )
    }

    @Test
    fun `setAgentsContent relays a conflict instead of reporting success`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("project"),
            "content" to JsonPrimitive("# new rules"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
            "expectedHash" to JsonPrimitive("sha256:stale"),
        )

        val payload = fx.awaitPosted("agentsContentSaved")
        assertTrue(payload["ok"]?.jsonPrimitive?.booleanOrNull == false)
        assertTrue(payload["conflict"]?.jsonPrimitive?.booleanOrNull == true)
        assertEquals("文件已被外部改动", payload["error"]?.jsonPrimitive?.content)
    }

    // 无 live agent 的兜底路径（utility client）同样要透传这四类字段，否则设置页
    // 在会话创建前打开时拿不到 hash，编辑器永远停在只读态。

    @Test
    fun `getAgentsContent without a live agent forwards the read state too`() {
        val fx = Fixture(connectAgent = false)

        fx.send(
            "getAgentsContent",
            "scope" to JsonPrimitive("project"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )

        val payload = fx.awaitPosted("agentsContentResponse")
        assertEquals("# from disk", payload["content"]?.jsonPrimitive?.content)
        assertEquals("sha256:abc123", payload["hash"]?.jsonPrimitive?.content)
        assertTrue(payload["exists"]?.jsonPrimitive?.booleanOrNull == true)
        assertTrue(payload["readable"]?.jsonPrimitive?.booleanOrNull == true)
        assertEquals("/tmp/wave-wd/AGENTS.md", payload["path"]?.jsonPrimitive?.content)
    }

    @Test
    fun `setAgentsContent without a live agent forwards an explicit null expectedHash`() {
        val fx = Fixture(connectAgent = false)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("user"),
            "content" to JsonPrimitive("# AGENTS.md"),
            "expectedHash" to JsonNull,
        )

        fx.awaitPosted("agentsContentSaved")
        val rpc = fx.awaitRpc("setAgentsContent")
        assertTrue(
            rpc.params().containsKey("expectedHash"),
            "the fallback path must forward an explicit null too, was ${rpc.params()}",
        )
        assertEquals(JsonNull, rpc.params()["expectedHash"])
        assertNull(rpc["sessionId"]?.jsonPrimitive?.contentOrNull)
    }

    // ── 会话 id 随信封下发（spec 场景 3：保存后缓存失效）─────────────────
    //
    // 带 sessionId 时 CLI 走 `agent.writeLocalMemoryContent(...)` → MemoryService 清
    // 缓存，当前会话下一轮注入的就是新内容；不带时只直写文件，缓存一个字不动。

    @Test
    fun `memory file RPCs carry the agent session id on the envelope`() {
        val fx = Fixture(connectAgent = true)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("local"),
            "content" to JsonPrimitive("# mine"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )
        fx.awaitPosted("agentsContentSaved")
        fx.send(
            "getAgentsContent",
            "scope" to JsonPrimitive("local"),
            "workdir" to JsonPrimitive("/tmp/wave-wd"),
        )
        fx.awaitPosted("agentsContentResponse")

        for (method in listOf("setAgentsContent", "getAgentsContent")) {
            val rpc = fx.awaitRpc(method)
            assertEquals(
                AGENT_SESSION_ID,
                rpc["sessionId"]?.jsonPrimitive?.content,
                "$method must put the session id on the JSON-RPC envelope",
            )
            // 信封字段，不是 params 里的同名字段 —— CLI 只认信封那个。
            assertNull(rpc.params()["sessionId"], "$method must not duplicate it inside params")
        }
    }

    // ── harness ─────────────────────────────────────────────────────

    /**
     * A [MessageHandler] wired to a real [WaveSession] over a fake stdio CLI.
     * `connectAgent = false` leaves `session.agent` null (the settings tab opened
     * without a chat session); the handler then goes through the shared CLI client
     * (the same fake process), which is what the real host does via
     * `WaveBackendService.ensureClient()`. `utilityAvailable = false` makes that
     * lookup fail (CLI not running).
     */
    private inner class Fixture(
        connectAgent: Boolean,
        utilityAvailable: Boolean = true,
    ) {

        val posted = CopyOnWriteArrayList<Pair<String, JsonObject>>()
        private val rpcLog = File(tempDir.toFile(), "fake-wave-rpc.log")
        val handler: MessageHandler

        init {
            val project = fakeProject()
            val session = WaveSession(project) { command, payload -> posted.add(command to payload) }
            // One fake process per fixture: the agent and the utility path share it, exactly
            // like the real host (every session in a project rides the backend's shared client).
            val started: Pair<StdioClient, NotificationRouter>? = if (connectAgent || utilityAvailable) {
                val script = File(tempDir.toFile(), "fake-wave-server.js").apply { writeText(FAKE_CLI_JS) }
                val client = StdioClient(
                    listOf("node", script.absolutePath),
                    emptyList(),
                    mapOf("WAVE_FAKE_LOG" to rpcLog.absolutePath),
                )
                openClients.add(client)
                val router = NotificationRouter(client)
                router.attach()
                client to router
            } else {
                null
            }
            if (connectAgent && started != null) {
                val connected = StdioAgent(started.first, started.second, object : AgentCallbacks {})
                // Real path: initialize's reply carries the session id (only place it is set).
                // The reply deliberately omits currentWorkdir/sessionCwd so the handler's
                // workdir fallbacks keep resolving exactly as the other cases expect.
                runBlocking { connected.initialize(buildJsonObject {}) }
                require(connected.sessionId == AGENT_SESSION_ID) {
                    "fake CLI must hand out $AGENT_SESSION_ID, got ${connected.sessionId}"
                }
                installAgent(session, connected)
            }
            handler = MessageHandler(
                project,
                session,
                utilityClient = {
                    started?.first ?: throw StdioClientException("wave --stdio process is not running")
                },
            ) { command, payload -> posted.add(command to payload) }
        }

        /**
         * Fire a webview command. `handle` returns before dispatch completes.
         * Fields are [JsonElement] (not just [JsonPrimitive]) so a test can send an
         * **explicit** `expectedHash: null` — the host must tell that apart from an
         * omitted field, and both from a string.
         */
        fun send(command: String, vararg fields: Pair<String, JsonElement>) {
            handler.handle(
                buildJsonObject {
                    put("command", JsonPrimitive(command))
                    fields.forEach { (key, value) -> put(key, value) }
                },
            )
        }

        fun awaitPosted(command: String): JsonObject {
            await("postMessage '$command'") { posted.any { it.first == command } }
            return posted.first { it.first == command }.second
        }

        fun awaitRpc(method: String): JsonObject {
            await("stdio RPC '$method'") { rpcRecords().any { it["method"]?.jsonPrimitive?.content == method } }
            return rpcRecords().first { it["method"]?.jsonPrimitive?.content == method }
        }

        /** Requests the fake CLI received, in arrival order. */
        private fun rpcRecords(): List<JsonObject> {
            if (!rpcLog.isFile) return emptyList()
            return rpcLog.readLines().filter { it.isNotBlank() }.mapNotNull { line ->
                runCatching { Json.parseToJsonElement(line).jsonObject }.getOrNull()
            }
        }
    }

    /** Bounded poll: `handle` dispatches on `Dispatchers.IO`, so effects arrive later. */
    private fun await(what: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + AWAIT_TIMEOUT_MS * 1_000_000
        while (System.nanoTime() < deadline) {
            if (condition()) return
            Thread.sleep(POLL_INTERVAL_MS)
        }
        throw AssertionError("Timed out after ${AWAIT_TIMEOUT_MS}ms waiting for $what")
    }

    private fun JsonObject.params(): JsonObject = this["params"]?.jsonObject ?: JsonObject(emptyMap())

    private companion object {
        const val AWAIT_TIMEOUT_MS = 15_000L
        const val POLL_INTERVAL_MS = 10L

        /** What the fake CLI answers `initialize` with; the agent's session id after that. */
        const val AGENT_SESSION_ID = "sess-agent"

        /** Loads the fake `wave --stdio` server; replies per method and logs every request. */
        val FAKE_CLI_JS = """
            const fs = require("fs");
            const readline = require("readline");
            const logPath = process.env.WAVE_FAKE_LOG;

            function buildResult(msg) {
              const params = msg.params || {};
              switch (msg.method) {
                case "initialize":
                  // Only the session id: leaving currentWorkdir/sessionCwd unset keeps the
                  // handler's workdir fallbacks on the same path as the other cases.
                  return { sessionId: "$AGENT_SESSION_ID" };
                case "deleteSkill":
                  return { success: true, deleted: params.name };
                case "removeMcpServer":
                  return { success: true, removed: params.serverName };
                case "deleteHook":
                  return { ok: true };
                case "getHooksByScope":
                  return { hooks: { scopedTo: params.scope }, configPath: "/fake/settings.json" };
                case "getAgentsContent": {
                  // workdir 决定这一档在假 CLI 眼里的状态：不存在的档回空内容 +
                  // hash:null（读成功但文件不在），其余回一份带 hash 的正常回包。
                  const missing = params.workdir === "/tmp/wave-wd-missing";
                  return {
                    content: missing ? "" : "# from disk",
                    path: (params.workdir || "") + "/AGENTS.md",
                    exists: !missing,
                    readable: true,
                    hash: missing ? null : "sha256:abc123",
                  };
                }
                case "setAgentsContent":
                  // 只有带着「过期 hash」来才判冲突：宿主侧的转述因此有东西可转。
                  if (params.expectedHash === "sha256:stale") {
                    return { ok: false, conflict: true, error: "文件已被外部改动" };
                  }
                  return { ok: true };
                case "setBuiltinPluginEnabled":
                  const enabledPlugins = {};
                  enabledPlugins[params.pluginId] = params.enabled;
                  return { enabledPlugins: enabledPlugins };
                default:
                  return {};
              }
            }

            readline.createInterface({ input: process.stdin }).on("line", function (line) {
              let msg;
              try { msg = JSON.parse(line); } catch (e) { return; }
              if (msg.id === undefined) { return; }
              if (logPath) {
                fs.appendFileSync(logPath, JSON.stringify({
                  method: msg.method,
                  params: msg.params || null,
                  sessionId: msg.sessionId || null,
                }) + "\n");
              }
              process.stdout.write(JSON.stringify({ id: msg.id, result: buildResult(msg) }) + "\n");
            });
        """.trimIndent()
    }
}

/**
 * Minimal [Project] test double — see the class KDoc for why a proxy is used
 * instead of a mocked/mockito project (neither is on the test classpath).
 */
private fun fakeProject(): Project = Proxy.newProxyInstance(
    Project::class.java.classLoader,
    arrayOf(Project::class.java),
) { proxy, method, args ->
    when (method.name) {
        "hashCode" -> System.identityHashCode(proxy)
        "equals" -> proxy === args?.firstOrNull()
        "toString" -> "FakeProject"
        else -> javaDefault(method.returnType)
    }
} as Project

/** `WaveSession.agent` is `private set` with no public seam; inject the fake backend's agent. */
private fun installAgent(session: WaveSession, agent: StdioAgent) {
    val field = WaveSession::class.java.getDeclaredField("agent")
    field.isAccessible = true
    field.set(session, agent)
}

private fun javaDefault(type: Class<*>): Any? = when (type) {
    java.lang.Boolean.TYPE -> false
    java.lang.Byte.TYPE -> 0.toByte()
    java.lang.Short.TYPE -> 0.toShort()
    java.lang.Integer.TYPE -> 0
    java.lang.Long.TYPE -> 0L
    java.lang.Float.TYPE -> 0f
    java.lang.Double.TYPE -> 0.0
    java.lang.Character.TYPE -> '\u0000'
    else -> null
}
