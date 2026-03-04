import Vue from "vue";
import Vant from "vant";
import App from "./App.vue";
import "vant/lib/index.css";
import "./styles/base.css";

Vue.config.productionTip = false;
Vue.use(Vant);

new Vue({
  render: h => h(App)
}).$mount("#app");
