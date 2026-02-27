# Quickstart: Status Command

The `/status` command allows you to quickly view the current configuration and session details of the Wave Agent.

## Usage

1. Start the Wave CLI:
   ```bash
   wave
   ```

2. Type `/status` in the input box and press `Enter`.

3. A status overlay will appear showing:
   - **Version**: The current version of the Wave CLI.
   - **Session ID**: The unique identifier for your current session.
   - **cwd**: The current working directory the agent is operating in.
   - **Wave base URL**: The API endpoint the agent is communicating with.
   - **Model**: The AI model currently being used.

4. Press `Esc` to dismiss the status overlay and return to your chat.

## Example Output

```text
Version: 0.7.1
Session ID: 083e4351-f98e-4ee2-afce-ec9b689473e3
cwd: /home/user/project
Wave base URL: https://aigw.netease.com
Model: gemini-3-flash

Esc to cancel
```
