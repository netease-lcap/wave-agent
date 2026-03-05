Auto memory
Auto memory lets Wave accumulate knowledge across sessions without you writing anything. Wave saves notes for itself as it works: build commands, debugging insights, architecture notes, code style preferences, and workflow habits. Wave doesn’t save something every session. It decides what’s worth remembering based on whether the information would be useful in a future conversation.


Enable or disable auto memory
Auto memory is on by default. To toggle it, set autoMemoryEnabled in your settings.json:
{
  "autoMemoryEnabled": false
}


To disable auto memory via environment variable, set WAVE_DISABLE_AUTO_MEMORY=1.


Storage location
Each project gets its own memory directory at ~/.wave/projects/<project>/memory/. The <project> path is derived from the git repository, so all worktrees and subdirectories within the same repo share one auto memory directory. Outside a git repo, the project root is used instead.The directory contains a MEMORY.md entrypoint and optional topic files:
~/.wave/projects/<project>/memory/
├── MEMORY.md          # Concise index, loaded into every session
├── debugging.md       # Detailed notes on debugging patterns
├── api-conventions.md # API design decisions
└── ...                # Any other topic files Wave creates


MEMORY.md acts as an index of the memory directory. Wave reads and writes files in this directory throughout your session, using MEMORY.md to keep track of what’s stored where.Auto memory is machine-local. All worktrees and subdirectories within the same git repository share one auto memory directory. Files are not shared across machines or cloud environments.


How it works
The first 200 lines of MEMORY.md are loaded at the start of every conversation. Content beyond line 200 is not loaded at session start. Wave keeps MEMORY.md concise by moving detailed notes into separate topic files.This 200-line limit applies only to MEMORY.md. AGENTS.md files are loaded in full regardless of length, though shorter files produce better adherence.Topic files like debugging.md or patterns.md are not loaded at startup. Wave reads them on demand using its standard file tools when it needs the information.Wave reads and writes memory files during your session. 
