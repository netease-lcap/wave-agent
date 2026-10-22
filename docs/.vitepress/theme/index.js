import { onMounted, watch, nextTick } from "vue";
import { useRoute } from "vitepress";
import DefaultTheme from "vitepress/theme";
import mediumZoom from "medium-zoom";

import "./zoom.css";
import "./gallery.css";
import "./features.css";
import "./phone-gallery.css";

// medium-zoom 1.x 没有 `dispose()`（那是 0.x 的 API），只有一个实例上可
// 增量 `attach()` / `detach()`。这里保持单例：首屏建立实例，之后每次路由
// 切换把上一页的元素解绑、再绑当前页的图片。
// 曾经写成「每次先 dispose 再重建」，`dispose` 不存在 → 路由切换时抛
// TypeError，重新绑定被整段跳过，于是 SPA 跳转到下一页后所有截图点击都
// 没反应（直接访问该页反而正常）。
let zoom = null;

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();
    const initZoom = () => {
      if (zoom) {
        zoom.detach();
        zoom.attach(".vp-doc img");
        return;
      }
      zoom = mediumZoom(".vp-doc img", {
        background: "var(--vp-c-bg)",
      });
    };
    onMounted(initZoom);
    watch(
      () => route.path,
      () => nextTick(initZoom),
    );
  },
};
