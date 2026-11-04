/**
 * CodeChat 的三个 SaaS 环境 —— 本技能四条产物线（桌面端 / 文档站 / 远控页 / 插件市场）
 * 共用这一张表。
 *
 * 为什么只有一份：打错环境**不会报错**（包会静默写进另一个环境），所以宁可让四条
 * 产物线读同一个常量，也不要各写各的、哪天只改了一边。
 *
 *   site    = 企业端域名（客户可见的那一本地址）：产物读路径全在这里 —— `/docs/`、
 *             `/wave-plugins-official/`、`/remote/`、`/api/downloads/*` 的 feed。
 *   publish = 发布接口宿主（`/api/publish/*`）。**2026-11-04 起写入口跟着读入口走**：
 *             CodeChat 两种部署（SaaS / 私有化）都把 `/api/publish/*` 挂在企业端，
 *             所以 publish 与 site 现在是**同一个域名**。运营端（neteasecc.*）不再挂
 *             这组接口（同路径 404），本表也不再写它。
 *
 * **私有化部署不在本表里**：客户的域名是外部拥有的、会变，路线是
 * `--base https://<客户企业端> --token <该环境令牌>`——没有 `--env` 预设。
 */
export const ENV_SITES = {
  prod: "https://codechat.codewave.163.com",
  test: "https://codechat.codewave-test.163yun.com",
  drill: "https://codechat.lcap.hadri.163yun.com",
};

/** 发布接口宿主：与访问面同域（见上）。保留独立名字，让四条产物线的意图读起来仍然清楚。 */
export const ENV_BASES = { ...ENV_SITES };

export const ENV_NAMES = Object.keys(ENV_SITES);

/** 自保：有人手改这张表把域名写成别的形状时立刻炸，而不是静默传到未知环境。 */
for (const name of ENV_NAMES) {
  const publish = ENV_BASES[name];
  const site = ENV_SITES[name];
  if (
    !publish?.startsWith("https://codechat.") ||
    !site?.startsWith("https://codechat.") ||
    publish !== site
  ) {
    throw new Error(`环境表被改坏了：${name} → ${publish} / ${site}`);
  }
}
