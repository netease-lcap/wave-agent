/**
 * Represents the state of a file before an agent operation.
 */
export interface FileSnapshot {
  /** The ID of the message/turn this snapshot is associated with. */
  messageId: string;
  /** Absolute path to the file. */
  filePath: string;
  /** The content of the file before the operation. null if the file did not exist. */
  content: string | null;
  /** When the snapshot was taken. */
  timestamp: number;
  /** The operation that triggered this snapshot. */
  operation: "create" | "modify" | "delete";
}

/**
 * A point in the conversation history that can be reverted to.
 */
export interface Checkpoint {
  /** The index of the user message in the history. */
  index: number;
  /** The unique ID of the user message. */
  messageId: string;
  /** A short snippet of the message content for the UI. */
  preview: string;
  /** When the message was sent. */
  timestamp: number;
}
