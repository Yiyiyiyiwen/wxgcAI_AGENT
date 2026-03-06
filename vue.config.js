module.exports = {
  publicPath: process.env.NODE_ENV === "development" ? "/" : "/wxgc-agent/",
  productionSourceMap: false,
  devServer: {
    proxy: {
      "/wxgc": {
        target: process.env.VUE_APP_CHAT_PROXY_TARGET || "https://workbooks.wxrb.com",
        changeOrigin: true,
        secure: false
      }
    }
  }
};
