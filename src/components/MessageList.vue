<template>
  <main class="message-list">
    <div v-for="message in messages" :key="message.id" class="message-row" :class="'is-' + message.role">
      <div class="bubble" :class="{ loading: message.loading, 'news-bubble': isNewsMessage(message) }">
        <div v-if="message.role === 'assistant'" class="tag">{{ message.tag }}</div>
        <div v-if="message.loading" class="loading-dots" aria-label="回复生成中">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div v-else-if="isNewsMessage(message)" class="news-card">
          <div v-for="(news, index) in message.newsList" :key="index" class="news-item">
            {{ news.title }}
          </div>
        </div>
        <div v-else-if="message.role === 'assistant'" class="text rich-text" v-html="formatAssistantText(message.text)">
        </div>
        <div v-else class="text">{{ message.text }}</div>
      </div>
    </div>
  </main>
</template>

<script>
import { sanitizeRichText } from "../utils/richText";

export default {
  name: "MessageList",
  props: {
    messages: {
      type: Array,
      required: true
    }
  },
  methods: {
    isNewsMessage (message) {
      return message && message.type === "news";
    },
    formatAssistantText (value) {
      return sanitizeRichText(value);
    }
  }
};
</script>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 12px;
}

.message-row {
  display: flex;
  margin-bottom: 16px;
}

.message-row.is-user {
  justify-content: flex-end;
}

.message-row.is-assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 82%;
  padding: 14px 16px;
  border-radius: 22px;
  line-height: 1.6;
  box-shadow: var(--shadow);
}

.is-assistant .bubble {
  background: rgb(247, 247, 247);
  border-top-left-radius: 8px;
}

.is-assistant .bubble.loading {
  min-width: 96px;
}

.is-user .bubble {
  background: var(--bg-user);
  color: #fff;
  border-top-right-radius: 8px;
}

.tag {
  margin-bottom: 8px;
  color: var(--text-sub);
  font-size: 13px;
}

.text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 17px;
}

.rich-text {
  white-space: normal;
}

.rich-text::v-deep p,
.rich-text::v-deep div,
.rich-text::v-deep blockquote,
.rich-text::v-deep ul,
.rich-text::v-deep ol {
  margin: 0 0 8px;
}

.rich-text::v-deep p:last-child,
.rich-text::v-deep div:last-child,
.rich-text::v-deep blockquote:last-child,
.rich-text::v-deep ul:last-child,
.rich-text::v-deep ol:last-child {
  margin-bottom: 0;
}

.rich-text::v-deep a {
  color: #1669f2;
  text-decoration: underline;
}

.loading-dots {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.loading-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(17, 17, 17, 0.42);
  animation: dot-bounce 1s infinite ease-in-out;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.15s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.3s;
}

.news-bubble {
  min-width: 220px;
}

.news-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.news-item {
  padding: 0 0 10px;
  font-size: 15px;
  line-height: 1.5;
  color: #1f2937;
  border-bottom: 1px solid rgba(17, 17, 17, 0.08);
}

.news-item:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

@keyframes dot-bounce {

  0%,
  80%,
  100% {
    transform: scale(0.75);
    opacity: 0.4;
  }

  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
