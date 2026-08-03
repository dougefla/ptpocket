<script setup lang="ts">
import { onMounted, ref } from "vue";

import { api, ApiError, type Indexer } from "../api";
import { formatSpeed } from "../format";
import { toast } from "../toast";

const emit = defineEmits<{ logout: [] }>();

interface Health {
  ok: boolean;
  prowlarr: { ok: boolean; indexers?: number; error?: string };
  qbittorrent: { ok: boolean; version?: string; error?: string };
  native: Array<{ id: string; name: string; ok: boolean; error?: string }>;
}

const health = ref<Health | null>(null);
const indexers = ref<Indexer[]>([]);
const qbSpeed = ref({ dlspeed: 0, upspeed: 0 });
const checking = ref(false);

const standalone = window.matchMedia("(display-mode: standalone)").matches;
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);

async function check() {
  checking.value = true;
  try {
    health.value = await api.health();
  } catch (err) {
    toast(err instanceof ApiError ? err.message : "检测失败", "err");
  } finally {
    checking.value = false;
  }

  try {
    const data = await api.indexers(true);
    indexers.value = data.indexers;
  } catch {
    indexers.value = [];
  }
  try {
    qbSpeed.value = (await api.qbSummary()).transfer;
  } catch {
    /* health 里已经报过了 */
  }
}

onMounted(check);

async function logout() {
  await api.logout().catch(() => undefined);
  emit("logout");
}
</script>

<template>
  <div class="view">
    <header class="bar"><h1>设置</h1></header>

    <div class="scroll-area">
      <section>
        <div class="sec-title">
          <span>连接状态</span>
          <button class="link" :disabled="checking" @click="check">{{ checking ? "检测中…" : "重新检测" }}</button>
        </div>

        <div class="card">
          <div class="line">
            <span class="dot" :class="health?.prowlarr.ok ? 'ok' : 'bad'" />
            <span class="k">Prowlarr</span>
            <span class="v">
              {{ health?.prowlarr.ok ? `${health.prowlarr.indexers} 个站点已启用` : (health?.prowlarr.error ?? "检测中…") }}
            </span>
          </div>
          <div class="line">
            <span class="dot" :class="health?.qbittorrent.ok ? 'ok' : 'bad'" />
            <span class="k">qBittorrent</span>
            <span class="v">
              {{ health?.qbittorrent.ok ? `v${health.qbittorrent.version}` : (health?.qbittorrent.error ?? "检测中…") }}
            </span>
          </div>
          <div v-for="n in health?.native ?? []" :key="n.id" class="line">
            <span class="dot" :class="n.ok ? 'ok' : 'bad'" />
            <span class="k">{{ n.name }}</span>
            <span class="v">{{ n.ok ? "令牌有效（原生接入）" : (n.error ?? "自检失败") }}</span>
          </div>
          <div v-if="health?.qbittorrent.ok" class="line">
            <span class="dot" />
            <span class="k">当前速度</span>
            <span class="v">▼ {{ formatSpeed(qbSpeed.dlspeed) }} · ▲ {{ formatSpeed(qbSpeed.upspeed) }}</span>
          </div>
        </div>
      </section>

      <section v-if="indexers.length">
        <div class="sec-title"><span>站点（{{ indexers.filter((i) => i.enabled).length }}/{{ indexers.length }} 已启用）</span></div>
        <div class="card">
          <div v-for="i in indexers" :key="i.id" class="line">
            <span class="dot" :class="i.enabled ? 'ok' : 'off'" />
            <span class="k grow">{{ i.name }}</span>
            <span v-if="i.native" class="badge badge-up">原生</span>
            <span class="v tag">{{ i.privacy === "private" ? "私有" : i.privacy }}</span>
          </div>
        </div>
        <p class="note">
          带「原生」标记的站点由本应用直接对接（M-Team 等 Prowlarr 不支持的 API 站），令牌配在 .env 里；
          其余站点的增删与 Cookie 都在 Prowlarr 里维护，这里只读展示。
        </p>
      </section>

      <section v-if="isIos && !standalone">
        <div class="sec-title"><span>装到主屏</span></div>
        <div class="card pad">
          <p class="tip">
            Safari 底部「分享」→「添加到主屏幕」。之后从主屏图标打开会全屏运行，没有地址栏，和原生 App 一样。
          </p>
        </div>
      </section>

      <section>
        <div class="card">
          <button class="row-btn danger" @click="logout">退出登录</button>
        </div>
        <p class="note">PT Pocket v0.1.0</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.view {
  min-height: 100dvh;
}

.bar {
  position: sticky;
  top: 0;
  z-index: 30;
  padding: calc(var(--safe-top) + 10px) 14px 10px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid var(--border);
}

h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}

section {
  margin: 18px 0;
}

.sec-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 16px 7px;
  font-size: 12px;
  color: var(--text-faint);
}

.link {
  font-size: 12px;
  color: var(--accent);
}

.card {
  background: var(--bg-elev);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.card.pad {
  padding: 12px 16px;
}

.line {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 16px;
  font-size: 13.5px;
  border-bottom: 1px solid var(--border);
}

.line:last-child {
  border-bottom: none;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
  flex: none;
}

.dot.ok {
  background: var(--free);
}

.dot.bad {
  background: var(--danger);
}

.dot.off {
  background: var(--border);
}

.k {
  color: var(--text);
  flex: none;
}

.k.grow {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 12.5px;
  text-align: right;
  word-break: break-word;
}

.v.tag {
  flex: none;
}

.note {
  padding: 8px 16px 0;
  margin: 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-faint);
}

.tip {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-dim);
}

.row-btn {
  width: 100%;
  padding: 13px 16px;
  text-align: center;
  font-size: 14.5px;
}

.row-btn.danger {
  color: var(--danger);
}
</style>
