import { createContext, useContext } from "react";

/**
 * 「内容就地长高之前，先解除钉底」。
 *
 * 消息流里所有可点击展开的元件（思考块、压缩块、聚焦视图的折叠卡）一展开就
 * 长高，虚拟列表会把这次高度变化当成「又来了新内容」而贴底跟随，于是被点的
 * 那一行被顶出视口（实测：贴底点开思考块上移 44px，点开折叠卡上移 339px）。
 *
 * 展开前调用它，内核改按锚点补偿 —— 被点的位置原地不动、内容往下长；用户再
 * 滚到底会自动重新钉上（见 useVirtualRows 的 scroll 分类）。
 */
const ScrollHoldContext = createContext<() => void>(() => {});

export const ScrollHoldProvider = ScrollHoldContext.Provider;

export const useHoldScroll = () => useContext(ScrollHoldContext);
