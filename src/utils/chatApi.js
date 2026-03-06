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

function parseJsonFromText (value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return null;
  }

  const direct = tryParseJson(raw);
  if (direct && typeof direct === "object") {
    return direct;
  }

  // 兼容双重包裹：先 parse 成字符串，再 parse 成对象。
  if (typeof direct === "string") {
    const nested = tryParseJson(direct);
    if (nested && typeof nested === "object") {
      return nested;
    }
  }

  return null;
}

function applyNewsPayload (normalizedPayload, state, onEvent) {
  state.type = "news";
  state.newsList = normalizeNewsList(normalizedPayload.news_list);
  state.done = Boolean(normalizedPayload.done);
  notify(onEvent, {
    type: "news",
    newsList: state.newsList,
    done: state.done
  });
}

function tryApplyNewsFromAccumulatedText (state, onEvent) {
  const maybePayload = parseJsonFromText(state.text);
  if (!maybePayload || maybePayload.status !== "wxgc_news_card") {
    return false;
  }
  applyNewsPayload(maybePayload, state, onEvent);
  return true;
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
    applyNewsPayload(normalizedPayload, state, onEvent);
    return;
  }

  if (typeof normalizedPayload.text === "string") {
    state.type = "text";
    state.text += normalizedPayload.text;
    // 兼容后端把新闻 JSON 以 text 分片流式下发的场景。
    if (tryApplyNewsFromAccumulatedText(state, onEvent)) {
      return;
    }
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

function parseSseEventBlock (block) {
  const lines = block.split(/\r?\n/);
  let eventName = "";
  const dataLines = [];

  lines.forEach(line => {
    if (!line || line.startsWith(":")) {
      return;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      eventName = value;
      return;
    }
    if (field === "data") {
      dataLines.push(value);
    }
  });

  return {
    eventName,
    data: dataLines.join("\n")
  };
}

function extractSseBlocks (buffer) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  return {
    blocks: blocks.slice(0, -1),
    rest: blocks[blocks.length - 1] || ""
  };
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
    const controller = new window.AbortController();
    let settled = false;
    let connectTimer = null;
    let idleTimer = null;
    let responseStarted = false;

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
      controller.abort();
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

    connectTimer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      settled = true;
      debugLog("request:connect-timeout", { sessionId, connectMs: CHAT_CONNECT_TIMEOUT_MS });
      reject(new Error("聊天连接超时，请稍后重试。"));
    }, CHAT_CONNECT_TIMEOUT_MS);

    const headers = {
      Accept: "text/event-stream"
    };
    debugLog("request:fetch-config", {
      sessionId,
      url: buildChatUrl(message, sessionId),
      method: "GET",
      headers
    });

    window.fetch(buildChatUrl(message, sessionId), {
      method: "GET",
      headers,
      signal: controller.signal
    }).then(async response => {
      if (settled) {
        return;
      }

      responseStarted = true;
      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch (error) {
          errorBody = "";
        }
        cleanup();
        settled = true;
        debugLog("request:http-error", {
          sessionId,
          status: response.status,
          statusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBodySnippet: (errorBody || "").slice(0, 300)
        });
        reject(new Error(`聊天接口请求失败（${response.status}）`));
        return;
      }

      if (!response.body) {
        cleanup();
        settled = true;
        debugLog("request:empty-body", { sessionId });
        reject(new Error("聊天接口未返回流式数据。"));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      try {
        while (!settled) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const extracted = extractSseBlocks(buffer);
          buffer = extracted.rest;

          extracted.blocks.forEach(block => {
            const trimmed = block.trim();
            if (!trimmed) {
              return;
            }
            const parsed = parseSseEventBlock(trimmed);
            const payload = tryParseJson(parsed.data);
            if (parsed.eventName === "done") {
              handlePayload(payload || { done: true });
              return;
            }
            handlePayload(payload);
          });
        }

        const tail = buffer.trim();
        if (!settled && tail) {
          const parsed = parseSseEventBlock(tail);
          const payload = tryParseJson(parsed.data);
          if (parsed.eventName === "done") {
            handlePayload(payload || { done: true });
          } else {
            handlePayload(payload);
          }
        }

        if (!settled) {
          if (state.done) {
            finish();
          } else {
            cleanup();
            settled = true;
            debugLog("request:stream-ended-early", { sessionId });
            reject(new Error("聊天流连接中断，请稍后再试。"));
          }
        }
      } catch (error) {
        if (settled) {
          return;
        }
        cleanup();
        settled = true;
        if (error && error.name === "AbortError" && state.stopped) {
          return;
        }
        debugLog("request:error", { sessionId });
        reject(new Error("聊天流连接中断，请稍后再试。"));
      }
    }).catch(error => {
      if (settled) {
        return;
      }
      cleanup();
      settled = true;
      if (error && error.name === "AbortError" && state.stopped) {
        return;
      }
      debugLog("request:fetch-error", {
        sessionId,
        message: error && error.message ? error.message : ""
      });
      if (!responseStarted) {
        reject(new Error("聊天连接失败，请检查网络或网关配置。"));
        return;
      }
      reject(new Error("聊天流连接中断，请稍后再试。"));
    });
  });
}
