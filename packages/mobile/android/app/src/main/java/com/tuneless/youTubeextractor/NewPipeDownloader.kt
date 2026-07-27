package com.tuneless.youTubeextractor

import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import java.net.HttpURLConnection
import java.net.URL

class NewPipeDownloader : Downloader() {
    companion object {
        private const val UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
        private const val TIMEOUT = 30_000
    }

    override fun execute(request: Request): Response {
        val conn = URL(request.url()).openConnection() as HttpURLConnection
        conn.requestMethod = request.httpMethod()
        conn.connectTimeout = TIMEOUT
        conn.readTimeout = TIMEOUT
        conn.setRequestProperty("User-Agent", UA)
        request.headers().forEach { (k, vs) -> vs.forEach { v -> conn.addRequestProperty(k, v) } }
        val body = request.dataToSend()
        if (body != null && body.isNotEmpty()) {
            conn.doOutput = true
            conn.outputStream.use { it.write(body) }
        }
        val code = conn.responseCode
        val msg = conn.responseMessage
        val headers = mutableMapOf<String, MutableList<String>>()
        conn.headerFields.forEach { (k, v) -> if (k != null) headers[k] = ArrayList(v) }
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val bodyText = stream?.bufferedReader()?.use { it.readText() } ?: ""
        return Response(code, msg, headers, bodyText, request.url())
    }
}
