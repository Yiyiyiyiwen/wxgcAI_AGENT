<template>
  <section class="composer-wrap">
    <div v-if="showVoicePreview" class="voice-preview" :class="{ final: recordState === 'idle' && voiceText }">
      <van-icon name="chat-o" />
      <span class="voice-preview-text">{{ voiceText || "" }}</span>
    </div>

    <transition name="voice-fade">
      <div v-if="showVoiceOverlay" class="voice-overlay" :class="{ cancel: isCancelReady }">
        <div class="voice-orb" :style="voiceOrbStyle" aria-hidden="true">
          <span class="orb-core"></span>
        </div>
        <div class="overlay-hint" :class="{ danger: isCancelReady }">{{ hintText }}</div>
      </div>
    </transition>

    <div class="composer">
      <div class="input-shell">
        <div v-if="inputMode" class="text-mode">
          <van-field ref="textField" v-model.trim="draft" class="text-field" maxlength="200" placeholder="输入文字消息"
            @keyup.enter.native="emitSend" />
        </div>

        <div v-else class="press-area" :class="pressStateClass" @touchstart.prevent="handleTouchStart"
          @touchmove.prevent="handleTouchMove" @touchend.prevent="handleTouchEnd"
          @touchcancel.prevent="handleTouchCancel">
          <van-icon name="volume-o" />
          <span>{{ pressButtonText }}</span>
        </div>
      </div>

      <button v-if="showSendButton" class="send-btn active" type="button" aria-label="发送消息"
        @click="emitSend">
        <van-icon name="guide-o" />
      </button>

      <button v-else class="mode-btn" type="button" :aria-label="inputMode ? '切换到语音输入' : '切换到键盘输入'"
        @click="toggleMode">
        <van-icon :name="inputMode ? 'service-o' : 'edit'" />
      </button>

      <button v-if="canStopReply" class="stop-btn" type="button" aria-label="终止回答" @click="$emit('stop-reply')">
        <van-icon name="cross" />
      </button>
    </div>
  </section>
</template>

<script>
export default {
  name: "ComposerBar",
  props: {
    inputMode: {
      type: Boolean,
      default: false
    },
    recordState: {
      type: String,
      default: "idle"
    },
    recordLevel: {
      type: Number,
      default: 0
    },
    busy: {
      type: Boolean,
      default: false
    },
    canStopReply: {
      type: Boolean,
      default: false
    },
    voiceText: {
      type: String,
      default: ""
    }
  },
  data () {
    return {
      draft: "",
      startY: 0
    };
  },
  computed: {
    showSendButton () {
      return this.inputMode && Boolean(this.draft);
    },
    showVoicePreview () {
      return Boolean(this.voiceText) || this.recordState === "recording" || this.recordState === "cancel";
    },
    isCancelReady () {
      return this.recordState === "cancel";
    },
    showVoiceOverlay () {
      return this.recordState === "recording" || this.recordState === "cancel";
    },
    hintText () {
      if (this.recordState === "recording") {
        return "松手发送，上移取消";
      }
      if (this.recordState === "cancel") {
        return "松开手指，取消发送";
      }
      return this.inputMode ? "输入文字后发送" : "按住说话";
    },
    pressButtonText () {
      if (this.recordState === "cancel") {
        return "松开取消";
      }
      if (this.recordState === "recording") {
        return "正在录音";
      }
      return "按住说话";
    },
    pressStateClass () {
      return {
        active: this.recordState === "recording",
        cancel: this.recordState === "cancel"
      };
    },
    voiceOrbStyle () {
      const normalizedLevel = Math.max(0, Math.min(this.recordLevel || 0, 1));
      const scale = 0.92 + normalizedLevel * 0.22;
      const glow = 16 + Math.round(normalizedLevel * 26);
      return {
        transform: `scale(${scale})`,
        boxShadow: `0 12px ${glow}px rgba(66, 185, 255, 0.35)`
      };
    }
  },
  watch: {
    inputMode (value) {
      if (value) {
        this.focusTextField();
      }
    }
  },
  methods: {
    focusTextField () {
      this.$nextTick(() => {
        const field = this.$refs.textField;
        const input = field && field.$el ? field.$el.querySelector("input, textarea") : null;
        if (input) {
          input.focus();
        }
      });
    },
    emitSend () {
      if (!this.draft) {
        return;
      }
      this.$emit("send-text", this.draft);
      this.draft = "";
    },
    toggleMode () {
      this.$emit("toggle-input");
      if (!this.inputMode) {
        this.focusTextField();
      }
    },
    handleTouchStart (event) {
      const touch = event.changedTouches[0];
      this.startY = touch.clientY;
      this.$emit("record-start");
    },
    handleTouchMove (event) {
      const touch = event.changedTouches[0];
      const deltaY = this.startY - touch.clientY;
      this.$emit("record-move", deltaY);
    },
    handleTouchEnd () {
      this.$emit("record-end");
    },
    handleTouchCancel () {
      this.$emit("record-cancel");
    }
  }
};
</script>

<style scoped>
.composer-wrap {
  position: sticky;
  bottom: 0;
  z-index: 20;
  padding: 8px 12px calc(env(safe-area-inset-bottom) + 10px);
  background: linear-gradient(180deg, rgba(249, 249, 249, 0) 0%, rgba(249, 249, 249, 0.96) 24%);
}

.voice-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 15, 15, 0.08);
  color: #374151;
  font-size: 14px;
}

.voice-preview.final {
  color: #0f172a;
}

.voice-preview .van-icon {
  color: #1669f2;
  font-size: 16px;
}

.voice-preview-text {
  flex: 1;
  min-width: 0;
  line-height: 1.5;
  word-break: break-word;
}

.composer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(15, 15, 15, 0.08);
  box-shadow: 0 6px 18px rgba(15, 15, 15, 0.06);
}

.input-shell {
  flex: 1;
  min-width: 0;
  height: 40px;
}

.mode-btn,
.send-btn {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border: 0;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mode-btn {
  color: #111;
  background: #f3f3f3;
  font-size: 18px;
}

.text-mode {
  height: 100%;
}

.text-field {
  height: 100%;
  border-radius: 12px;
  background: #f6f6f6;
}

.text-field::v-deep .van-cell {
  height: 100%;
  padding: 0 12px;
}

.text-field::v-deep .van-field__body {
  height: 100%;
}

.text-field::v-deep .van-field__control {
  font-size: 15px;
}

.send-btn {
  color: #111;
  background: #f3f3f3;
  box-shadow: none;
  font-size: 18px;
}

.send-btn.active {
  color: #fff;
  background: #2f80ff;
  box-shadow: none;
  font-size: 18px;
}

.press-area {
  height: 100%;
  border-radius: 12px;
  border: 1px solid rgba(15, 15, 15, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #111;
  font-size: 15px;
  font-weight: 600;
  background: #f6f6f6;
}

.press-area .van-icon {
  font-size: 17px;
}

.press-area.active {
  color: #111;
  background: #ededed;
}

.press-area.cancel {
  color: var(--danger);
  background: #fff1f1;
  border-color: rgba(255, 91, 87, 0.18);
}

.voice-overlay {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom) + 132px);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transform: translateX(-50%);
  pointer-events: none;
}

.voice-orb {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 44%),
    conic-gradient(from 130deg, #62d4ff, #7f8cff, #e66df6, #62d4ff);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.orb-core {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff, #e8f5ff 58%, #c2dcff 100%);
}

.overlay-hint {
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(15, 23, 42, 0.12);
  color: rgba(15, 23, 42, 0.72);
  font-size: 13px;
  line-height: 1.3;
}

.overlay-hint.danger {
  color: #b42318;
  border-color: rgba(180, 35, 24, 0.18);
  background: rgba(255, 241, 240, 0.92);
}

.voice-overlay.cancel .voice-orb {
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 44%),
    conic-gradient(from 130deg, #ff8a80, #ff6b6b, #ffb199, #ff8a80);
}

.voice-fade-enter-active,
.voice-fade-leave-active {
  transition: opacity 0.18s ease;
}

.voice-fade-enter,
.voice-fade-leave-to {
  opacity: 0;
}

.stop-btn {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border: 0;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: #ef4444;
  font-size: 18px;
}
</style>
