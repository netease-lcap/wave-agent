/**
 * 助手消息底部动作行里的时间（spec: ui/message-rendering-system.md
 * 「助手消息底部的时间戳」）。
 *
 * 三个字段各有用处，不能合并：
 * - `label` 是**给人看的**短格式：同一天只给时分（长会话里绝大多数消息都属于这类，
 *   带日期纯属噪音），跨天补日期，跨年再补年份；
 * - `full` 是悬停提示里那行完整时间，把 `label` 省略掉的部分补回来；
 * - `iso` 是原始时间戳，落在 `<time datetime>` 上。**按时间排序 / 比对一律用它**，
 *   不用可见文本 —— 后者随本地时区变，同一个会话在另一台设备上看到的字符串不同。
 */
export interface MessageTimeLabel {
  iso: string;
  label: string;
  full: string;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * 时间戳缺失或解析不出来（老数据）时返回 `null`：调用方据此整块不渲染，而不是显示
 * 一个「Invalid Date」。
 *
 * `now` 只为测试注入——展示层永远按「现在」算「是不是同一天」。
 */
export const formatMessageTime = (
  timestamp: string | undefined,
  now: Date = new Date(),
): MessageTimeLabel | null => {
  if (!timestamp) return null;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;

  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameYear = at.getFullYear() === now.getFullYear();
  const sameDay =
    sameYear &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  const date = `${at.getMonth() + 1}月${at.getDate()}日`;

  return {
    iso: timestamp,
    label: sameDay
      ? time
      : `${sameYear ? date : `${at.getFullYear()}年${date}`} ${time}`,
    full: `${at.getFullYear()}年${date} ${time}`,
  };
};
