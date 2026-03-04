function wait(ms) {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

export async function startRecord() {
  if (window.AppBridge && typeof window.AppBridge.startRecord === "function") {
    return window.AppBridge.startRecord();
  }
  return wait(120);
}

export async function stopRecord() {
  if (window.AppBridge && typeof window.AppBridge.stopRecord === "function") {
    return window.AppBridge.stopRecord();
  }
  return {
    text: "这是一个模拟语音识别结果，可以替换成 App 原生录音返回内容。"
  };
}

export async function cancelRecord() {
  if (window.AppBridge && typeof window.AppBridge.cancelRecord === "function") {
    return window.AppBridge.cancelRecord();
  }
  return wait(80);
}

export function openNewsDetail(news) {
  if (window.AppBridge && typeof window.AppBridge.openNewsDetail === "function") {
    return window.AppBridge.openNewsDetail(news);
  }

  console.info("openNewsDetail placeholder", news);
  return null;
}
