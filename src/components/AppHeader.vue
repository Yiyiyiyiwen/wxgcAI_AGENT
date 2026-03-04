<template>
  <header class="app-header">
    <button class="icon-btn" type="button" aria-label="菜单">
      <van-icon name="wap-nav" />
    </button>
    <div class="agent-meta">
      <div class="avatar">豆</div>
      <div>
        <div class="name">语音智能体</div>
        <div class="desc">内容由 AI 生成</div>
      </div>
    </div>
    <div class="actions">
      <button class="ghost-icon" type="button" aria-label="通话">
        <van-icon name="phone-o" />
      </button>
      <button class="ghost-icon active" type="button" aria-label="语音">
        <van-icon name="service-o" />
      </button>
      <button class="ghost-icon" type="button" aria-label="更多">
        <van-icon name="ellipsis" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: calc(env(safe-area-inset-top) + 14px) 16px 14px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(14px);
}

.icon-btn,
.ghost-icon {
  border: 0;
  background: transparent;
  padding: 0;
}

.icon-btn {
  width: 34px;
  height: 34px;
  font-size: 22px;
  color: #111827;
}

.agent-meta {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.avatar {
  width: 46px;
  height: 46px;
  border-radius: 16px;
  background: linear-gradient(135deg, #f4b5a8, #8a6bff);
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 22px rgba(138, 107, 255, 0.28);
}

.name {
  font-size: 24px;
  font-weight: 700;
}

.desc {
  margin-top: 2px;
  color: var(--text-sub);
  font-size: 14px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ghost-icon {
  min-width: 32px;
  color: #111827;
  font-size: 20px;
  font-weight: 700;
}

.ghost-icon.active {
  color: var(--primary);
}
</style>
