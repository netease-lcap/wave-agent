# Feature Specification: Image Pasting

**Feature Branch**: `015-image-pasting`  
**Created**: 2026-03-24  
**Input**: User description: "support pasting images from clipboard into the chat input. when an image is pasted, it should be saved to a temporary file and a placeholder should be inserted into the input text. when the message is sent, the image should be attached to the message."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Paste Image from Clipboard (Priority: P1)

As a user, I want to be able to paste an image from my clipboard into the chat input using `Ctrl+V`, so that I can easily share screenshots or images with the AI.

**Why this priority**: This is the core functionality of the feature. It allows users to provide visual context to the AI.

**Independent Test**: Can be tested by copying an image to the clipboard, pressing `Ctrl+V` in the chat input, and verifying that a placeholder like `[Image #1]` appears in the input text.

**Acceptance Scenarios**:

1. **Given** an image is in the clipboard, **When** the user presses `Ctrl+V` in the chat input, **Then** a temporary image file is created, and a placeholder `[Image #1]` is inserted at the cursor position.
2. **Given** multiple images are pasted, **When** the user presses `Ctrl+V` multiple times, **Then** each image gets a unique ID and placeholder (e.g., `[Image #1]`, `[Image #2]`).

---

### User Story 2 - Send Message with Attached Images (Priority: P1)

As a user, I want the images I've pasted to be sent along with my message when I press Enter, so that the AI can see and process them.

**Why this priority**: This ensures that the visual context is actually delivered to the AI.

**Independent Test**: Can be tested by pasting an image, typing a message, pressing Enter, and verifying that the message sent to the AI includes the image data.

**Acceptance Scenarios**:

1. **Given** a message with an image placeholder `[Image #1]`, **When** the user submits the message, **Then** the image file path and MIME type are included in the message payload sent to the AI service.
2. **Given** a message with multiple image placeholders, **When** the user submits the message, **Then** all referenced images are included in the message payload.

---

### User Story 3 - Cross-Platform Support (Priority: P2)

As a user, I want image pasting to work on macOS, Windows, and Linux, so that I have a consistent experience regardless of my operating system.

**Why this priority**: Ensures the feature is accessible to all users of the CLI tool.

**Acceptance Scenarios**:

1. **Given** the user is on macOS, **When** they paste an image, **Then** `osascript` is used to read the clipboard.
2. **Given** the user is on Windows, **When** they paste an image, **Then** PowerShell is used to read the clipboard.
3. **Given** the user is on Linux, **When** they paste an image, **Then** `xclip` is used to read the clipboard.

---

### Edge Cases

- **What happens if the clipboard does not contain an image?** The system should ignore the paste operation or handle it as a normal text paste if text is also present.
- **What happens if the temporary file cannot be created?** The system should log a warning and not insert a placeholder.
- **What happens if the user deletes the placeholder from the input text?** The image should still be in the `attachedImages` list but will not be sent if it's not referenced in the text (or it might be sent if the implementation sends all attached images). *Note: Current implementation only sends referenced images.*
- **What happens if the user pastes a very large image?** The system should handle it gracefully, though there might be limits imposed by the AI provider.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect `Ctrl+V` (or platform equivalent) in the chat input.
- **FR-002**: System MUST check if the clipboard contains image data.
- **FR-003**: System MUST support reading images from clipboard on macOS, Windows, and Linux.
- **FR-004**: System MUST save the clipboard image to a temporary file.
- **FR-005**: System MUST generate a unique ID for each pasted image.
- **FR-006**: System MUST insert a placeholder `[Image #<ID>]` into the input text at the cursor position.
- **FR-007**: System MUST maintain a list of attached images in the input state.
- **FR-008**: System MUST parse the input text for image placeholders upon submission.
- **FR-009**: System MUST include the file paths and MIME types of referenced images in the message sent to the AI.
- **FR-010**: System MUST clean up temporary image files after they are no longer needed (e.g., after sending or on exit).

### Key Entities *(include if feature involves data)*

- **AttachedImage**: Represents an image pasted into the input, containing an ID, temporary file path, and MIME type.
- **Image Placeholder**: A text string in the format `[Image #ID]` used to reference an attached image within the message text.
- **Clipboard Result**: The output of the clipboard reading operation, indicating success/failure and providing the image path.
