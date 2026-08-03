<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import { api, searchStream, type Indexer, type QbSummary, type Release } from "../api";
import PushSheet from "../components/PushSheet.vue";
import ResultCard from "../components/ResultCard.vue";
import { toast } from "../toast";

type Sort = "seeders" | "size" | "date";

const query = ref("");
const releases = ref<Release[]>([]);
const searching = ref(false);
const progress = ref({ done: 0, total: 0 });
const failedSites = ref<string[]>([]);
const hasSearched = ref(false);

const indexers = ref<Indexer[]>([]);
const categories = ref<Array<{ id: number; name: string }>>([]);
const summary = ref<QbSummary | null>(null);

const freeOnly = ref(false);
const noHr = ref(false);
const category = ref<number | null>(null);
const sort = ref<Sort>("seeders");
const selectedSites = ref<string[]>(loadSelectedSites());

const active = ref<Release | null>(null);
let cancel: (() => void) | null = null;

// v2 后缀：站点 id 从数字改成了字符串（"p:12" / "mteam"），旧值不能复用
const SITES_KEY = "ptpocket.sites.v2";

function loadSelectedSites(): string[] {
  try {
    const raw = localStorage.getItem(SITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

onMounted(async () => {
  try {
    const data = await api.indexers();
    indexers.value = data.indexers.filter((i) => i.enabled);
    categories.value = data.categories;
  } catch {
    /* 设置页会展示具体连接错误，这里静默 */
  }
  try {
    summary.value = await api.qbSummary();
  } catch {
    /* 推送时会再报错 */
  }
});

onUnmounted(() => cancel?.());

function run() {
  const q = query.value.trim();
  if (!q || searching.value) return;

  cancel?.();
  releases.value = [];
  failedSites.value = [];
  progress.value = { done: 0, total: 0 };
  searching.value = true;
  hasSearched.value = true;
  // 收起 iOS 键盘，把屏幕让给结果
  (document.activeElement as HTMLElement | null)?.blur();

  cancel = searchStream(
    { q, indexerIds: selectedSites.value.length ? selectedSites.value : undefined },
    {
      onStart: (list) => {
        progress.value = { done: 0, total: list.length };
      },
      onResults: (_id, _name, batch) => {
        releases.value = releases.value.concat(batch);
      },
      onIndexerError: (indexer) => {
        failedSites.value.push(indexer);
      },
      onProgress: (done, total) => {
        progress.value = { done, total };
      },
      onDone: () => {
        searching.value = false;
      },
      onFatal: (message) => {
        searching.value = false;
        toast(message, "err", 5000);
      },
    },
  );
}

function stop() {
  cancel?.();
  cancel = null;
  searching.value = false;
}

const visible = computed(() => {
  let list = releases.value;
  if (freeOnly.value) list = list.filter((r) => r.downloadFactor === 0);
  if (noHr.value) list = list.filter((r) => !r.hasHr);
  if (category.value !== null) list = list.filter((r) => r.topCategory === category.value);

  const sorted = [...list];
  if (sort.value === "seeders") sorted.sort((a, b) => b.seeders - a.seeders || b.size - a.size);
  else if (sort.value === "size") sorted.sort((a, b) => b.size - a.size);
  else sorted.sort((a, b) => a.ageHours - b.ageHours);
  return sorted;
});

const freeCount = computed(() => releases.value.filter((r) => r.downloadFactor === 0).length);
const hrCount = computed(() => releases.value.filter((r) => r.hasHr).length);

/** 只显示搜索命中过的分类，避免一排永远为空的筛选条 */
const liveCategories = computed(() => {
  const present = new Set(releases.value.map((r) => r.topCategory).filter((v): v is number => v !== null));
  return categories.value.filter((c) => present.has(c.id));
});

const siteLabel = computed(() =>
  selectedSites.value.length === 0 ? `全部 ${indexers.value.length} 站` : `${selectedSites.value.length} 个站`,
);

const sitePickerOpen = ref(false);

function toggleSite(id: string) {
  const set = new Set(selectedSites.value);
  set.has(id) ? set.delete(id) : set.add(id);
  selectedSites.value = [...set];
  localStorage.setItem(SITES_KEY, JSON.stringify(selectedSites.value));
}

function selectAllSites() {
  selectedSites.value = [];
  localStorage.setItem(SITES_KEY, "[]");
}
</script>

<template>
  <div class="view">
    <header class="bar">
      <form class="searchbox" @submit.prevent="run">
        <svg viewBox="0 0 24 24" width="17" height="17" class="ico" aria-hidden="true">
          <path
            d="M10 2a8 8 0 105.3 14l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z"
            fill="currentColor"
          />
        </svg>
        <input
          v-model="query"
          type="search"
          placeholder="搜索片名、剧名、关键词"
          enterkeyhint="search"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
        />
        <button v-if="searching" type="button" class="stop" @click="stop">停止</button>
      </form>

      <div class="chips">
        <button class="chip" :class="{ on: sitePickerOpen }" @click="sitePickerOpen = !sitePickerOpen">
          {{ siteLabel }}
        </button>
        <button class="chip" :class="{ on: freeOnly }" @click="freeOnly = !freeOnly">
          仅免费<span v-if="freeCount"> {{ freeCount }}</span>
        </button>
        <button v-if="hrCount" class="chip" :class="{ on: noHr }" @click="noHr = !noHr">排除 HR</button>
        <button
          v-for="c in liveCategories"
          :key="c.id"
          class="chip"
          :class="{ on: category === c.id }"
          @click="category = category === c.id ? null : c.id"
        >
          {{ c.name }}
        </button>
        <select v-model="sort" class="chip sortsel">
          <option value="seeders">按做种</option>
          <option value="size">按体积</option>
          <option value="date">按时间</option>
        </select>
      </div>

      <div v-if="sitePickerOpen" class="sites">
        <button class="site-item" :class="{ on: selectedSites.length === 0 }" @click="selectAllSites">
          全部站点
        </button>
        <button
          v-for="i in indexers"
          :key="i.id"
          class="site-item"
          :class="{ on: selectedSites.includes(i.id) }"
          @click="toggleSite(i.id)"
        >
          {{ i.name }}
        </button>
      </div>

      <div v-if="searching || failedSites.length" class="status">
        <template v-if="searching">
          <div class="spinner" />
          <span>正在搜索 {{ progress.done }}/{{ progress.total }} 个站点 · 已找到 {{ releases.length }} 条</span>
        </template>
        <span v-else-if="failedSites.length" class="failed">
          {{ failedSites.length }} 个站点搜索失败：{{ failedSites.join("、") }}
        </span>
      </div>
    </header>

    <div class="scroll-area">
      <div v-if="!hasSearched" class="empty">
        <div class="empty-title">聚合搜索</div>
        <p>结果按站点逐个返回，先到先显示</p>
      </div>

      <div v-else-if="!visible.length && !searching" class="empty">
        <div class="empty-title">没有匹配的结果</div>
        <p v-if="releases.length">共 {{ releases.length }} 条结果被当前筛选条件挡掉了</p>
        <p v-else>换个关键词，或到设置里确认站点连通性</p>
      </div>

      <template v-else>
        <div class="count">
          {{ visible.length }} 条结果<span v-if="visible.length !== releases.length"> / 共 {{ releases.length }}</span>
        </div>
        <ResultCard v-for="r in visible" :key="r.id" :release="r" @open="active = r" />
      </template>
    </div>

    <PushSheet :release="active" :summary="summary" @close="active = null" />
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
  padding: calc(var(--safe-top) + 10px) 12px 8px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid var(--border);
}

.searchbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 40px;
  background: var(--bg-elev-2);
  border-radius: 11px;
}

.searchbox .ico {
  color: var(--text-faint);
  flex: none;
}

.searchbox input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.searchbox input::-webkit-search-cancel-button {
  -webkit-appearance: none;
}

.stop {
  flex: none;
  font-size: 13px;
  color: var(--accent);
  padding: 4px 2px;
}

.chips {
  display: flex;
  gap: 7px;
  margin-top: 9px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex: none;
  padding: 5px 12px;
  border-radius: 15px;
  font-size: 12.5px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  border: 1px solid transparent;
  white-space: nowrap;
}

.chip.on {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-color: var(--accent);
  color: var(--accent);
}

.sortsel {
  -webkit-appearance: none;
  appearance: none;
  font-size: 12.5px;
  padding-right: 12px;
}

.sites {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 9px;
  max-height: 156px;
  overflow-y: auto;
  padding: 9px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 11px;
}

.site-item {
  padding: 5px 11px;
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  border: 1px solid transparent;
}

.site-item.on {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-color: var(--accent);
  color: var(--accent);
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  font-size: 12px;
  color: var(--text-faint);
}

.failed {
  color: var(--warn);
}

.count {
  padding: 9px 14px 6px;
  font-size: 12px;
  color: var(--text-faint);
}
</style>
