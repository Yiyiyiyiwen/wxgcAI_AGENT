module.exports = {
  publicPath: '/',
  productionSourceMap: false,
  devServer: {
    proxy: {
      "/chat": {
        target: process.env.VUE_APP_CHAT_PROXY_TARGET || "https://xibao.llteac.cn",
        changeOrigin: true,
        secure: false
      }
    }
  }
};
