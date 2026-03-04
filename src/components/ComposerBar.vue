<template>
  <section class="composer-wrap">
    <transition name="voice-fade">
      <div v-if="showVoiceOverlay" class="voice-overlay" :class="{ cancel: isCancelReady }">
        <div class="overlay-mask"></div>
        <div class="overlay-card">
          <div class="overlay-title">{{ overlayTitle }}</div>
          <div class="overlay-subtitle" :class="{ danger: isCancelReady }">
            {{ hintText }}
          </div>
          <div class="voice-wave" aria-hidden="true">
            <span v-for="bar in volumeBars" :key="bar.id" class="wave-bar" :style="bar.style"></span>
          </div>
        </div>
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

      <button v-if="showSendButton" class="send-btn active" type="button" aria-label="发送消息" @click="emitSend">
        <van-icon name="guide-o" />
      </button>

      <button v-else class="mode-btn" type="button" :aria-label="inputMode ? '切换到语音输入' : '切换到键盘输入'" @click="toggleMode">
        <van-icon :name="inputMode ? 'service-o' : 'edit'" />
      </button>
    </div>
  </section>
</template>

<script>
const WAVE_BAR_COUNT = 38;

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
    overlayTitle () {
      return this.isCancelReady ? "上移取消" : "松手发送";
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
    volumeBars () {
      const normalizedLevel = Math.max(0, Math.min(this.recordLevel || 0, 1));

      return Array.from({ length: WAVE_BAR_COUNT }, (_, index) => {
        const centerDistance = Math.abs(index - (WAVE_BAR_COUNT - 1) / 2);
        const spread = 1 - centerDistance / (WAVE_BAR_COUNT / 2);
        const randomFactor = ((index % 5) + 1) / 5;
        const baseHeight = 10 + spread * 12;
        const activeBoost = normalizedLevel * (26 + randomFactor * 18);
        const height = Math.round(baseHeight + activeBoost * (0.45 + spread * 0.55));
        const opacity = 0.28 + spread * 0.24 + normalizedLevel * 0.42;

        return {
          id: index,
          style: {
            height: `${height}px`,
            opacity,
            animationDelay: `${index * 0.04}s`
          }
        };
      });
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
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  pointer-events: none;
}

.overlay-mask {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at center, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.08) 34%, rgba(255, 255, 255, 0) 70%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(244, 244, 244, 0.72));
  backdrop-filter: blur(12px);
}

.overlay-card {
  position: relative;
  width: min(560px, 100%);
  padding: 28px 20px 24px;
  border-radius: 24px;
  text-align: center;
}

.overlay-title {
  margin-bottom: 12px;
  color: #111;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 1px;
}

.overlay-subtitle {
  margin-bottom: 24px;
  color: rgba(17, 17, 17, 0.66);
  font-size: 16px;
}

/* .overlay-subtitle.danger {
  color: #ffe3e2;
} */

.voice-wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 64px;
}

.wave-bar {
  width: 4px;
  border-radius: 999px;
  background: rgba(17, 17, 17, 0.9);
  transform-origin: center;
  animation: wave-bounce 1.1s ease-in-out infinite;
}

.voice-overlay.cancel .overlay-mask {
  background:
    radial-gradient(circle at center, rgba(255, 91, 87, 0.22), rgba(255, 91, 87, 0.08) 34%, rgba(255, 255, 255, 0) 70%),
    linear-gradient(180deg, rgba(255, 249, 249, 0.94), rgba(255, 241, 241, 0.7));
}

.voice-overlay.cancel .overlay-title,
.voice-overlay.cancel .wave-bar {
  color: #111;
  /* background: rgba(17, 17, 17, 0.9); */
}

.voice-fade-enter-active,
.voice-fade-leave-active {
  transition: opacity 0.18s ease;
}

.voice-fade-enter,
.voice-fade-leave-to {
  opacity: 0;
}

@keyframes wave-bounce {

  0%,
  100% {
    transform: scaleY(0.8);
  }

  50% {
    transform: scaleY(1.15);
  }
}
</style>
