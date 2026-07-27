package com.tuneless.youTubeextractor

import com.facebook.react.bridge.Promise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object StreamFetcher {
    private val scope = CoroutineScope(Dispatchers.IO)

    fun init() { NewPipe.init(NewPipeDownloader()) }

    fun getStreamUrl(videoId: String, promise: Promise) {
        scope.launch {
            try {
                val url = resolveStream(videoId)
                if (url != null) promise.resolve(url)
                else promise.reject("STREAM_NOT_FOUND", "Could not extract audio for: $videoId")
            } catch (e: Exception) {
                promise.reject("EXTRACTION_FAILED", e.message ?: "Unknown error")
            }
        }
    }

    private suspend fun resolveStream(videoId: String): String? = withContext(Dispatchers.IO) {
        tryNewPipe(videoId) ?: tryPipedApi(videoId) ?: tryDirectExtraction(videoId)
    }

    private fun tryNewPipe(videoId: String): String? {
        return try {
            val extractor = ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v=$videoId")
            extractor.fetchPage()
            val audioStreams = extractor.audioStreams
            if (audioStreams.isNotEmpty()) {
                val m4a = audioStreams.filter {
                    it.format?.mimeType?.contains("mp4") == true || it.format?.suffix?.contains("m4a") == true
                }
                val best = if (m4a.isNotEmpty()) m4a.maxByOrNull { it.averageBitrate }
                           else audioStreams.maxByOrNull { it.averageBitrate }
                best?.content
            } else null
        } catch (e: Exception) {
            android.util.Log.w("StreamFetcher", "NewPipe failed: ${e.message}")
            null
        }
    }

    private fun tryPipedApi(videoId: String): String? {
        val instances = listOf(
            "https://pipedapi.kavin.rocks",
            "https://pipedapi.ducks.party",
            "https://api-piped.mha.fi"
        )
        for (baseUrl in instances) {
            try {
                val conn = URL("$baseUrl/streams/$videoId").openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                if (conn.responseCode == 200) {
                    val response = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
                    val json = JSONObject(response)
                    val streams = json.optJSONArray("audioStreams")
                    if (streams != null && streams.length() > 0) {
                        var bestUrl: String? = null; var bestBitrate = 0
                        for (i in 0 until streams.length()) {
                            val s = streams.getJSONObject(i)
                            val url = s.optString("url", "")
                            val bitrate = s.optInt("bitrate", 0)
                            val fmt = s.optString("format", "")
                            if (url.isNotEmpty() && (fmt == "M4A" || bestUrl == null) && bitrate > bestBitrate) {
                                bestBitrate = bitrate; bestUrl = url
                            }
                        }
                        if (bestUrl != null) return bestUrl
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("StreamFetcher", "Piped failed: ${e.message}")
            }
        }
        return null
    }

    private fun tryDirectExtraction(videoId: String): String? {
        return try {
            val conn = URL("https://www.youtube.com/watch?v=$videoId").openConnection() as HttpURLConnection
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36")
            conn.connectTimeout = 10000; conn.readTimeout = 10000
            val html = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
            val start = html.indexOf("var ytInitialPlayerResponse = ")
            if (start >= 0) {
                val jsonStart = html.indexOf('{', start)
                val jsonEnd = html.indexOf("};", jsonStart)
                if (jsonStart >= 0 && jsonEnd > jsonStart) {
                    val playerJson = JSONObject(html.substring(jsonStart, jsonEnd + 1))
                    val formats = playerJson.optJSONObject("streamingData")?.optJSONArray("adaptiveFormats")
                    if (formats != null) {
                        var bestUrl: String? = null; var bestBitrate = 0
                        for (i in 0 until formats.length()) {
                            val f = formats.getJSONObject(i)
                            if (f.optString("mimeType", "").startsWith("audio/")) {
                                val url = f.optString("url", "")
                                val br = f.optInt("bitrate", 0)
                                if (url.isNotEmpty() && br > bestBitrate) { bestBitrate = br; bestUrl = url }
                            }
                        }
                        return bestUrl
                    }
                }
            }
            null
        } catch (e: Exception) { null }
    }
}
