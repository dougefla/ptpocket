<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref } from "vue";

import { api, ApiError, type QbTorrent } from "../api";
import BottomSheet from "../components/BottomSheet.vue";
import { formatEta, formatSize, formatSpeed, formatState, stateKind } from "../format";
import { toast } from "../toast";

const torrents = ref<QbTorrent[]>([]);
const loading = ref(true);
const error = ref("");
const filter = ref<"all" | "downloading" | "completed">("all");
const active = ref<QbTorrent | null>(null);
const acting = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;

async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    torrents.value = (await api.qbTorrents(filter.value)).torrents;
    error.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

// 只在本页可见时轮询，切走就停，省电
onActivated(() => {
  load();
  timer = setInterval(() => load(true), 3000);
});

onDeactivated(() => {
  if (timer) clearInterval(timer);
  timer = null;
});

async function act(action: "start" | "stop" | "delete" | "recheck", deleteFiles = false) {
  const t = active.value;
  if (!t || acting.value) return;
  acting.value = true;
  try {
    await api.qbAction(action, [t.hash], deleteFiles);
    active.value = null;
    await load(true);
  } catch (err) {
    toast(err instanceof ApiError ? err.message : "操作失败", "err");
  } finally {
    acting.value = false;
  }
}

function confirmDelete(withFiles: boolean) {
  if (!active.value) return;
  const msg = withFiles ? `删除任务并抹掉已下载的文件？\n\n${active.value.name}` : `仅从列表移除任务？\n\n${active.value.name}`;
  if (confirm(msg)) act("delete", withFiles);
}

const totals = computed(() => ({
  dl: torrents.value.reduce((s, t) => s + t.dlspeed, 0),
  up: torrents.value.reduce((s, t) => s + t.upspeed, 0),
}));

function setFilter(f: typeof filter.value) {
  filter.value = f;
  load();
}
</script>

<template>
  <div class="view">
    <header class="bar">
      <div class="row">
        <h1>下载任务</h1>
        <div class="speeds">
          <span class="dl">▼ {{ formatSpeed(totals.dl) }}</span>
          <span class="up">▲ {{ formatSpeed(totals.up) }}</span>
        </div>
      </div>
      <div class="chips">
        <button class="chip" :class="{ on: filter === 'all' }" @click="setFilter('all')">全部</button>
        <button class="chip" :class="{ on: filter === 'downloading' }" @click="setFilter('downloading')">下载中</button>
        <button class="chip" :class="{ on: filter === 'completed' }" @click="setFilter('completed')">已完成</button>
      </div>
    </header>

    <div class="scroll-area">
      <div v-if="loading && !torrents.length" class="empty"><div class="spinner mx" /></div>

      <div v-else-if="error" class="empty">
        <div class="empty-title">连不上 qBittorrent</div>
        <p>{{ error }}</p>
        <button class="btn retry" @click="load()">重试</button>
      </div>

      <div v-else-if="!torrents.length" class="empty">
        <div class="empty-title">还没有任务</div>
        <p>到搜索页找点东西推送过来</p>
      </div>

      <button v-for="t in torrents" v-else :key="t.hash" class="item" @click="active = t">
        <div class="name">{{ t.name }}</div>
        <div class="track"><div class="fill" :class="stateKind(t.state)" :style="{ width: `${t.progress * 100}%` }" /></div>
        <div class="meta">
          <span :class="`st-${stateKind(t.state)}`">{{ formatState(t.state) }}</span>
          <span>{{ (t.progress * 100).toFixed(1) }}%</span>
          <span>{{ formatSize(t.size) }}</span>
          <span v-if="t.dlspeed" class="dl">▼{{ formatSpeed(t.dlspeed) }}</span>
          <span v-if="t.upspeed" class="up">▲{{ formatSpeed(t.upspeed) }}</span>
          <span v-if="t.progress < 1 && t.dlspeed">剩 {{ formatEta(t.eta) }}</span>
        </div>
      </button>
    </div>

    <BottomSheet :open="!!active" title="任务操作" @close="active = null">
      <template v-if="active">
        <p class="sheet-name">{{ active.name }}</p>
        <div class="facts">
          <span>{{ formatState(active.state) }}</span>
          <span>{{ (active.progress * 100).toFixed(1) }}%</span>
          <span>{{ formatSize(active.size) }}</span>
          <span>分享率 {{ active.ratio.toFixed(2) }}</span>
          <span>▲{{ active.num_seeds }} ▼{{ active.num_leechs }}</span>
        </div>
        <p class="path">{{ active.save_path }}</p>

        <div class="grid">
          <button class="btn" :disabled="acting" @click="act('start')">继续</button>
          <button class="btn" :disabled="acting" @click="act('stop')">暂停</button>
          <button class="btn" :disabled="acting" @click="act('recheck')">校验</button>
          <button class="btn btn-danger" :disabled="acting" @click="confirmDelete(false)">移除任务</button>
        </div>
        <button class="btn btn-danger full" :disabled="acting" @click="confirmDelete(true)">删除任务和文件</button>
      </template>
    </BottomSheet>
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
  padding: calc(var(--safe-top) + 10px) 14px 8px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid var(--border);
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}

.speeds {
  display: flex;
  gap: 10px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.dl {
  color: var(--accent);
}

.up {
  color: var(--free);
}

.chips {
  display: flex;
  gap: 7px;
  margin-top: 9px;
}

.chip {
  padding: 5px 12px;
  border-radius: 15px;
  font-size: 12.5px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  border: 1px solid transparent;
}

.chip.on {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-color: var(--accent);
  color: var(--accent);
}

.item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 11px 14px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
}

.item:active {
  background: var(--bg-elev-2);
}

.name {
  font-size: 13.5px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.track {
  height: 3px;
  border-radius: 2px;
  background: var(--bg-elev-2);
  margin: 8px 0 6px;
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
  background: var(--accent);
}

.fill.done {
  background: var(--free);
}

.fill.paused {
  background: var(--text-faint);
}

.fill.error {
  background: var(--danger);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  font-size: 11.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.st-active {
  color: var(--accent);
}
.st-done {
  color: var(--free);
}
.st-error {
  color: var(--danger);
}

.mx {
  margin: 0 auto;
}

.retry {
  margin-top: 16px;
}

.sheet-name {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--text-faint);
}

.path {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--text-faint);
  word-break: break-all;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 18px;
}

.full {
  width: 100%;
  margin-top: 10px;
}
</style>
