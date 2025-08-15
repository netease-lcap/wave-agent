import type { Message } from "../types";

/**
 * 预处理消息数组，识别连续的 assistant 消息组并添加分组信息
 */
export function processMessageGroups(messages: Message[]): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  const processedMessages = [...messages];
  let i = 0;

  while (i < processedMessages.length) {
    const currentMessage = processedMessages[i];

    // 只处理 assistant 消息
    if (currentMessage.role !== "assistant") {
      // 清除非 assistant 消息的分组信息
      processedMessages[i] = {
        ...currentMessage,
        groupInfo: undefined,
      };
      i++;
      continue;
    }

    // 查找连续的 assistant 消息
    let groupEnd = i;
    while (
      groupEnd + 1 < processedMessages.length &&
      processedMessages[groupEnd + 1].role === "assistant"
    ) {
      groupEnd++;
    }

    // 如果只有一条 assistant 消息，清除分组信息
    if (groupEnd === i) {
      processedMessages[i] = {
        ...currentMessage,
        groupInfo: undefined,
      };
      i++;
      continue;
    }

    // 有连续的 assistant 消息，设置分组信息
    const groupRange = `${i + 1}-${groupEnd + 1}`;

    // 设置第一条消息为组开始
    processedMessages[i] = {
      ...processedMessages[i],
      groupInfo: {
        isGroupStart: true,
        isGroupMember: true,
        groupRange,
      },
    };

    // 设置后续消息为组成员
    for (let j = i + 1; j <= groupEnd; j++) {
      processedMessages[j] = {
        ...processedMessages[j],
        groupInfo: {
          isGroupStart: false,
          isGroupMember: true,
          groupRange,
        },
      };
    }

    // 移动到下一个非组消息
    i = groupEnd + 1;
  }

  return processedMessages;
}
