package com.wave.jetbrains.session

import com.intellij.openapi.project.Project
import com.wave.jetbrains.stdio.AgentCallbacks
import com.wave.jetbrains.stdio.NotificationRouter
import com.wave.jetbrains.stdio.StdioAgent
import com.wave.jetbrains.stdio.StdioClient
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
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

    // ── 无 live session 回退（settings tab 独立打开、聊天会话未初始化）──────

    @Test
    fun `setAgentsContent without a live agent reports failure instead of a false ok`() {
        val fx = Fixture(connectAgent = false)

        fx.send(
            "setAgentsContent",
            "scope" to JsonPrimitive("user"),
            "content" to JsonPrimitive("# AGENTS.md"),
        )

        val payload = fx.awaitPosted("agentsContentSaved")
        assertEquals("user", payload["scope"]?.jsonPrimitive?.content)
        assertTrue(
            payload["ok"]?.jsonPrimitive?.booleanOrNull == false,
            "no live agent must not fake an ok=true save, payload was $payload",
        )
        assertEquals("智能体未初始化", payload["error"]?.jsonPrimitive?.content)
    }

    // ── harness ─────────────────────────────────────────────────────

    /**
     * A [MessageHandler] wired to a real [WaveSession] over a fake stdio CLI.
     * `connectAgent = false` leaves `session.agent` null (the settings tab opened
     * without a chat session).
     */
    private inner class Fixture(connectAgent: Boolean) {

        val posted = CopyOnWriteArrayList<Pair<String, JsonObject>>()
        private val rpcLog = File(tempDir.toFile(), "fake-wave-rpc.log")
        val handler: MessageHandler

        init {
            val project = fakeProject()
            val session = WaveSession(project) { command, payload -> posted.add(command to payload) }
            if (connectAgent) {
                val script = File(tempDir.toFile(), "fake-wave-server.js").apply { writeText(FAKE_CLI_JS) }
                val client = StdioClient(
                    listOf("node", script.absolutePath),
                    emptyList(),
                    mapOf("WAVE_FAKE_LOG" to rpcLog.absolutePath),
                )
                openClients.add(client)
                val router = NotificationRouter(client)
                router.attach()
                installAgent(session, StdioAgent(client, router, object : AgentCallbacks {}))
            }
            handler = MessageHandler(project, session) { command, payload -> posted.add(command to payload) }
        }

        /** Fire a webview command. `handle` returns before dispatch completes. */
        fun send(command: String, vararg fields: Pair<String, JsonPrimitive>) {
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

        /** Loads the fake `wave --stdio` server; replies per method and logs every request. */
        val FAKE_CLI_JS = """
            const fs = require("fs");
            const readline = require("readline");
            const logPath = process.env.WAVE_FAKE_LOG;

            function buildResult(msg) {
              const params = msg.params || {};
              switch (msg.method) {
                case "deleteSkill":
                  return { success: true, deleted: params.name };
                case "removeMcpServer":
                  return { success: true, removed: params.serverName };
                case "deleteHook":
                  return { ok: true };
                case "getHooksByScope":
                  return { hooks: { scopedTo: params.scope }, configPath: "/fake/settings.json" };
                case "setAgentsContent":
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
