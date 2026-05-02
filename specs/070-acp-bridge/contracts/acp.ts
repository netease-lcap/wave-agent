import {
  type SessionId as AcpSessionId,
  type ToolCallStatus,
  type ToolCallContent,
  type ToolCallLocation,
  type ToolKind,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";

export interface AcpSessionState {
  sessionId: AcpSessionId;
  modes: {
    currentModeId: string;
    availableModes: Array<{
      id: string;
      name: string;
      description: string;
    }>;
  };
  configOptions: SessionConfigOption[];
}

export interface AcpToolCallUpdate {
  toolCallId: string;
  status: ToolCallStatus;
  title: string;
  rawOutput?: any;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  kind?: ToolKind;
  rawInput?: any;
}

export interface AcpPlanUpdate {
  entries: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority: "low" | "medium" | "high";
  }>;
}

export interface AcpMcpServerStatus {
  name: string;
  status: "disconnected" | "connected" | "connecting" | "error";
  toolCount?: number;
  error?: string;
}
