<template>
  <div class="page">
    <!-- <AppHeader /> -->
    <MessageList ref="messageList" :messages="messages" @news-click="handleNewsClick" />
    <button v-if="showScrollBottom" class="scroll-bottom-btn" type="button" aria-label="滚动到底部"
      @click="scrollToBottom(true)">
      <van-icon name="arrow-down" />
    </button>
    <ComposerBar :input-mode="inputMode" :record-state="recordState" :record-level="recordLevel" :busy="isReplying"
      :can-stop-reply="isReplying" :voice-text="voiceRecognizingText" @toggle-input="toggleInputMode"
      @send-text="handleSendText" @record-start="handleRecordStart" @record-move="handleRecordMove"
      @record-end="handleRecordEnd" @record-cancel="handleRecordCancel" @stop-reply="handleStopReply" />
    <section v-if="newsFrameVisible" class="news-frame-layer">
      <button class="news-frame-back" type="button" aria-label="关闭新闻详情" @click="closeNewsFrame">
        <van-icon name="arrow-left" />
      </button>
      <iframe class="news-frame" :src="newsFrameUrl" title="新闻详情"></iframe>
    </section>
  </div>
</template>

<script>
import AppHeader from "./components/AppHeader.vue";
import ComposerBar from "./components/ComposerBar.vue";
import MessageList from "./components/MessageList.vue";
import { createSessionId, sendChatMessage, stopChatReply } from "./utils/chatApi";
import { cancelRecord, offVoiceResult, onVoiceResult, startRecord, stopRecord } from "./utils/appBridge";

const CANCEL_THRESHOLD = 70;
const MIN_RECORD_DURATION = 600;
const FINAL_RESULT_WAIT_TIMEOUT = 1200;
const NEWS_DETAIL_BASE_URL = process.env.VUE_APP_NEWS_DETAIL_BASE_URL || "https://workbooks.wxrb.com";
const NEWS_DETAIL_PATH = "/wxgc-h5/article.html";
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
      newsFrameVisible: false,
      newsFrameUrl: "",
      sessionId: createSessionId(),
      isReplying: false,
      activeReplyMessageId: null,
      messageId: 4,
      messages: [
        {
          id: 1,
          role: "assistant",
          tag: "禧宝",
          text: "你好！我是禧宝，无锡日报报业集团的AI代言人。有什么问题我可以帮助你吗？",
          thoughts: ""
        }
      ]
    };
  },
  created () {
    this.activeReplyStop = null;
    this.replyTokenSeed = 0;
    this.currentReplyToken = null;
    this.waitFinalVoiceResolver = null;
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
    this.resolveFinalVoiceWait();
    this.clearActiveReplyStop();
  },
  methods: {
    resolveFinalVoiceWait () {
      if (typeof this.waitFinalVoiceResolver === "function") {
        this.waitFinalVoiceResolver();
      }
      this.waitFinalVoiceResolver = null;
    },
    waitForFinalVoiceResult () {
      if (this.voiceFinalText) {
        return Promise.resolve();
      }

      return new Promise(resolve => {
        let timer = null;
        this.waitFinalVoiceResolver = () => {
          if (timer) {
            window.clearTimeout(timer);
            timer = null;
          }
          resolve();
        };
        timer = window.setTimeout(() => {
          this.resolveFinalVoiceWait();
        }, FINAL_RESULT_WAIT_TIMEOUT);
      });
    },
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
      const requestSessionId = this.sessionId;
      const replyMessageId = this.activeReplyMessageId;
      const stop = this.activeReplyStop;
      this.clearActiveReplyStop();
      stopChatReply(requestSessionId);
      stop("manual-stop");
      if (replyMessageId) {
        const currentMessage = this.messages.find(item => item.id === replyMessageId);
        const currentText = currentMessage && typeof currentMessage.text === "string"
          ? currentMessage.text.trim()
          : "";
        this.updateMessageById(replyMessageId, {
          type: "text",
          loading: false,
          text: currentText || "回答已终止。",
          thoughts: "",
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
    buildNewsDetailUrl (news) {
      const source = news && typeof news.cardSource === "string"
        ? news.cardSource.toLowerCase()
        : (news && typeof news.source === "string" ? news.source.toLowerCase() : "");
      const sourceLink = news && (news.sourceLink || news.source_link) ? String(news.sourceLink || news.source_link) : "";
      if (source === "network" && sourceLink) {
        return sourceLink;
      }
      const contentId = news && (news.contentId || news.content_id) ? String(news.contentId || news.content_id) : "";
      const siteId = news && (news.siteId || news.site_id) ? String(news.siteId || news.site_id) : "";
      const url = new URL(NEWS_DETAIL_PATH, NEWS_DETAIL_BASE_URL);
      if (contentId) {
        url.searchParams.set("contentId", contentId);
      }
      if (siteId) {
        url.searchParams.set("siteId", siteId);
      }
      return url.toString();
    },
    handleNewsClick (news) {
      const targetUrl = this.buildNewsDetailUrl(news);
      if (!targetUrl) {
        return;
      }
      this.newsFrameUrl = targetUrl;
      this.newsFrameVisible = true;
    },
    closeNewsFrame () {
      this.newsFrameVisible = false;
      this.newsFrameUrl = "";
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
        thoughts: "",
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
        thoughts: "",
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
      const requestStartAt = window.performance && typeof window.performance.now === "function"
        ? window.performance.now()
        : Date.now();
      let firstChunkLogged = false;
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
            if (!firstChunkLogged) {
              firstChunkLogged = true;
              const now = window.performance && typeof window.performance.now === "function"
                ? window.performance.now()
                : Date.now();
              const elapsed = Math.max(0, now - requestStartAt);
              // eslint-disable-next-line no-console
              console.info(`[WXGC] 首包返回耗时: ${elapsed.toFixed(0)}ms`, {
                type: payload.type,
                done: Boolean(payload.done)
              });
            }
            //新闻卡片
            if (payload.type === "news") {
              this.updateMessageById(replyMessageId, {
                type: "news",
                loading: false,
                text: "",
                thoughts: payload.thoughts || "",
                newsList: payload.newsList || []
              });
              return;
            }
            //否则文本流
            this.updateMessageById(replyMessageId, {
              type: "text",
              loading: false,
              text: payload.text || "",
              thoughts: payload.thoughts || "",
              newsList: []
            });
          }
        });
        this.clearActiveReplyStop();
        if (!firstChunkLogged) {
          const now = window.performance && typeof window.performance.now === "function"
            ? window.performance.now()
            : Date.now();
          const elapsed = Math.max(0, now - requestStartAt);
          // eslint-disable-next-line no-console
          console.info(`[WXGC] 未收到流式首包，等待到请求结束耗时: ${elapsed.toFixed(0)}ms`);
        }
        if (this.currentReplyToken !== replyToken) {
          return;
        }

        if (result.stopped) {
          const current = this.messages.find(item => item.id === replyMessageId);
          const currentText = current && current.text ? current.text.trim() : "";
          this.updateMessageById(replyMessageId, {
            type: "text",
            loading: false,
            text: currentText || "回答已终止。",
            thoughts: "",
            newsList: []
          });
        } else if (result.type === "news") {
          this.updateMessageById(replyMessageId, {
            type: "news",
            loading: false,
            text: "",
            thoughts: result.thoughts || "",
            newsList: result.newsList || []
          });
        } else {
          this.updateMessageById(replyMessageId, {
            type: "text",
            loading: false,
            text: result.text || "暂时没有获取到回复内容。",
            thoughts: result.thoughts || "",
            newsList: []
          });
        }
      } catch (error) {
        this.clearActiveReplyStop();
        if (this.currentReplyToken !== replyToken) {
          return;
        }
        this.updateMessageById(replyMessageId, {
          type: "text",
          loading: false,
          text: error && error.message ? error.message : "聊天接口调用失败，请稍后再试。",
          thoughts: "",
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
        this.resolveFinalVoiceWait();
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
        this.resolveFinalVoiceWait();
        this.voiceRecognizingText = "";
        this.voiceFinalText = "";
        return;
      }
      await this.waitForFinalVoiceResult();
      const speechText = (this.voiceFinalText || this.voiceRecognizingText || (result && result.text) || "").trim();
      if (!speechText) {
        this.resolveFinalVoiceWait();
        this.voiceRecognizingText = "";
        this.voiceFinalText = "";
        return;
      }
      this.resolveFinalVoiceWait();
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
      this.resolveFinalVoiceWait();
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

.news-frame-layer {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: #fff;
}

.news-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.news-frame-back {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 10px);
  left: 12px;
  z-index: 61;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
</style>
