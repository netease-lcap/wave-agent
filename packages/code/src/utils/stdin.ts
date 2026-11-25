/** Minimal shape of a readable stdin; tests pass fakes instead of a pipe. */
interface StdinLike extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setEncoding(encoding: BufferEncoding): void;
}

/** How long a silent pipe is tolerated before we run without it. */
const STDIN_PEEK_MS = 3000;

/**
 * Resolve after `ms` unless the stream ends or delivers data first. Returns
 * true when nothing arrived in time — an inherited-but-idle parent pipe, which
 * would otherwise hang a print-mode run forever.
 */
function peekForStdinData(stream: StdinLike, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const done = (timedOut: boolean): void => {
      clearTimeout(timer);
      stream.off("end", onEnd);
      stream.off("data", onFirstData);
      resolve(timedOut);
    };
    const onEnd = (): void => done(false);
    const onFirstData = (): void => clearTimeout(timer);
    const timer = setTimeout(done, ms, true);
    stream.once("end", onEnd);
    stream.once("data", onFirstData);
  });
}

/**
 * Read a piped stdin, the way `claude -p` does: whatever the caller pipes in
 * becomes prompt text. Returns "" for a TTY (an interactive `wave -p 'msg'`
 * must not wait for input) and for a pipe that never delivers anything.
 */
export async function readPipedStdin(
  stream: StdinLike = process.stdin,
  timeoutMs = STDIN_PEEK_MS,
): Promise<string> {
  if (stream.isTTY) return "";
  stream.setEncoding("utf8");
  let data = "";
  const onData = (chunk: string): void => {
    data += chunk;
  };
  stream.on("data", onData);
  const timedOut = await peekForStdinData(stream, timeoutMs);
  stream.off("data", onData);
  if (timedOut) {
    process.stderr.write(
      `Warning: no stdin data in ${timeoutMs / 1000}s, proceeding without it. ` +
        "Pipe a prompt into `wave -p`, or redirect stdin from /dev/null to skip this wait.\n",
    );
  }
  return data;
}
