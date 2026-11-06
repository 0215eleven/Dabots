package app.dsbot.notifications

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class LocalTLSModule : Module() {
  private val calls = ConcurrentHashMap<String, Call>()
  private val sockets = ConcurrentHashMap<String, WebSocket>()
  private val clients = ConcurrentHashMap<String, OkHttpClient>()
  private val files = ConcurrentHashMap<String, File>()
  private val pendingResponseRemovals = mutableSetOf<String>()
  private fun removeResponse(id: String): Boolean = synchronized(files) {
    val file = files[id] ?: return@synchronized true
    try {
      android.system.Os.unlink(file.absolutePath)
      files.remove(id); pendingResponseRemovals.remove(id); true
    } catch (error: Exception) {
      if (error is android.system.ErrnoException && error.errno == android.system.OsConstants.ENOENT) { files.remove(id); pendingResponseRemovals.remove(id); true }
      else { pendingResponseRemovals.add(id); false }
    }
  }
  private fun retryResponseRemovals() = synchronized(files) {
    pendingResponseRemovals.toList().forEach { removeResponse(it) }
  }
  private val previewFiles = ConcurrentHashMap<String, File>()
  private val pendingPreviewRemovals = mutableSetOf<String>()
  private fun removePreview(id: String): Boolean = synchronized(previewFiles) {
    val file = previewFiles[id] ?: return@synchronized true
    try {
      android.system.Os.unlink(file.absolutePath)
      previewFiles.remove(id); pendingPreviewRemovals.remove(id); true
    } catch (error: Exception) {
      if (error is android.system.ErrnoException && error.errno == android.system.OsConstants.ENOENT) { previewFiles.remove(id); pendingPreviewRemovals.remove(id); true }
      else { pendingPreviewRemovals.add(id); false }
    }
  }
  private fun retryPreviewRemovals() = synchronized(previewFiles) {
    pendingPreviewRemovals.toList().forEach { removePreview(it) }
  }
  @Volatile private var destroyed = false
  private fun client(origin: String, pin: String): OkHttpClient {
    check(!destroyed) { "The connection closed" }
    check(LocalTLS.validPin(pin)) { "Invalid computer identity" }
    check(clients.size < 8 || clients.containsKey(origin + pin)) { "Too many local connections" }
    return clients.getOrPut(origin + pin) { LocalTLS.client(pin) }
  }
  private fun event(id: String, type: String, extra: Map<String, Any?> = emptyMap()) {
    if (!destroyed) sendEvent("socket", mapOf("id" to id, "type" to type) + extra)
  }
  override fun definition() = ModuleDefinition {
    Name("DSBotLocalTLS")
    Events("socket")
    OnCreate {
      synchronized(previewFiles) {
        appContext.reactContext?.cacheDir?.listFiles()?.filter { it.name.matches(Regex("^dsbot-preview-[A-Fa-f0-9-]{36}\\.(png|jpg|webp)$")) }?.forEach { previewFiles[it.name] = it; pendingPreviewRemovals.add(it.name) }
        retryPreviewRemovals()
      }
      synchronized(files) {
        appContext.reactContext?.cacheDir?.listFiles()?.filter { it.name.matches(Regex("^dsbot-response-[A-Fa-f0-9-]{36}$")) }?.forEach { files[it.name] = it; pendingResponseRemovals.add(it.name) }
        retryResponseRemovals()
      }
    }
    AsyncFunction("createPreviewFile") { input: Map<String, String> -> synchronized(previewFiles) {
      retryPreviewRemovals()
      check(!destroyed && previewFiles.size < 16) { "Preview unavailable" }
      val mime = input["mimeType"]; check(mime in listOf("image/png", "image/jpeg", "image/webp")) { "Preview unavailable" }
      val encoded = input["base64"] ?: error("Preview unavailable")
      check(encoded.isNotEmpty() && encoded.length <= 1398104) { "Preview unavailable" }
      val bytes = Base64.decode(encoded, Base64.NO_WRAP); check(bytes.isNotEmpty() && bytes.size <= 1048576) { "Preview unavailable" }
      val ext = if (mime == "image/jpeg") "jpg" else mime!!.removePrefix("image/")
      val name = "dsbot-preview-" + UUID.randomUUID() + "." + ext
      val folder = appContext.reactContext?.cacheDir ?: error("Preview unavailable")
      val file = File(folder, name)
      previewFiles[name] = file
      try { file.writeBytes(bytes) } catch (error: Exception) { removePreview(name); throw error }
      mapOf("id" to name, "uri" to android.net.Uri.fromFile(file).toString())
    } }
    AsyncFunction("removePreviewFile") { id: String -> removePreview(id) }
    AsyncFunction("request") { data: Map<String, Any?>, promise: Promise ->
      try {
        val origin = data["origin"] as String; val pin = data["pin"] as String
        val id = data["id"] as String; val url = data["url"] as String
        val method = data["method"] as String
        LocalTLS.validate(origin, url)
        check(method in listOf("GET", "POST", "PUT", "DELETE", "PATCH") && calls.size < 32) { "Invalid request" }
        val headers = data["headers"] as? Map<*, *> ?: emptyMap<String, String>()
        val builder = Request.Builder().url(url)
        headers.forEach { (key, value) ->
          check(key is String && value is String && key.lowercase() in listOf("accept", "authorization", "content-type")) { "Invalid header" }
          builder.header(key, value)
        }
        val encoded = data["body"] as? String
        check(encoded == null || encoded.length <= 28 * 1024 * 1024) { "The upload is too large" }
        val body = encoded?.let { Base64.decode(it, Base64.NO_WRAP) }
        check(body == null || body.size <= 20 * 1024 * 1024) { "The upload is too large" }
        builder.method(method, if (method in listOf("GET", "DELETE") && body == null) null else (body ?: ByteArray(0)).toRequestBody((headers["Content-Type"] as? String)?.toMediaTypeOrNull()))
        val call = client(origin, pin).newCall(builder.build()); calls[id] = call
        call.enqueue(object : Callback {
          override fun onFailure(call: Call, e: IOException) {
            calls.remove(id, call)
            promise.reject("LOCAL_TLS_FAILED", "Could not verify or reach this computer. Check its network address and firewall, then scan a new pairing code if its identity changed.", null)
          }
          override fun onResponse(call: Call, response: Response) {
            try {
              response.use {
                check(response.code !in 300..399) { "Redirects are unavailable" }
                val out = java.io.ByteArrayOutputStream()
                response.body?.byteStream()?.use { input ->
                  val buffer = ByteArray(8192)
                  while (true) { val count = input.read(buffer); if (count < 0) break; check(out.size() + count <= 24 * 1024 * 1024); out.write(buffer, 0, count) }
                }
                val bytes = out.toByteArray()
                val result = mutableMapOf<String, Any?>("status" to response.code, "headers" to response.headers.toMultimap().mapValues { it.value.joinToString(", ") })
                val binary = response.isSuccessful && method == "GET" && java.net.URI(url).path.startsWith("/mobile/v1/attachments/")
                if (binary) {
                  val context = appContext.reactContext ?: error("The app closed")
                  // Only attachment bytes go to a private temporary file; credentials stay in memory.
                  val file = File(context.cacheDir, "dsbot-response-" + UUID.randomUUID())
                  synchronized(files) {
                    check(!destroyed && !call.isCanceled())
                      retryResponseRemovals()
                      files.values.filter { System.currentTimeMillis() - it.lastModified() > 60000 }.forEach { old -> removeResponse(old.name) }
                    check(files.size < 16)
                      files[file.name] = file
                      try { file.writeBytes(bytes) } catch (error: Exception) { removeResponse(file.name); throw error }
                  }
                  result["bodyFile"] = android.net.Uri.fromFile(file).toString(); result["fileId"] = file.name
                } else result["bodyText"] = bytes.toString(Charsets.UTF_8)
                if (!destroyed && !call.isCanceled()) promise.resolve(result)
                else promise.reject("CANCELLED", "The request was cancelled.", null)
              }
            } catch (_: Exception) { promise.reject("LOCAL_TLS_FAILED", "The local HTTPS request could not complete.", null) }
            finally { calls.remove(id, call) }
          }
        })
      } catch (_: Exception) { promise.reject("LOCAL_TLS_FAILED", "The local HTTPS request is invalid or unavailable.", null) }
    }
    AsyncFunction("cancel") { id: String -> calls.remove(id)?.cancel() }
    AsyncFunction("removeResponseFile") { id: String -> removeResponse(id) }
    AsyncFunction("connect") { origin: String, pin: String, id: String, url: String ->
      LocalTLS.validate(origin, url, true)
      check(sockets.size < 16) { "Too many streams" }
      val socket = client(origin, pin).newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) { if (destroyed) ws.cancel() else event(id, "open") }
        override fun onMessage(ws: WebSocket, text: String) { if (text.length <= 4 * 1024 * 1024) event(id, "message", mapOf("data" to text)) else ws.close(1009, "Event too large") }
        override fun onClosing(ws: WebSocket, code: Int, reason: String) { ws.close(code, reason) }
        override fun onClosed(ws: WebSocket, code: Int, reason: String) { sockets.remove(id, ws); event(id, "close", mapOf("code" to code, "reason" to reason)) }
        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) { sockets.remove(id, ws); event(id, "error"); event(id, "close", mapOf("code" to 1006)) }
      })
      sockets[id] = socket
    }
    AsyncFunction("send") { id: String, text: String -> check(text.length <= 512 * 1024 && sockets[id]?.send(text) == true) { "The stream closed" } }
    AsyncFunction("close") { id: String -> sockets.remove(id)?.cancel(); event(id, "close", mapOf("code" to 1000)) }
    OnDestroy {
      destroyed = true
      calls.values.forEach { it.cancel() }; calls.clear()
      sockets.values.forEach { it.cancel() }; sockets.clear()
      clients.values.forEach { it.connectionPool.evictAll(); it.dispatcher.executorService.shutdown() }; clients.clear()
      synchronized(files) { files.keys.toList().forEach { removeResponse(it) } }
      synchronized(previewFiles) { previewFiles.keys.toList().forEach { removePreview(it) } }
    }
  }
}
