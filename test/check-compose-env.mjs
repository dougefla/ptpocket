#!/usr/bin/env node
/**
 * 校验 docker-compose.yml 的 environment 段覆盖了 config.ts 声明的全部变量。
 *
 * 为什么需要这个检查：compose 里是逐项显式映射（不用 env_file，因为 OMV 插件
 * 的环境文件叫 <栈名>.env，而可选 env_file 语法又要求 Compose >= 2.24）。
 * 显式映射的代价就是容易漏 —— 漏掉的变量不会报错，只会静默用默认值，
 * 于是「我明明配了却不生效」。这里把它变成硬性检查。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 容器内部自有默认值、不该由 compose 传入的 */
const INTERNAL = new Set(["HOST", "PORT", "WEB_DIST"]);

const config = readFileSync(join(root, "server/src/config.ts"), "utf8");
const declared = new Set(
  [...config.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]).filter((k) => !INTERNAL.has(k)),
);

const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
// 只看 ptpocket 服务的 environment 段
const svc = compose.split(/^ {2}(?=\w)/m).find((s) => s.startsWith("ptpocket:"));
if (!svc) {
  console.error("✗ 在 docker-compose.yml 里找不到 ptpocket 服务");
  process.exit(1);
}
const mapped = new Set([...svc.matchAll(/^ {6}- ([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

const missing = [...declared].filter((k) => !mapped.has(k)).sort();
const extra = [...mapped].filter((k) => !declared.has(k) && k !== "TZ").sort();

if (missing.length) {
  console.error(`✗ docker-compose.yml 的 ptpocket.environment 漏了 ${missing.length} 个变量：`);
  for (const k of missing) console.error(`    - ${k}`);
  console.error("  配了也不会生效，请补上。");
}
if (extra.length) {
  console.error(`✗ compose 里映射了 config.ts 不认识的变量：${extra.join(", ")}`);
}
if (missing.length || extra.length) process.exit(1);

console.log(`✓ compose 已覆盖 config.ts 的全部 ${declared.size} 个变量`);
