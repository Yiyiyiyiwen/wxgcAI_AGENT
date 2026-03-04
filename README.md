# Vue 2 移动端语音智能体骨架

## 说明

- 技术栈：Vue 2 + Vue CLI Service
- 形态：适合嵌入 App WebView 的单页 H5
- 已实现：
  - 顶部简化智能体头部区域
  - 中间左右对话消息流
  - 底部默认按住说话
  - 按住后上滑取消
  - 右侧按钮切换文字输入/语音输入
  - 预留 App 原生桥录音接口

## 启动

```bash
npm install
npm run serve
```

## 构建

```bash
npm run build
```

## 目录

- `src/App.vue`：页面容器和交互状态
- `src/components/MessageList.vue`：消息列表
- `src/components/ComposerBar.vue`：底部输入区
- `src/utils/appBridge.js`：App 原生桥适配层

## 原生接入

默认使用 `window.AppBridge` 作为示例桥对象，预留了三个方法：

- `startRecord()`
- `stopRecord()`
- `cancelRecord()`

如果 App 侧命名不同，直接改 `src/utils/appBridge.js` 即可。
