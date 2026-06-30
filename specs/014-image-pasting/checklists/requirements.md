# Checklist: Image Pasting Requirements

This document provides a checklist for the image pasting feature.

## Functional Requirements

- [x] **FR-001**: System MUST detect `Ctrl+V` (or platform equivalent) in the chat input.
- [x] **FR-002**: System MUST check if the clipboard contains image data.
- [x] **FR-003**: System MUST support reading images from clipboard on macOS, Windows, and Linux.
- [x] **FR-004**: System MUST save the clipboard image to a temporary file.
- [x] **FR-005**: System MUST generate a unique ID for each pasted image.
- [x] **FR-006**: System MUST insert a placeholder `[Image #<ID>]` into the input text at the cursor position.
- [x] **FR-007**: System MUST maintain a list of attached images in the input state.
- [x] **FR-008**: System MUST parse the input text for image placeholders upon submission.
- [x] **FR-009**: System MUST include the file paths and MIME types of referenced images in the message sent to the AI.
- [x] **FR-010**: System MUST clean up temporary image files after they are no longer needed (e.g., after sending or on exit).

## User Scenarios

- [x] **User Story 1**: Paste Image from Clipboard (Priority: P1)
- [x] **User Story 2**: Send Message with Attached Images (Priority: P1)
- [x] **User Story 3**: Cross-Platform Support (Priority: P2)

## Edge Cases

- [x] **What happens if the clipboard does not contain an image?**
- [x] **What happens if the temporary file cannot be created?**
- [x] **What happens if the user deletes the placeholder from the input text?**
- [x] **What happens if the user pastes a very large image?**
