/**
 * CodeChat 的三个 SaaS 环境 —— 本技能四条产物线（桌面端 / 文档站 / 远控页 / 插件市场）
 * 共用这一张表。
 *
 * 为什么只有一份：打错环境**不会报错**（包会静默写进另一个环境），所以宁可让四条
 * 产物线读同一个常量，也不要各写各的、哪天只改了一边。
 *
 *   publish = 发布接口的宿主（`/api/publish/*` 挂在这里）。SaaS 下是 ops 域名
 *             （neteasecc.*）—— 客户可见的企业端域名上不开写通道，同路径在那边 404。
 *   site    = 访问面（企业端 codechat.*，对象落地即可见，只用于冒烟/回滚账探测）。
 *
 * **私有化部署不在本表里**：那里没有运营端，`/api/publish/*` 由客户的**企业端**承载，
 * 域名是客户自己的，路线是 `--base https://<客户企业端> --token <该环境令牌>`——
 * 没有 `--env` 预设，也不该往这张表里加客户域名（它们是外部拥有的、会变）。
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
  const publish = ENV_BASES[name];
  const site = ENV_SITES[name];
  if (
    !publish.startsWith("https://neteasecc.") ||
    !site.startsWith("https://codechat.")
  ) {
    throw new Error(`环境表被改坏了：${name} → ${publish} / ${site}`);
  }
}
