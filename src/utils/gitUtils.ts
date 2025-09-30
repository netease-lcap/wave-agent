import { spawn } from "child_process";
import { limitGitDiff } from "./diffUtils";

/**
 * 获取 git diff (包括未跟踪的文件)
 * @returns Promise<string> git diff 输出
 */
export const getGitDiff = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    // 使用 git add -N . 将未跟踪文件添加到索引（不添加内容），然后用 git diff HEAD 可以看到所有变更
    const child = spawn("sh", ["-c", "git add -N . && git diff HEAD"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    let output = "";
    let error = "";

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      error += data.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        // 使用新的 utils 函数限制 diff 内容
        const limitedOutput = limitGitDiff(output, 1000);
        resolve(limitedOutput);
      } else {
        reject(new Error(error || "Git diff failed"));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
};
