function wait (ms) {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

const mockVoiceSentences = [
  "今天无锡最热的五条新闻",
  "帮我看一下今天的要闻速览",
  "刚发布的本地民生新闻有哪些",
  "请总结今天的政务新闻重点",
  "给我一份24小时热点新闻清单",
  "今天教育和交通方面有什么新闻",
  "今天无锡天气怎么样"
];
const voiceMockEnv = String(process.env.VUE_APP_ENABLE_VOICE_MOCK || "").toLowerCase();
const NEWS_DETAIL_BASE_URL = process.env.VUE_APP_NEWS_DETAIL_BASE_URL || "https://workbooks.wxrb.com";
const NEWS_DETAIL_PATH = "/wxgc-h5/article.html";
const DEBUG_ENV = String(process.env.VUE_APP_DEBUG_LOG || "").toLowerCase();
let mockVoiceTimer = null;
let mockVoiceTick = 0;
let mockVoiceFinalText = "";

function isDebugEnabled () {
  if (typeof window !== "undefined" && typeof window.__WXGC_DEBUG__ === "boolean") {
    return window.__WXGC_DEBUG__;
  }
  if (DEBUG_ENV === "true") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

function debugLog (stage, payload) {
  if (!isDebugEnabled()) {
    return;
  }
  const record = {
    time: new Date().toISOString(),
    stage,
    payload: payload || {}
  };
  if (typeof window !== "undefined") {
    if (!Array.isArray(window.__WXGC_TRACE__)) {
      window.__WXGC_TRACE__ = [];
    }
    window.__WXGC_TRACE__.push(record);
    if (window.__WXGC_TRACE__.length > 200) {
      window.__WXGC_TRACE__.splice(0, window.__WXGC_TRACE__.length - 200);
    }
  }
  // eslint-disable-next-line no-console
  console.info("[WXGC][bridge]", record);
}

function isVoiceMockEnabled () {
  if (typeof window.__VOICE_MOCK_ENABLED__ === "boolean") {
    return window.__VOICE_MOCK_ENABLED__;
  }
  if (voiceMockEnv === "true") {
    return true;
  }
  if (voiceMockEnv === "false") {
    return false;
  }
  return process.env.NODE_ENV !== "production";
}

function emitVoiceResult (text, isFinal) {
  if (typeof window.onVoiceResult === "function") {
    window.onVoiceResult(text, isFinal);
  }
}

function clearMockVoiceTimer () {
  if (mockVoiceTimer) {
    window.clearInterval(mockVoiceTimer);
    mockVoiceTimer = null;
  }
}

function startMockVoiceStream () {
  clearMockVoiceTimer();
  mockVoiceTick = 0;
  const randomIndex = Math.floor(Math.random() * mockVoiceSentences.length);
  mockVoiceFinalText = mockVoiceSentences[randomIndex];
  debugLog("voice:mock-start", { text: mockVoiceFinalText });

  mockVoiceTimer = window.setInterval(() => {
    mockVoiceTick += 1;
    const nextLength = Math.min(mockVoiceFinalText.length, mockVoiceTick * 2);
    const partialText = mockVoiceFinalText.slice(0, nextLength);
    emitVoiceResult(partialText, false);
    if (nextLength >= mockVoiceFinalText.length) {
      clearMockVoiceTimer();
    }
  }, 220);
}

export async function startRecord () {
  if (window.NativeBridge && typeof window.NativeBridge.startVoice === "function") {
    debugLog("voice:start-native");
    return window.NativeBridge.startVoice();
  }
  if (window.AppBridge && typeof window.AppBridge.startRecord === "function") {
    debugLog("voice:start-appbridge");
    return window.AppBridge.startRecord();
  }
  if (isVoiceMockEnabled()) {
    startMockVoiceStream();
    debugLog("voice:start-mock");
  } else {
    debugLog("voice:start-no-bridge");
  }
  return wait(120);
}

export async function stopRecord () {
  if (window.NativeBridge && typeof window.NativeBridge.stopVoice === "function") {
    debugLog("voice:stop-native");
    window.NativeBridge.stopVoice();
    return {
      text: ""
    };
  }
  if (window.AppBridge && typeof window.AppBridge.stopRecord === "function") {
    debugLog("voice:stop-appbridge");
    return window.AppBridge.stopRecord();
  }
  if (isVoiceMockEnabled()) {
    clearMockVoiceTimer();
    emitVoiceResult(mockVoiceFinalText, true);
    debugLog("voice:stop-mock", { text: mockVoiceFinalText });
  }
  return {
    text: isVoiceMockEnabled() ? mockVoiceFinalText : ""
  };
}

export async function cancelRecord () {
  if (window.NativeBridge && typeof window.NativeBridge.stopVoice === "function") {
    debugLog("voice:cancel-native");
    window.NativeBridge.stopVoice();
    return wait(80);
  }
  if (window.AppBridge && typeof window.AppBridge.cancelRecord === "function") {
    debugLog("voice:cancel-appbridge");
    return window.AppBridge.cancelRecord();
  }
  clearMockVoiceTimer();
  mockVoiceFinalText = "";
  debugLog("voice:cancel-mock");
  return wait(80);
}

export function onVoiceResult (callback) {
  window.onVoiceResult = function (text, isFinal) {
    let displayText = typeof text === "string" ? text : "";
    try {
      const parsed = JSON.parse(displayText);
      if (parsed && typeof parsed === "object") {
        displayText = parsed.text || parsed.result || (parsed.payload && parsed.payload.result) || displayText;
      }
    } catch (error) {
      // no-op
    }

    if (typeof callback === "function") {
      callback(displayText, Boolean(isFinal));
    }
    debugLog("voice:callback", {
      isFinal: Boolean(isFinal),
      length: displayText.length
    });
  };
  debugLog("voice:callback-registered");
}

export function offVoiceResult () {
  window.onVoiceResult = null;
  debugLog("voice:callback-unregistered");
}

export function openNewsDetail (news) {
  const contentId = news && (news.contentId || news.content_id) ? String(news.contentId || news.content_id) : "";
  const siteId = news && (news.siteId || news.site_id) ? String(news.siteId || news.site_id) : "";
  const source = news && typeof news.source === "string" ? news.source.toLowerCase() : "";
  const sourceLink = news && (news.sourceLink || news.source_link) ? String(news.sourceLink || news.source_link) : "";
  const url = new URL(NEWS_DETAIL_PATH, NEWS_DETAIL_BASE_URL);
  if (contentId) {
    url.searchParams.set("contentId", contentId);
  }
  if (siteId) {
    url.searchParams.set("siteId", siteId);
  }
  const detailUrl = source === "network" && sourceLink ? sourceLink : url.toString();

  if (window.AppBridge && typeof window.AppBridge.openNewsDetail === "function") {
    return window.AppBridge.openNewsDetail({
      ...news,
      contentId,
      siteId,
      source,
      sourceLink,
      url: detailUrl
    });
  }

  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(detailUrl, "_self");
  }
  console.info("openNewsDetail placeholder", {
    ...news,
    contentId,
    siteId,
    url: detailUrl
  });
  return null;
}
