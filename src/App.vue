<template>
  <div class="page">
    <!-- <AppHeader /> -->
    <MessageList ref="messageList" :messages="messages" />
    <button v-if="showScrollBottom" class="scroll-bottom-btn" type="button" aria-label="滚动到底部"
      @click="scrollToBottom(true)">
      <van-icon name="arrow-down" />
    </button>
    <ComposerBar :input-mode="inputMode" :record-state="recordState" :record-level="recordLevel" :busy="isReplying"
      :can-stop-reply="isReplying" :voice-text="voiceRecognizingText" @toggle-input="toggleInputMode"
      @send-text="handleSendText" @record-start="handleRecordStart" @record-move="handleRecordMove"
      @record-end="handleRecordEnd" @record-cancel="handleRecordCancel" @stop-reply="handleStopReply" />
  </div>
</template>

<script>
import AppHeader from "./components/AppHeader.vue";
import ComposerBar from "./components/ComposerBar.vue";
import MessageList from "./components/MessageList.vue";
import { createSessionId, sendChatMessage } from "./utils/chatApi";
import { cancelRecord, offVoiceResult, onVoiceResult, startRecord, stopRecord } from "./utils/appBridge";

const CANCEL_THRESHOLD = 70;
const MIN_RECORD_DURATION = 600;
const DEBUG_ENV = String(process.env.VUE_APP_DEBUG_LOG || "").toLowerCase();

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
      voiceRecognizingText: "",
      voiceFinalText: "",
      showScrollBottom: false,
      sessionId: createSessionId(),
      isReplying: false,
      activeReplyMessageId: null,
      messageId: 4,
      messages: [
        {
          id: 1,
          role: "assistant",
          tag: "禧宝",
          text: "你好！我是禧宝，无锡日报报业集团的AI代言人。有什么问题我可以帮助你吗？"
        }
      ]
    };
  },
  created () {
    this.typingJobs = {};
    this.activeReplyStop = null;
    this.replyTokenSeed = 0;
    this.currentReplyToken = null;
  },
  mounted () {
    window.addEventListener("record-volume", this.handleRecordVolume);
    onVoiceResult(this.handleVoiceResult);
    this.$nextTick(() => {
      const container = this.getMessageContainer();
      if (container) {
        container.addEventListener("scroll", this.handleMessageListScroll);
        this.handleMessageListScroll();
      }
    });
  },
  beforeDestroy () {
    window.removeEventListener("record-volume", this.handleRecordVolume);
    offVoiceResult();
    const container = this.getMessageContainer();
    if (container) {
      container.removeEventListener("scroll", this.handleMessageListScroll);
    }
    this.stopMockRecordLevel();
    this.clearActiveReplyStop();
    Object.keys(this.typingJobs).forEach(key => {
      window.clearTimeout(this.typingJobs[key].timer);
    });
  },
  methods: {
    isDebugEnabled () {
      if (typeof window !== "undefined" && typeof window.__WXGC_DEBUG__ === "boolean") {
        return window.__WXGC_DEBUG__;
      }
      if (DEBUG_ENV === "true") {
        return true;
      }
      return process.env.NODE_ENV !== "production";
    },
    debugLog (stage, payload) {
      if (!this.isDebugEnabled()) {
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
      console.info("[WXGC][app]", record);
    },
    clearActiveReplyStop () {
      this.activeReplyStop = null;
    },
    async handleStopReply () {
      if (!this.activeReplyStop) {
        this.isReplying = false;
        this.activeReplyMessageId = null;
        this.currentReplyToken = null;
        return;
      }
      const replyMessageId = this.activeReplyMessageId;
      const stop = this.activeReplyStop;
      this.clearActiveReplyStop();
      stop("manual-stop");
      if (replyMessageId) {
        this.stopTypingMessage(replyMessageId);
        const currentMessage = this.messages.find(item => item.id === replyMessageId);
        const currentText = currentMessage && typeof currentMessage.text === "string"
          ? currentMessage.text.trim()
          : "";
        this.updateMessageById(replyMessageId, {
          type: "text",
          loading: false,
          text: currentText || "回答已终止。",
          newsList: []
        });
      }
      this.isReplying = false;
      this.activeReplyMessageId = null;
      this.currentReplyToken = null;
      this.debugLog("reply:stopped-by-user", { messageId: replyMessageId });
    },
    toggleInputMode () {
      if (this.recordState !== "idle") {
        return;
      }
      this.inputMode = !this.inputMode;
    },
    getMessageContainer () {
      return this.$refs.messageList && this.$refs.messageList.$el;
    },
    scrollToBottom (smooth) {
      const container = this.getMessageContainer();
      if (!container) {
        return;
      }
      const behavior = smooth ? "smooth" : "auto";
      if (typeof container.scrollTo === "function") {
        container.scrollTo({
          top: container.scrollHeight,
          behavior
        });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    },
    handleMessageListScroll () {
      const container = this.getMessageContainer();
      if (!container) {
        this.showScrollBottom = false;
        return;
      }
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      this.showScrollBottom = distanceToBottom > 120;
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
      this.$nextTick(() => this.scrollToBottom(false));
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
      this.$nextTick(() => this.scrollToBottom(false));

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

      this.$nextTick(() => this.scrollToBottom(false));
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
    // 处理发送文本/语音消息
    async handleSendText (text) {
      const cleanText = (text || "").trim();
      if (!cleanText || this.recordState !== "idle") {
        return;
      }
      if (this.isReplying) {
        await this.handleStopReply();
      }
      this.appendMessage("user", cleanText);
      // 插入等待动画占位
      const replyMessageId = this.createAssistantPlaceholder();
      //生成本次请求 token（防旧流回灌）
      const replyToken = ++this.replyTokenSeed;
      this.activeReplyMessageId = replyMessageId;
      this.currentReplyToken = replyToken;
      this.debugLog("reply:start", { messageId: replyMessageId, textLength: cleanText.length });

      try {
        this.isReplying = true;
        const result = await sendChatMessage({
          message: cleanText,
          sessionId: this.sessionId,
          //终止按钮回调
          onRegisterStop: stop => {
            this.activeReplyStop = stop;
          },
          onEvent: payload => {
            if (this.currentReplyToken !== replyToken) {
              return;
            }
            //新闻卡片
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
            //否则文本流
            this.animateAssistantText(replyMessageId, payload.text || "");
          }
        });
        this.clearActiveReplyStop();
        if (this.currentReplyToken !== replyToken) {
          return;
        }

        if (result.stopped) {
          this.stopTypingMessage(replyMessageId);
          const current = this.messages.find(item => item.id === replyMessageId);
          const currentText = current && current.text ? current.text.trim() : "";
          this.updateMessageById(replyMessageId, {
            type: "text",
            loading: false,
            text: currentText || "回答已终止。",
            newsList: []
          });
        } else if (result.type === "news") {
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
        this.clearActiveReplyStop();
        if (this.currentReplyToken !== replyToken) {
          return;
        }
        this.stopTypingMessage(replyMessageId);
        this.updateMessageById(replyMessageId, {
          type: "text",
          loading: false,
          text: error && error.message ? error.message : "聊天接口调用失败，请稍后再试。",
          newsList: []
        });
      } finally {
        if (this.currentReplyToken === replyToken) {
          this.currentReplyToken = null;
          this.activeReplyMessageId = null;
          this.isReplying = false;
        }
      }
    },
    handleVoiceResult (text, isFinal) {
      const nextText = (text || "").trim();
      this.debugLog("voice:result", { isFinal: Boolean(isFinal), length: nextText.length });
      this.voiceRecognizingText = nextText;
      if (isFinal && nextText) {
        this.voiceFinalText = nextText;
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
      if (this.isReplying) {
        await this.handleStopReply();
      }
      this.voiceRecognizingText = "";
      this.voiceFinalText = "";
      this.recordStartAt = Date.now();
      this.recordState = "recording";
      this.startMockRecordLevel();
      this.debugLog("voice:start");
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
        this.voiceRecognizingText = "";
        this.voiceFinalText = "";
        return;
      }
      const duration = Date.now() - this.recordStartAt;
      const result = await stopRecord();
      this.recordState = "idle";
      this.recordStartAt = 0;
      this.stopMockRecordLevel();
      this.debugLog("voice:stop", { duration });
      if (duration < MIN_RECORD_DURATION) {
        this.voiceRecognizingText = "";
        this.voiceFinalText = "";
        return;
      }
      const speechText = (this.voiceFinalText || this.voiceRecognizingText || (result && result.text) || "").trim();
      if (!speechText) {
        this.voiceRecognizingText = "";
        this.voiceFinalText = "";
        return;
      }
      this.voiceRecognizingText = "";
      this.voiceFinalText = "";
      await this.handleSendText(speechText);
      this.voiceRecognizingText = "";
      this.voiceFinalText = "";
    },
    async handleRecordCancel () {
      if (this.recordState === "idle") {
        return;
      }
      await cancelRecord();
      this.recordState = "idle";
      this.recordStartAt = 0;
      this.stopMockRecordLevel();
      this.voiceRecognizingText = "";
      this.voiceFinalText = "";
    }
  }
};
</script>

<style scoped>
.page {
  position: relative;
  height: 100vh;
  overflow: auto;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  flex-direction: column;
}

.scroll-bottom-btn {
  position: fixed;
  right: 16px;
  bottom: calc(env(safe-area-inset-bottom) + 90px);
  z-index: 18;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgba(17, 24, 39, 0.65);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.18);
}
</style>
