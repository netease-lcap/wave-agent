/**
 * CodeChat 运营平台的三个环境 —— 本技能两条上传线（下载管理的桌面端/文档包、远控页对象）
 * 共用这一张表。
 *
 * 为什么只有一份：打错环境**不会报错**（包会静默写进另一个环境），所以宁可让两条
 * 产物线读同一个常量，也不要各写各的、哪天只改了一边。
 *
 *   ops  = 上传面（neteasecc.*，登录 + 上传接口都在这里）
 *   site = 访问面（企业端 codechat.*，对象落地即可见，只用于冒烟/回滚账探测）
 */
export const ENV_BASES = {
  prod: "https://neteasecc.codewave.163.com",
  test: "https://neteasecc.codewave-test.163yun.com",
  drill: "https://neteasecc.lcap.hadri.163yun.com",
};

export const ENV_SITES = {
  prod: "https://codechat.codewave.163.com",
  test: "https://codechat.codewave-test.163yun.com",
  drill: "https://codechat.lcap.hadri.163yun.com",
};

export const ENV_NAMES = Object.keys(ENV_BASES);

/** 自保：有人手改这张表把域名写成别的形状时立刻炸，而不是静默传到未知环境。 */
for (const name of ENV_NAMES) {
  const ops = ENV_BASES[name];
  const site = ENV_SITES[name];
  if (
    !ops.startsWith("https://neteasecc.") ||
    !site.startsWith("https://codechat.")
  ) {
    throw new Error(`环境表被改坏了：${name} → ${ops} / ${site}`);
  }
}
