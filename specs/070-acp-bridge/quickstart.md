# Quickstart: ACP Bridge

The ACP (Agent Control Protocol) bridge allows you to connect external clients, such as IDE plugins, to Wave Agent.

## Usage

1. Start the Wave Agent in ACP mode:
   ```bash
   wave acp
   ```
   This will start the agent and wait for ACP-compliant JSON-RPC messages on `stdin`.

2. Connect your client (e.g., a VS Code extension) to the agent's `stdin` and `stdout`.

3. Send an `initialize` request to start the connection:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "initialize",
     "params": {
       "protocolVersion": 1,
       "clientInfo": { "name": "my-ide-plugin", "version": "1.0.0" }
     }
   }
   ```

4. Create a new session:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 2,
     "method": "newSession",
     "params": { "cwd": "/path/to/your/project" }
   }
   ```

5. Send a prompt to the agent:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 3,
     "method": "prompt",
     "params": {
       "sessionId": "your-session-id",
       "prompt": [{ "type": "text", "text": "Hello, Wave!" }]
     }
   }
   ```

6. Listen for `sessionUpdate` notifications on `stdout` for streaming responses and tool call updates.

## Example Output (stdout)

```json
{
  "jsonrpc": "2.0",
  "method": "sessionUpdate",
  "params": {
    "sessionId": "your-session-id",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "Hello! How can I help you today?" }
    }
  }
}
```
