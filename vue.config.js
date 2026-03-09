module.exports = {
  publicPath: process.env.NODE_ENV === "development" ? "/" : "/wxgc-agent/",
  productionSourceMap: false,
  devServer: {
    proxy: {
      "/wxgc": {
        target: process.env.VUE_APP_CHAT_PROXY_TARGET || "https://workbooks.wxrb.com",
        changeOrigin: true,
        secure: false,
        onProxyReq(proxyReq) {
          // SSE 调试：禁用上游压缩，减少多段事件被合并后才下发的概率。
          proxyReq.setHeader("Accept-Encoding", "identity");
          proxyReq.setHeader("Connection", "keep-alive");
        },
        onProxyRes(proxyRes) {
          // SSE 调试：明确关闭代理缓存/缓冲语义。
          proxyRes.headers["cache-control"] = "no-cache";
          proxyRes.headers["x-accel-buffering"] = "no";
        }
      }
    }
  }
};
