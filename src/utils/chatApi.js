const CHAT_AGENT_STREAM_URL = process.env.VUE_APP_CHAT_AGENT_STREAM_URL || "/wxgc/content/mb_api/chat/agent/stream";
const CHAT_WORKFLOW_STREAM_URL = process.env.VUE_APP_CHAT_WORKFLOW_STREAM_URL || "/wxgc/content/mb_api/chat/stream";
const CHAT_AGENT_STOP_URL = "/wxgc/content/mb_api/chat/agent/stop";
const CHAT_ENDPOINT_TYPE = (process.env.VUE_APP_CHAT_ENDPOINT_TYPE || "agent").toLowerCase();
const CHAT_CONNECT_TIMEOUT_MS = 300000;
const CHAT_IDLE_TIMEOUT_MS = 300000;
const CHAT_STREAM_MOCK = String(process.env.VUE_APP_CHAT_STREAM_MOCK || "").toLowerCase() === "true";
const CHAT_STREAM_MOCK_INTERVAL_MS = Number(process.env.VUE_APP_CHAT_STREAM_MOCK_INTERVAL_MS || 120);
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

function normalizeNewsList (value, cardSource) {
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
          siteId: item.site_id || item.siteId || "",
          source: item.source || "",
          cardSource: cardSource || "",
          sourceLink: item.source_link || item.sourceLink || ""
        };
      }

      return { title: "", contentId: "", siteId: "", source: "", cardSource: cardSource || "", sourceLink: "" };
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
  state.newsList = normalizeNewsList(normalizedPayload.news_list, normalizedPayload.source);
  state.pendingStructuredText = "";
  state.done = Boolean(normalizedPayload.done);
  notify(onEvent, {
    type: "news",
    newsList: state.newsList,
    thoughts: normalizeText(state.thoughts),
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

function hasNewsCardMarker (value) {
  if (typeof value !== "string") {
    return false;
  }
  return value.indexOf("wxgc_news_card") > -1 || value.indexOf("\"news_list\"") > -1;
}

function flushPendingStructuredTextAsPlainText (state, onEvent, doneFlag) {
  if (!state.pendingStructuredText) {
    return;
  }
  state.type = "text";
  state.text += state.pendingStructuredText;
  state.pendingStructuredText = "";
  notify(onEvent, {
    type: "text",
    text: normalizeText(state.text),
    newsList: state.newsList,
    thoughts: normalizeText(state.thoughts),
    done: Boolean(doneFlag)
  });
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

  const hasThoughts = typeof normalizedPayload.thoughts === "string";
  const hasText = typeof normalizedPayload.text === "string";
  let emitted = false;

  if (hasThoughts) {
    state.thoughts += normalizedPayload.thoughts;
  }

  if (normalizedPayload.status === "wxgc_news_card") {
    applyNewsPayload(normalizedPayload, state, onEvent);
    emitted = true;
  }

  if (!emitted && hasText) {
    const incomingText = normalizedPayload.text;
    const pendingBuffer = state.pendingStructuredText || "";
    const nextPendingBuffer = pendingBuffer + incomingText;
    const shouldBufferAsStructured = Boolean(pendingBuffer)
      || hasNewsCardMarker(nextPendingBuffer)
      || (!state.text && /^\s*\{/.test(nextPendingBuffer));

    if (shouldBufferAsStructured) {
      state.pendingStructuredText = nextPendingBuffer;
      const maybePayload = parseJsonFromText(state.pendingStructuredText);
      if (maybePayload && maybePayload.status === "wxgc_news_card") {
        applyNewsPayload(maybePayload, state, onEvent);
        emitted = true;
      } else if (!hasNewsCardMarker(state.pendingStructuredText) && state.pendingStructuredText.length > 240) {
        // 非新闻结构化文本，回退为普通文本展示，避免误判后长期不渲染。
        flushPendingStructuredTextAsPlainText(state, onEvent, normalizedPayload.done);
        emitted = true;
      }
    } else {
      state.type = "text";
      state.text += incomingText;
      // 兼容后端把新闻 JSON 以 text 分片流式下发的场景。
      if (tryApplyNewsFromAccumulatedText(state, onEvent)) {
        emitted = true;
      }
    }
  }

  if (!emitted && (hasThoughts || hasText)) {
    notify(onEvent, {
      type: state.type,
      text: normalizeText(state.text),
      newsList: state.newsList,
      thoughts: normalizeText(state.thoughts),
      done: Boolean(normalizedPayload.done)
    });
  }

  if (normalizedPayload.done) {
    if (state.pendingStructuredText) {
      const maybePayload = parseJsonFromText(state.pendingStructuredText);
      if (maybePayload && maybePayload.status === "wxgc_news_card") {
        applyNewsPayload(maybePayload, state, onEvent);
      } else {
        flushPendingStructuredTextAsPlainText(state, onEvent, true);
      }
    }
    state.done = true;
    notify(onEvent, {
      type: state.type,
      text: normalizeText(state.text),
      newsList: state.newsList,
      thoughts: normalizeText(state.thoughts),
      done: true
    });
  }
}

function buildChatUrl (message, sessionId, endpointType) {
  const streamUrl = endpointType === "workflow" ? CHAT_WORKFLOW_STREAM_URL : CHAT_AGENT_STREAM_URL;
  const url = new URL(streamUrl, window.location.origin);
  url.searchParams.set("message", message);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

function buildStopUrl () {
  return new URL(CHAT_AGENT_STOP_URL, window.location.origin).toString();
}

// 终止回答接口：POST /agent/stop，参数仅 sessionId
export async function stopChatReply (sessionId) {
  const cleanSessionId = typeof sessionId === "string" ? sessionId.trim() : String(sessionId || "").trim();
  if (!cleanSessionId) {
    return false;
  }

  const body = JSON.stringify({ sessionId: cleanSessionId });
  const url = buildStopUrl();
  debugLog("stop:request", { sessionId: cleanSessionId, url });
  try {
    const response = await window.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*"
      },
      body
    });
    debugLog("stop:response", { sessionId: cleanSessionId, status: response.status });
    return response.ok;
  } catch (error) {
    debugLog("stop:error", {
      sessionId: cleanSessionId,
      message: error && error.message ? error.message : ""
    });
    return false;
  }
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

const MOCK_STREAM_EVENTS = [
  { event: "text", data: { text: "您好", done: false } },
  { event: "text", data: { text: "！", done: false } },
  { event: "text", data: { text: "我是", done: false } },
  { event: "text", data: { text: "禧", done: false } },
  { event: "text", data: { text: "宝，无锡日报", done: false } },
  { event: "text", data: { text: "报业集团的智能", done: false } },
  { event: "text", data: { text: "助手。\n\n今天想", done: false } },
  { event: "text", data: { text: "了解无锡哪些方面的", done: false } },
  { event: "text", data: { text: "资讯呢？可以", done: false } },
  { event: "text", data: { text: "告诉我具体需求，", done: false } },
  { event: "text", data: { text: "比如：\n- 最", done: false } },
  { event: "text", data: { text: "新政策解读", done: false } },
  { event: "text", data: { text: "\n- 民", done: false } },
  { event: "text", data: { text: "生新闻\n-", done: false } },
  { event: "text", data: { text: " 城市", done: false } },
  { event: "text", data: { text: "建设进展\n-", done: false } },
  { event: "text", data: { text: " 教育医疗", done: false } },
  { event: "text", data: { text: "动态\n\n或者直接", done: false } },
  { event: "text", data: { text: "说说您关心", done: false } },
  { event: "text", data: { text: "的话题，我来", done: false } },
  { event: "text", data: { text: "帮您查找相关信息", done: false } },
  { event: "text", data: { text: "～", done: false } },
  { event: "done", data: { done: true } }
];

// 核心处理流式文本/新闻卡片
export async function sendChatMessage ({ message, sessionId, onEvent, onRegisterStop, endpointType = CHAT_ENDPOINT_TYPE }) {
  const state = {
    type: "text",
    text: "",
    pendingStructuredText: "",
    thoughts: "",
    newsList: [],
    done: false,
    stopped: false
  };

  return new Promise((resolve, reject) => {
    if (CHAT_STREAM_MOCK) {
      let settled = false;
      let timer = null;
      let eventIndex = 0;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }
        resolve({
          type: state.type,
          text: normalizeText(state.text),
          thoughts: normalizeText(state.thoughts),
          newsList: state.newsList,
          done: state.done,
          stopped: state.stopped
        });
      };

      const stop = reason => {
        if (settled) {
          return;
        }
        state.stopped = true;
        debugLog("request:mock-stopped", { sessionId, reason: reason || "manual" });
        finish();
      };

      if (typeof onRegisterStop === "function") {
        onRegisterStop(stop);
      }

      const step = () => {
        if (settled) {
          return;
        }
        const current = MOCK_STREAM_EVENTS[eventIndex++];
        if (!current) {
          finish();
          return;
        }
        applyPayload(current.data, state, onEvent);
        if (state.done) {
          finish();
          return;
        }
        timer = window.setTimeout(step, CHAT_STREAM_MOCK_INTERVAL_MS);
      };

      debugLog("request:mock-start", {
        sessionId,
        message,
        intervalMs: CHAT_STREAM_MOCK_INTERVAL_MS,
        events: MOCK_STREAM_EVENTS.length
      });
      timer = window.setTimeout(step, CHAT_STREAM_MOCK_INTERVAL_MS);
      return;
    }

    const controller = new window.AbortController();
    let settled = false;
    let connectTimer = null;
    let idleTimer = null;
    let responseStarted = false;
    let fallbackStage1Timer = null;
    let fallbackStage2Timer = null;
    let firstPayloadAt = 0;
    let latestPayloadAt = 0;
    const requestStartAt = Date.now();

    debugLog("request:start", { sessionId, message });
    debugLog("fallback:stage-start", {
      sessionId,
      stage: "connecting",
      hint: "正在连接服务"
    });

    const clearFallbackTimers = () => {
      if (fallbackStage1Timer) {
        window.clearTimeout(fallbackStage1Timer);
        fallbackStage1Timer = null;
      }
      if (fallbackStage2Timer) {
        window.clearTimeout(fallbackStage2Timer);
        fallbackStage2Timer = null;
      }
    };

    fallbackStage1Timer = window.setTimeout(() => {
      if (settled || responseStarted) {
        return;
      }
      debugLog("fallback:stage", {
        sessionId,
        stage: "connecting-slow",
        elapsedMs: Date.now() - requestStartAt,
        hint: "连接较慢，正在重试握手"
      });
    }, 8000);

    fallbackStage2Timer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      const now = Date.now();
      debugLog("fallback:stage", {
        sessionId,
        stage: responseStarted ? "streaming-long" : "connecting-long",
        elapsedMs: now - requestStartAt,
        firstPayloadDelayMs: firstPayloadAt ? firstPayloadAt - requestStartAt : null,
        idleSinceLastPayloadMs: latestPayloadAt ? now - latestPayloadAt : null,
        hint: responseStarted ? "正在持续生成，请稍候" : "连接时间较长，请稍候"
      });
    }, 30000);

    const cleanup = () => {
      clearFallbackTimers();
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
        thoughts: normalizeText(state.thoughts),
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
        thoughts: normalizeText(state.thoughts),
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
      const now = Date.now();
      if (!firstPayloadAt) {
        firstPayloadAt = now;
        debugLog("fallback:stage", {
          sessionId,
          stage: "first-payload",
          elapsedMs: firstPayloadAt - requestStartAt,
          hint: "已收到首包"
        });
      }
      latestPayloadAt = now;
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
      url: buildChatUrl(message, sessionId, endpointType),
      endpointType,
      method: "GET",
      headers
    });

    window.fetch(buildChatUrl(message, sessionId, endpointType), {
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
