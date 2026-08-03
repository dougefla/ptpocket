import { createApp } from "vue";

import App from "./App.vue";
import "./styles.css";

createApp(App).mount("#app");

// 只在生产构建里注册 SW —— dev 下会缓存住旧代码，很烦
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 非 HTTPS 环境注册失败是正常的，忽略 */
    });
  });
}
