package com.wave.jetbrains.stdio

import com.intellij.openapi.diagnostic.logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.io.PrintWriter
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

typealias NotificationHandler = (JsonElement?) -> Unit

class StdioClientException(message: String) : RuntimeException(message)

/**
 * Pure transport layer: spawns `wave --stdio`, speaks line-delimited JSON-RPC 2.0.
 * Mirrors packages/vsce/src/stdio/stdioClient.ts.
 */
class StdioClient(
    binaryPath: String,
    args: List<String> = emptyList(),
    env: Map<String, String> = emptyMap(),
) : AutoCloseable {

    private val LOG = logger<StdioClient>()
    private val json = Json { encodeDefaults = false }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val nextId = AtomicInteger(1)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<JsonElement?>>()
    private val handlers = ConcurrentHashMap<String, MutableList<NotificationHandler>>()

    @Volatile
    var disposed = false
        private set

    private val process: Process = ProcessBuilder(listOf(binaryPath) + args).apply {
        redirectErrorStream(false)
        environment().putAll(env)
    }.also {
        LOG.info("Starting wave stdio: $binaryPath ${args.joinToString(" ")}")
    }.start()

    private val stdin: PrintWriter = PrintWriter(
        OutputStreamWriter(process.outputStream, StandardCharsets.UTF_8),
        true
    )
    private val writeMutex = Mutex()

    init {
        // Reader coroutine: one line = one JSON object
        scope.launch {
            try {
                BufferedReader(InputStreamReader(process.inputStream, StandardCharsets.UTF_8)).use { reader ->
                    var line = reader.readLine()
                    while (line != null) {
                        handleLine(line)
                        line = reader.readLine()
                    }
                }
            } catch (e: IOException) {
                if (!disposed) LOG.warn("wave stdio stdout stream closed", e)
            }
        }
        // stderr logger
        scope.launch {
            try {
                BufferedReader(InputStreamReader(process.errorStream, StandardCharsets.UTF_8)).use { reader ->
                    var line = reader.readLine()
                    while (line != null) {
                        LOG.warn("[wave-stdio] $line")
                        line = reader.readLine()
                    }
                }
            } catch (_: IOException) {
            }
        }
        // Exit handler: reject all pending
        process.onExit().thenRun {
            val code = process.exitValue()
            val error = StdioClientException("wave --stdio process exited (code: $code)")
            pending.values.forEach { it.completeExceptionally(error) }
            pending.clear()
            disposed = true
        }
    }

    /** Send a request (expects a response with matching id). */
    suspend fun request(method: String, params: JsonObject? = null): JsonElement? {
        if (disposed) throw StdioClientException("StdioClient is disposed")
        val id = nextId.getAndIncrement()
        val deferred = CompletableDeferred<JsonElement?>()
        pending[id] = deferred
        try {
            val payload = buildJsonObject {
                put("id", id)
                put("method", method)
                if (params != null) put("params", params)
            }
            val line = json.encodeToString(JsonObject.serializer(), payload)
            writeLine(line)
            return deferred.await()
        } catch (e: Exception) {
            pending.remove(id)
            throw e
        }
    }

    /** Send a notification (no response expected). Fire-and-forget. */
    suspend fun notify(method: String, params: JsonObject? = null) {
        if (disposed) return
        val payload = buildJsonObject {
            put("method", method)
            if (params != null) put("params", params)
        }
        writeLine(json.encodeToString(JsonObject.serializer(), payload))
    }

    fun onNotification(method: String, handler: NotificationHandler) {
        handlers.computeIfAbsent(method) { mutableListOf() }.add(handler)
    }

    private fun handleLine(line: String) {
        val parsed: JsonObject = try {
            json.parseToJsonElement(line).jsonObject
        } catch (e: Exception) {
            LOG.warn("Failed to parse stdio line: $line", e)
            return
        }
        // Response: has id and (result or error)
        if ("id" in parsed && ("result" in parsed || "error" in parsed)) {
            val id = (parsed["id"] as? JsonPrimitive)?.intOrNull
            if (id != null) {
                val deferred = pending.remove(id)
                if (deferred != null) {
                    val error = parsed["error"] as? JsonObject
                    if (error != null) {
                        val msg = (error["message"] as? JsonPrimitive)?.content ?: "Unknown error"
                        deferred.completeExceptionally(StdioClientException(msg))
                    } else {
                        deferred.complete(parsed["result"])
                    }
                }
            }
            return
        }
        // Notification: has method, no id
        if ("method" in parsed && "id" !in parsed) {
            val method = (parsed["method"] as? JsonPrimitive)?.content ?: return
            val params = parsed["params"]
            handlers[method]?.forEach { runCatching { it(params) } }
        }
    }

    private suspend fun writeLine(s: String) {
        writeMutex.withLock {
            stdin.println(s)
            stdin.flush()
        }
    }

    override fun close() {
        if (disposed) return
        disposed = true
        runCatching { process.destroy() }
        scope.cancel()
    }
}
