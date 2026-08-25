import { onMounted, watch, nextTick } from "vue";
import { useRoute } from "vitepress";
import DefaultTheme from "vitepress/theme";
import mediumZoom from "medium-zoom";

import "./zoom.css";

let zoom = null;

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();
    const initZoom = () => {
      zoom?.dispose();
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
