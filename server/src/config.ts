import { z } from "zod";

const stripSlash = (u: string) => u.replace(/\/+$/, "");

const schema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),

  /** 用于签名会话 cookie。生成: openssl rand -hex 32 */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET 至少 32 字符，用 `openssl rand -hex 32` 生成"),
  /** 打开 App 时输入的密码（单用户） */
  APP_PASSWORD: z.string().min(6, "APP_PASSWORD 至少 6 位"),
  /** 会话有效期（天） */
  SESSION_DAYS: z.coerce.number().int().positive().default(30),

  PROWLARR_URL: z.string().url().transform(stripSlash),
  PROWLARR_API_KEY: z.string().min(8),

  /**
   * M-Team（馒头）原生适配器。Prowlarr / Jackett 上游都没有它的定义
   * （它是 JSON API 站，不是 NexusPHP 页面），所以单独对接。
   * 令牌在「控制台 → 实验室 → 存取令牌」生成。留空即不启用。
   */
  MTEAM_API_KEY: z.string().default(""),
  MTEAM_URL: z.string().url().transform(stripSlash).default("https://kp.m-team.cc"),
  /**
   * API 地址。留空则由 MTEAM_URL 自动推导（kp.m-team.cc → api.m-team.cc）。
   * 只有用镜像域名 / 反代 / 本地联调、API 不在 api.<主域> 上时才需要显式指定。
   */
  MTEAM_API_URL: z
    .union([z.literal(""), z.string().url().transform(stripSlash)])
    .default(""),
  /** normal=综合区，adult=成人区，all=两个都搜 */
  MTEAM_MODE: z.enum(["normal", "adult", "all"]).default("normal"),

  QB_URL: z.string().url().transform(stripSlash),
  QB_USERNAME: z.string().default(""),
  QB_PASSWORD: z.string().default(""),
  /**
   * 跳过 qBittorrent 的 TLS 证书校验。
   * 只在下载器是远程、且用自签证书时才需要开。开了就等于不验证中间人，
   * 能用正式证书（Let's Encrypt）或走 VPN/内网明文就别开。
   */
  QB_INSECURE_TLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** 推送时的默认值，前端可覆盖 */
  QB_DEFAULT_CATEGORY: z.string().default(""),
  QB_DEFAULT_TAGS: z.string().default(""),
  QB_DEFAULT_SAVEPATH: z.string().default(""),

  /** 单个 indexer 的搜索超时。国内站 + FlareSolverr 可能较慢 */
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  /** 单次搜索每个站返回条数上限 */
  SEARCH_LIMIT: z.coerce.number().int().positive().max(500).default(100),

  /** 反代后面部署时置 true，让 fastify 信任 X-Forwarded-* */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  /** 打包后的前端静态文件目录 */
  WEB_DIST: z.string().default(""),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    console.error("环境变量配置有误：\n" + lines.join("\n"));
    process.exit(1);
  }
  return parsed.data;
}
