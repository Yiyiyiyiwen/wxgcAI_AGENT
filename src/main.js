import Vue from "vue";
import Vant from "vant";
import App from "./App.vue";
import "vant/lib/index.css";
import "./styles/base.css";

const ENABLE_VCONSOLE = String(process.env.VUE_APP_ENABLE_VCONSOLE || "").toLowerCase() === "true";

Vue.config.productionTip = false;
Vue.use(Vant);

if (process.env.NODE_ENV === "production" && ENABLE_VCONSOLE) {
  import("vconsole").then(module => {
    const VConsole = module && module.default ? module.default : null;
    if (!VConsole || window.__WXGC_VCONSOLE__) {
      return;
    }
    window.__WXGC_VCONSOLE__ = new VConsole();
    // eslint-disable-next-line no-console
    console.info("[WXGC] vConsole ready");
  }).catch(error => {
    // eslint-disable-next-line no-console
    console.info("[WXGC] vConsole init failed", error && error.message ? error.message : "");
  });
}

new Vue({
  render: h => h(App)
}).$mount("#app");
