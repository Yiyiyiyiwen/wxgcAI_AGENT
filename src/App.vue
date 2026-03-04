<template>
  <div class="page">
    <!-- <AppHeader /> -->
    <MessageList ref="messageList" :messages="messages" />
    <ComposerBar :input-mode="inputMode" :record-state="recordState" :record-level="recordLevel"
      @toggle-input="toggleInputMode" @send-text="handleSendText" @record-start="handleRecordStart"
      @record-move="handleRecordMove" @record-end="handleRecordEnd" @record-cancel="handleRecordCancel" />
  </div>
</template>

<script>
import AppHeader from "./components/AppHeader.vue";
import ComposerBar from "./components/ComposerBar.vue";
import MessageList from "./components/MessageList.vue";
import { createSessionId, sendChatMessage } from "./utils/chatApi";
import { cancelRecord, startRecord, stopRecord } from "./utils/appBridge";

const CANCEL_THRESHOLD = 70;
const MIN_RECORD_DURATION = 600;

export default {
  name: "App",
  components: {
    AppHeader,
    ComposerBar,
    MessageList
  },
  data () {
    return {
      inputMode: false,
      recordState: "idle",
      recordLevel: 0,
      mockLevelTimer: null,
      recordStartAt: 0,
      sessionId: createSessionId(),
      isReplying: false,
      messageId: 4,
      messages: [
        {
          id: 1,
          role: "assistant",
          tag: "禧宝",
          text: "你好，我是禧宝。"
        }
      ]
    };
  },
  created () {
    this.typingJobs = {};
  },
  mounted () {
    window.addEventListener("record-volume", this.handleRecordVolume);
  },
  beforeDestroy () {
    window.removeEventListener("record-volume", this.handleRecordVolume);
    this.stopMockRecordLevel();
    Object.keys(this.typingJobs).forEach(key => {
      window.clearTimeout(this.typingJobs[key].timer);
    });
  },
  methods: {
    toggleInputMode () {
      if (this.recordState !== "idle") {
        return;
      }
      this.inputMode = !this.inputMode;
    },
    appendMessage (role, text, tag) {
      this.messages.push({
        id: this.messageId++,
        role,
        text,
        tag: tag || "",
        type: "text",
        loading: false,
        newsList: []
      });
      this.$nextTick(() => {
        const container = this.$refs.messageList && this.$refs.messageList.$el;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },
    createAssistantPlaceholder () {
      const message = {
        id: this.messageId++,
        role: "assistant",
        tag: "禧宝",
        text: "",
        type: "text",
        loading: true,
        newsList: []
      };

      this.messages.push(message);
      this.$nextTick(() => {
        const container = this.$refs.messageList && this.$refs.messageList.$el;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });

      return message.id;
    },
    updateMessageById (id, patch) {
      const index = this.messages.findIndex(item => item.id === id);
      if (index === -1) {
        return;
      }

      this.messages.splice(index, 1, {
        ...this.messages[index],
        ...patch
      });

      this.$nextTick(() => {
        const container = this.$refs.messageList && this.$refs.messageList.$el;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },
    stopTypingMessage (id) {
      if (!this.typingJobs[id]) {
        return;
      }
      window.clearTimeout(this.typingJobs[id].timer);
      delete this.typingJobs[id];
    },
    animateAssistantText (id, targetText) {
      const finalText = targetText || "";
      const currentJob = this.typingJobs[id];

      if (currentJob) {
        currentJob.targetText = finalText;
        return;
      }

      this.typingJobs[id] = {
        targetText: finalText,
        timer: null
      };

      const step = () => {
        const message = this.messages.find(item => item.id === id);
        const job = this.typingJobs[id];

        if (!message || !job) {
          this.stopTypingMessage(id);
          return;
        }

        const currentText = message.text || "";
        const nextTarget = job.targetText || "";

        if (currentText === nextTarget) {
          this.stopTypingMessage(id);
          return;
        }

        const nextText = nextTarget.slice(0, currentText.length + 2);
        this.updateMessageById(id, {
          type: "text",
          loading: false,
          text: nextText,
          newsList: []
        });

        job.timer = window.setTimeout(step, 18);
      };

      step();
    },
    async handleSendText (text) {
      this.appendMessage("user", text);
      const replyMessageId = this.createAssistantPlaceholder();

      try {
        this.isReplying = true;
        const result = await sendChatMessage({
          message: text,
          sessionId: this.sessionId,
          onEvent: payload => {
            if (payload.type === "news") {
              this.stopTypingMessage(replyMessageId);
              this.updateMessageById(replyMessageId, {
                type: "news",
                loading: false,
                text: "",
                newsList: payload.newsList || []
              });
              return;
            }

            this.animateAssistantText(replyMessageId, payload.text || "");
          }
        });

        if (result.type === "news") {
          this.stopTypingMessage(replyMessageId);
          this.updateMessageById(replyMessageId, {
            type: "news",
            loading: false,
            text: "",
            newsList: result.newsList || []
          });
        } else {
          this.animateAssistantText(replyMessageId, result.text || "暂时没有获取到回复内容。");
        }
      } catch (error) {
        this.stopTypingMessage(replyMessageId);
        this.updateMessageById(replyMessageId, {
          type: "text",
          loading: false,
          text: error && error.message ? error.message : "聊天接口调用失败，请稍后再试。",
          newsList: []
        });
      } finally {
        this.isReplying = false;
      }
    },
    normalizeRecordLevel (level) {
      const numericLevel = Number(level);
      if (!Number.isFinite(numericLevel)) {
        return 0;
      }
      if (numericLevel > 1) {
        return Math.min(numericLevel / 100, 1);
      }
      return Math.max(0, Math.min(numericLevel, 1));
    },
    handleRecordVolume (event) {
      const detail = event && event.detail ? event.detail : {};
      if (this.mockLevelTimer) {
        window.clearInterval(this.mockLevelTimer);
        this.mockLevelTimer = null;
      }
      this.recordLevel = this.normalizeRecordLevel(detail.level);
    },
    startMockRecordLevel () {
      this.stopMockRecordLevel();
      this.mockLevelTimer = window.setInterval(() => {
        if (this.recordState === "idle") {
          return;
        }
        const nextLevel = 0.2 + Math.random() * 0.8;
        this.recordLevel = Number(nextLevel.toFixed(2));
      }, 120);
    },
    stopMockRecordLevel () {
      if (this.mockLevelTimer) {
        window.clearInterval(this.mockLevelTimer);
        this.mockLevelTimer = null;
      }
      this.recordLevel = 0;
    },
    async handleRecordStart () {
      if (this.inputMode || this.recordState !== "idle") {
        return;
      }
      this.recordStartAt = Date.now();
      this.recordState = "recording";
      this.startMockRecordLevel();
      await startRecord();
    },
    handleRecordMove (deltaY) {
      if (this.recordState === "idle") {
        return;
      }
      this.recordState = deltaY > CANCEL_THRESHOLD ? "cancel" : "recording";
    },
    async handleRecordEnd () {
      if (this.recordState === "idle") {
        return;
      }
      if (this.recordState === "cancel") {
        await cancelRecord();
        this.recordState = "idle";
        this.recordStartAt = 0;
        this.stopMockRecordLevel();
        return;
      }
      const duration = Date.now() - this.recordStartAt;
      const result = await stopRecord();
      this.recordState = "idle";
      this.recordStartAt = 0;
      this.stopMockRecordLevel();
      if (duration < MIN_RECORD_DURATION) {
        return;
      }
      const speechText = (result.text || "").trim();
      if (!speechText) {
        return;
      }
      await this.handleSendText(speechText);
    },
    async handleRecordCancel () {
      if (this.recordState === "idle") {
        return;
      }
      await cancelRecord();
      this.recordState = "idle";
      this.recordStartAt = 0;
      this.stopMockRecordLevel();
    }
  }
};
</script>

<style scoped>
.page {
  height: 100vh;
  overflow: auto;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  flex-direction: column;
}
</style>
