const CHAT_API_BASE = process.env.VUE_APP_CHAT_API_BASE || "/chat";

function randomDigits(length) {
  let output = "";
  while (output.length < length) {
    output += Math.floor(Math.random() * 10);
  }
  return output.slice(0, length);
}

export function createSessionId() {
  return `${Date.now()}${randomDigits(6)}`;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/^\n+/, "").trim() : "";
}

function coercePayload(value) {
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

function normalizeNewsList(value) {
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

function notify(onEvent, payload) {
  if (typeof onEvent === "function") {
    onEvent(payload);
  }
}

function applyPayload(payload, state, onEvent) {
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

function buildChatUrl(message, sessionId) {
  const url = new URL(`${CHAT_API_BASE}/stream`, window.location.origin);
  url.searchParams.set("message", message);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

export async function sendChatMessage({ message, sessionId, onEvent }) {
  const state = {
    type: "text",
    text: "",
    newsList: [],
    done: false
  };

  return new Promise((resolve, reject) => {
    const eventSource = new window.EventSource(buildChatUrl(message, sessionId));

    const cleanup = () => {
      eventSource.close();
    };

    const finish = () => {
      cleanup();
      resolve({
        type: state.type,
        text: normalizeText(state.text),
        newsList: state.newsList,
        done: state.done
      });
    };

    const handlePayload = payload => {
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
      if (state.done) {
        finish();
        return;
      }
      cleanup();
      reject(new Error("聊天流连接中断，请稍后再试。"));
    };
  });
}
