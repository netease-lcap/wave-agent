import { SessionManager } from "../../src/services/sessionManager";

/**
 * 清理指定workdir的session文件
 * 应该在测试的 afterAll 钩子中调用
 */
export async function cleanupSessionsByWorkdir(
  workdir: string,
): Promise<number> {
  try {
    const deletedCount = await SessionManager.cleanupSessionsByWorkdir(workdir);
    return deletedCount;
  } catch (error) {
    console.warn(`Failed to cleanup sessions for workdir ${workdir}:`, error);
    return 0;
  }
}
