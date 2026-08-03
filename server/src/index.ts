import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import { buildAdapters } from "./adapters/index.js";
import { loadConfig } from "./config.js";
import { ProwlarrClient } from "./prowlarr.js";
import { QbClient } from "./qbit.js";
import { registerRoutes } from "./routes.js";

const here = dirname(fileURLToPath(import.meta.url));

function resolveWebDist(configured: string): string | null {
  const candidates = configured
    ? [resolve(configured)]
    : [join(here, "../../web/dist"), join(here, "../web-dist"), "/app/web-dist"];
  return candidates.find((p) => existsSync(join(p, "index.html"))) ?? null;
}

async function main() {
  const config = loadConfig();

  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    // 种子文件体积有限，1MB body 上限足够，也顺手挡了滥用
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { global: false });

  const prowlarr = new ProwlarrClient(config.PROWLARR_URL, config.PROWLARR_API_KEY);
  const qb = new QbClient(config.QB_URL, config.QB_USERNAME, config.QB_PASSWORD);
  const adapters = buildAdapters(config);

  if (adapters.length) {
    app.log.info({ adapters: adapters.map((a) => a.name) }, "已启用原生站点适配器");
  }

  await registerRoutes(app, { config, prowlarr, qb, adapters });

  // 前端静态资源 + SPA 兜底
  const webDist = resolveWebDist(config.WEB_DIST);
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not Found" });
      return reply.sendFile("index.html");
    });
    app.log.info({ webDist }, "已挂载前端静态资源");
  } else {
    app.log.warn("未找到前端构建产物，仅提供 API（开发模式下由 vite dev server 提供页面）");
  }

  await app.listen({ host: config.HOST, port: config.PORT });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      app.log.info(`收到 ${sig}，正在关闭`);
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
