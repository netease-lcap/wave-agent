# Quickstart: Image Pasting

This document provides a quick guide to using the image pasting feature.

## How to Paste an Image

1.  **Copy an image** to your clipboard (e.g., using a screenshot tool or by right-clicking an image and selecting "Copy Image").
2.  **Open the chat input** in the CLI tool.
3.  **Press `Ctrl+V`** (or the platform equivalent) to paste the image.
4.  A placeholder like `[Image #1]` will appear in the input text at the cursor position.

## How to Send a Message with Images

1.  **Type your message** around the image placeholder.
2.  **Press Enter** to submit the message.
3.  The image(s) referenced by the placeholder(s) will be sent along with your message to the AI.

## Example

```text
Can you explain what's happening in this screenshot? [Image #1]
```

In this example, the AI will receive the text "Can you explain what's happening in this screenshot?" and the image referenced by `[Image #1]`.

## Troubleshooting

- **No image found in clipboard**: Ensure that you have actually copied an image, not just text or a file path.
- **`xclip` not installed (Linux)**: If you are on Linux, you may need to install `xclip` for clipboard image operations: `sudo apt-get install xclip`.
- **Image not appearing in chat**: Ensure that the placeholder `[Image #ID]` is present in the input text when you press Enter.
