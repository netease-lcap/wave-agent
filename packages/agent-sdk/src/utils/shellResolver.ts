import fs from "fs";

export const WINDOWS_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

export function resolveShellPath(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  if (process.env.GIT_BASH_PATH) {
    return process.env.GIT_BASH_PATH;
  }

  const paths = [
    ...WINDOWS_GIT_BASH_PATHS,
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
      : null,
  ].filter(Boolean) as string[];

  for (const path of paths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }

  return undefined;
}
