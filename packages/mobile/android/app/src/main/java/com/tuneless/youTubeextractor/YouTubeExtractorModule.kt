package com.tuneless.youTubeextractor

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class YouTubeExtractorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init { StreamFetcher.init() }

    override fun getName(): String = "YouTubeExtractor"

    @ReactMethod
    fun extractAudioUrl(videoId: String, promise: Promise) {
        StreamFetcher.getStreamUrl(videoId, promise)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
