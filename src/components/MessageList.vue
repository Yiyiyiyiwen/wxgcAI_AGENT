<template>
  <main class="message-list">
    <div v-for="message in messages" :key="message.id" class="message-row" :class="'is-' + message.role">
      <div class="bubble" :class="{
        loading: message.loading,
        'news-bubble': isNewsMessage(message),
        'has-thought-toggle': message.role === 'assistant' && hasThoughts(message)
      }">
        <div v-if="message.role === 'assistant' && !isNewsMessage(message) && !hasThoughts(message)" class="tag">
          {{ message.tag }}
        </div>
        <button v-if="message.role === 'assistant' && hasThoughts(message)" class="thought-toggle" type="button"
          :aria-label="isThoughtExpanded(message) ? '收起思考过程' : '展开思考过程'" @click="toggleThought(message.id)">
          <van-icon :name="isThoughtExpanded(message) ? 'arrow-up' : 'arrow-down'" />
        </button>
        <section v-if="message.role === 'assistant' && hasThoughts(message) && isThoughtExpanded(message)" class="thought-block">
          <div v-if="!message.text" class="thought-title">正在思考中...</div>
          <div class="thought-content">{{ message.thoughts }}</div>
        </section>
        <div v-if="message.loading && !message.text && !hasThoughts(message)" class="loading-dots" aria-label="回复生成中">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div v-else-if="isNewsMessage(message)" class="news-card">
          <button v-for="(news, index) in message.newsList" :key="index" class="news-item" type="button"
            @click="handleNewsClick(news)">
            <span class="news-index">{{ index + 1 }}.</span>
            <span class="news-title">{{ news.title }}</span>
            <span class="news-arrow" aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false">
                <path d="M7.5 4.5 13 10l-5.5 5.5" />
              </svg>
            </span>
          </button>
        </div>
        <div v-else-if="message.role === 'assistant'" class="text rich-text" v-html="formatAssistantText(message.text)">
        </div>
        <div v-else class="text">{{ message.text }}</div>
      </div>
    </div>
  </main>
</template>

<script>
import { openNewsDetail } from "../utils/appBridge";
import { sanitizeRichText } from "../utils/richText";

export default {
  name: "MessageList",
  props: {
    messages: {
      type: Array,
      required: true
    }
  },
  data () {
    return {
      thoughtExpandMap: {},
      thoughtManualMap: {},
      previousAnswerMap: {}
    };
  },
  watch: {
    messages: {
      immediate: true,
      deep: true,
      handler (nextMessages) {
        const activeIds = {};
        nextMessages.forEach(message => {
          const id = String(message.id);
          activeIds[id] = true;
          const previousHasAnswer = Boolean(this.previousAnswerMap[id]);
          const currentHasAnswer = this.hasAnswerContent(message);
          const hasThought = this.hasThoughts(message);

          if (!Object.prototype.hasOwnProperty.call(this.thoughtExpandMap, id)) {
            this.$set(this.thoughtExpandMap, id, hasThought && !currentHasAnswer);
          }
          if (!Object.prototype.hasOwnProperty.call(this.thoughtManualMap, id)) {
            this.$set(this.thoughtManualMap, id, false);
          }

          if (!previousHasAnswer && currentHasAnswer && hasThought) {
            this.$set(this.thoughtExpandMap, id, false);
            this.$set(this.thoughtManualMap, id, false);
          }

          this.$set(this.previousAnswerMap, id, currentHasAnswer);
        });

        Object.keys(this.thoughtExpandMap).forEach(id => {
          if (!activeIds[id]) {
            this.$delete(this.thoughtExpandMap, id);
          }
        });
        Object.keys(this.thoughtManualMap).forEach(id => {
          if (!activeIds[id]) {
            this.$delete(this.thoughtManualMap, id);
          }
        });
        Object.keys(this.previousAnswerMap).forEach(id => {
          if (!activeIds[id]) {
            this.$delete(this.previousAnswerMap, id);
          }
        });
      }
    }
  },
  methods: {
    isNewsMessage (message) {
      return message && message.type === "news";
    },
    hasThoughts (message) {
      return Boolean(message && typeof message.thoughts === "string" && message.thoughts.trim());
    },
    hasAnswerContent (message) {
      if (!message) {
        return false;
      }
      const hasText = Boolean(typeof message.text === "string" && message.text.trim());
      const hasNews = this.isNewsMessage(message) && Array.isArray(message.newsList) && message.newsList.length > 0;
      return hasText || hasNews;
    },
    isThoughtExpanded (message) {
      const id = String(message.id);
      if (this.thoughtManualMap[id]) {
        return Boolean(this.thoughtExpandMap[id]);
      }
      return Boolean(this.thoughtExpandMap[id] || (this.hasThoughts(message) && !this.hasAnswerContent(message)));
    },
    toggleThought (messageId) {
      const id = String(messageId);
      const next = !this.thoughtExpandMap[id];
      this.$set(this.thoughtExpandMap, id, next);
      this.$set(this.thoughtManualMap, id, true);
    },
    handleNewsClick (news) {
      openNewsDetail(news);
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
  position: relative;
  max-width: 82%;
  padding: 14px 16px;
  border-radius: 22px;
  line-height: 1.6;
  box-shadow: var(--shadow);
}

.bubble.has-thought-toggle {
  padding-top: 28px;
}

.bubble.has-thought-toggle .text {
  margin-top: 8px;
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

.thought-toggle {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.05);
  color: #76849a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}

.thought-block {
  margin: 4px 2px 10px;
  padding: 0 0 0 10px;
  border-left: 2px solid rgba(120, 132, 154, 0.45);
}

.thought-title {
  color: #65748b;
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 4px;
}

.thought-content {
  white-space: pre-wrap;
  word-break: break-word;
  color: #8a95a8;
  font-size: 14px;
  line-height: 1.8;
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
  width: 100%;
  max-width: 100%;
  padding: 0;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.news-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 0;
}

.news-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 10px;
  border: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  cursor: pointer;
  border-bottom: 1px solid rgba(17, 17, 17, 0.08);
}

.news-index {
  flex: 0 0 auto;
  min-width: 28px;
  color: #0f172a;
  font-size: 17px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.news-title {
  flex: 1;
  min-width: 0;
  font-size: 17px;
  line-height: 1.6;
  color: #1f2937;
  word-break: break-word;
}

.news-arrow {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
}

.news-arrow svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.news-item:last-child {
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
