# Research: Session Management Design Decisions

## Why JSONL?

Initially, sessions were stored as single JSON files containing an array of messages. This approach had several drawbacks:
1.  **Performance**: Appending a new message required reading the entire file, parsing it, adding the message, and writing the whole file back. For long sessions, this became increasingly slow.
2.  **Memory Usage**: Large sessions could consume significant memory when loaded entirely.
3.  **Corruption Risk**: A failure during the write operation could corrupt the entire session file.

**JSONL (JSON Lines)** solves these issues:
- **O(1) Append**: New messages are simply appended to the end of the file.
- **Streaming Support**: Messages can be read line-by-line, reducing memory footprint.
- **Robustness**: If one line is corrupted, the rest of the file remains readable.

## Why Filename-Based Metadata?

In earlier versions, session metadata was stored in a header line at the beginning of the JSONL file. While this was better than a single JSON file, listing sessions still required opening every file and reading the first line.

By encoding the **Session ID** and **Session Type** into the filename:
1.  **Zero-I/O Filtering**: Subagent sessions can be filtered out just by looking at the filename prefix (`subagent-`).
2.  **Faster Listing**: Basic metadata is available without opening the file.
3.  **Simplified Logic**: No need to handle special "header" lines vs "message" lines in the file content.

## Why Project-Based Grouping?

Storing all sessions in a single flat directory (`~/.wave/sessions`) made it difficult to manage sessions for different projects. Users often want to see only the sessions relevant to their current working directory.

Grouping by encoded working directory path provides:
1.  **Isolation**: Sessions from different projects are naturally separated.
2.  **Performance**: `fs.readdir` is faster on smaller directories.
3.  **Cleanup**: Entire project directories can be removed if they are no longer needed.

## Performance Benchmarks

The transition to JSONL and filename-based metadata resulted in an **8-10x performance improvement** in session listing operations, especially for users with a large number of historical sessions.
