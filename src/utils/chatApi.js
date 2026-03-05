const CHAT_API_BASE = process.env.VUE_APP_CHAT_API_BASE || "/chat";
const CHAT_CONNECT_TIMEOUT_MS = 45000;
const CHAT_IDLE_TIMEOUT_MS = 45000;
const DEBUG_ENV = String(process.env.VUE_APP_DEBUG_LOG || "").toLowerCase();

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
  console.info("[WXGC][chat]", record);
}

function randomDigits (length) {
  let output = "";
  while (output.length < length) {
    output += Math.floor(Math.random() * 10);
  }
  return output.slice(0, length);
}

export function createSessionId () {
  return `${Date.now()}${randomDigits(6)}`;
}

function tryParseJson (value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function normalizeText (value) {
  return typeof value === "string" ? value.replace(/^\n+/, "").trim() : "";
}

function coercePayload (value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return tryParseJson(value) || null;
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") {
      const nestedPayload = tryParseJson(value.text);
      if (nestedPayload && typeof nestedPayload === "object") {
        return nestedPayload;
      }
    }
    return value;
  }

  return null;
}

function normalizeNewsList (value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => {
      if (typeof item === "string") {
        return { title: item };
      }

      if (item && typeof item === "object") {
        return {
          title: item.title || item.news_title || item.name || "",
          contentId: item.content_id || item.contentId || "",
          siteId: item.site_id || item.siteId || ""
        };
      }

      return { title: "", contentId: "", siteId: "" };
    })
    .filter(item => item.title);
}

function notify (onEvent, payload) {
  if (typeof onEvent === "function") {
    onEvent(payload);
  }
}

function applyPayload (payload, state, onEvent) {
  const normalizedPayload = coercePayload(payload);
  if (!normalizedPayload) {
    return;
  }

  if (normalizedPayload.status === "wxgc_news_card") {
    state.type = "news";
    state.newsList = normalizeNewsList(normalizedPayload.news_list);
    state.done = Boolean(normalizedPayload.done);
    notify(onEvent, {
      type: "news",
      newsList: state.newsList,
      done: state.done
    });
    return;
  }

  if (typeof normalizedPayload.text === "string") {
    state.type = "text";
    state.text += normalizedPayload.text;
    notify(onEvent, {
      type: "text",
      text: normalizeText(state.text),
      done: Boolean(normalizedPayload.done)
    });
  }

  if (normalizedPayload.done) {
    state.done = true;
    notify(onEvent, {
      type: state.type,
      text: normalizeText(state.text),
      newsList: state.newsList,
      done: true
    });
  }
}

function buildChatUrl (message, sessionId) {
  const url = new URL(`${CHAT_API_BASE}/stream`, window.location.origin);
  url.searchParams.set("message", message);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

// 核心处理流式文本/新闻卡片
export async function sendChatMessage ({ message, sessionId, onEvent, onRegisterStop }) {
  const state = {
    type: "text",
    text: "",
    newsList: [],
    done: false,
    stopped: false
  };

  return new Promise((resolve, reject) => {
    const eventSource = new window.EventSource(buildChatUrl(message, sessionId));
    let settled = false;
    let connectTimer = null;
    let idleTimer = null;

    debugLog("request:start", { sessionId, message });

    const cleanup = () => {
      if (connectTimer) {
        window.clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (idleTimer) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
      eventSource.close();
    };

    const scheduleIdleTimeout = () => {
      if (idleTimer) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        if (settled) {
          return;
        }
        cleanup();
        settled = true;
        debugLog("request:idle-timeout", { sessionId, idleMs: CHAT_IDLE_TIMEOUT_MS });
        reject(new Error("聊天响应超时（空闲超时），请重试。"));
      }, CHAT_IDLE_TIMEOUT_MS);
    };

    const stop = reason => {
      if (settled) {
        return;
      }
      state.stopped = true;
      settled = true;
      cleanup();
      debugLog("request:stopped", { sessionId, reason: reason || "manual" });
      resolve({
        type: state.type,
        text: normalizeText(state.text),
        newsList: state.newsList,
        done: false,
        stopped: true
      });
    };

    if (typeof onRegisterStop === "function") {
      onRegisterStop(stop);
    }

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      debugLog("request:done", { sessionId, type: state.type, done: state.done, stopped: state.stopped });
      resolve({
        type: state.type,
        text: normalizeText(state.text),
        newsList: state.newsList,
        done: state.done,
        stopped: state.stopped
      });
    };

    const handlePayload = payload => {
      if (connectTimer) {
        window.clearTimeout(connectTimer);
        connectTimer = null;
      }
      scheduleIdleTimeout();
      applyPayload(payload, state, onEvent);
      if (state.done) {
        finish();
      }
    };

    eventSource.addEventListener("text", event => {
      handlePayload(tryParseJson(event.data));
    });

    eventSource.addEventListener("done", event => {
      const payload = tryParseJson(event.data) || { done: true };
      handlePayload(payload);
    });

    eventSource.onmessage = event => {
      handlePayload(tryParseJson(event.data));
    };

    eventSource.onerror = () => {
      if (settled) {
        return;
      }
      if (state.done) {
        finish();
        return;
      }
      cleanup();
      settled = true;
      debugLog("request:error", { sessionId });
      reject(new Error("聊天流连接中断，请稍后再试。"));
    };

    connectTimer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      settled = true;
      debugLog("request:connect-timeout", { sessionId, connectMs: CHAT_CONNECT_TIMEOUT_MS });
      reject(new Error("聊天连接超时，请稍后重试。"));
    }, CHAT_CONNECT_TIMEOUT_MS);
  });
}
