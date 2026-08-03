<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { api, ApiError, type QbSummary, type Release } from "../api";
import { formatAge, formatEta, formatRemaining, formatSize } from "../format";
import { toast } from "../toast";
import BottomSheet from "./BottomSheet.vue";

const props = defineProps<{ release: Release | null; summary: QbSummary | null }>();
const emit = defineEmits<{ close: []; pushed: [] }>();

const category = ref("");
const tags = ref("");
const savepath = ref("");
const stopped = ref(false);
const advanced = ref(false);
const busy = ref(false);

const remaining = computed(() => formatRemaining(props.release?.discountEndTime ?? null));

const hrText = computed(() => {
  const r = props.release;
  if (!r) return "";
  const parts: string[] = [];
  if (r.minimumSeedTime) parts.push(`需做种 ${formatEta(r.minimumSeedTime)}`);
  if (r.minimumRatio) parts.push(`分享率需达 ${r.minimumRatio}`);
  return parts.length ? parts.join(" · ") : "该站对此种子有 H&R 要求";
});

// 每次换种子都把表单重置回默认值，避免上一次的设置意外沿用
watch(
  () => props.release,
  (r) => {
    if (!r) return;
    category.value = props.summary?.defaults.category ?? "";
    tags.value = props.summary?.defaults.tags ?? "";
    savepath.value = props.summary?.defaults.savepath ?? "";
    stopped.value = false;
    advanced.value = false;
  },
);

async function push() {
  const r = props.release;
  if (!r || busy.value) return;

  // 原生适配器（如 M-Team）的下载地址带时效，由后端凭 siteId 现取，这里没有 URL 是正常的
  if (!r.downloadUrl && !r.magnetUrl && !r.siteId) {
    toast("该结果没有可用的下载链接", "err");
    return;
  }

  busy.value = true;
  try {
    await api.download({
      source: r.source,
      siteId: r.siteId,
      downloadUrl: r.downloadUrl,
      magnetUrl: r.magnetUrl,
      title: r.title,
      category: category.value,
      tags: tags.value,
      savepath: savepath.value,
      stopped: stopped.value,
    });
    toast("已推送到 qBittorrent");
    emit("pushed");
    emit("close");
  } catch (err) {
    toast(err instanceof ApiError ? err.message : "推送失败", "err", 5000);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BottomSheet :open="!!release" title="推送到 qBittorrent" @close="emit('close')">
    <template v-if="release">
      <p class="name">{{ release.title }}</p>
      <p v-if="release.subtitle" class="sub">{{ release.subtitle }}</p>

      <div class="facts">
        <span v-if="release.discountLabel" class="badge" :class="release.downloadFactor === 0 ? 'badge-free' : 'badge-discount'">
          {{ release.discountLabel === "FREE" ? "免费" : release.discountLabel }}
        </span>
        <span v-if="release.uploadFactor > 1" class="badge badge-up">{{ release.uploadFactor }}x 上传</span>
        <span v-if="remaining" class="remain">{{ remaining }}</span>
        <span>{{ release.indexer }}</span>
        <span>{{ formatSize(release.size) }}</span>
        <span>▲{{ release.seeders }} ▼{{ release.leechers }}</span>
        <span>{{ formatAge(release.ageHours) }}</span>
      </div>

      <div v-if="release.hasHr" class="hr">
        <span class="badge badge-hr">HR</span>
        <span>{{ hrText }}</span>
      </div>

      <label class="lbl">分类</label>
      <select v-model="category" class="field">
        <option value="">（不设分类）</option>
        <option v-for="c in summary?.categories ?? []" :key="c" :value="c">{{ c }}</option>
      </select>

      <button class="toggle" @click="advanced = !advanced">
        {{ advanced ? "▾" : "▸" }} 更多选项
      </button>

      <template v-if="advanced">
        <label class="lbl">标签（逗号分隔）</label>
        <input v-model="tags" class="field" placeholder="例如 pt,movie" autocapitalize="off" />

        <label class="lbl">保存路径</label>
        <input
          v-model="savepath"
          class="field"
          :placeholder="summary?.defaultSavePath || '使用 qBittorrent 默认'"
          autocapitalize="off"
        />

        <label class="check">
          <input v-model="stopped" type="checkbox" />
          <span>添加后暂停</span>
        </label>
      </template>

      <div class="actions">
        <a v-if="release.infoUrl" class="btn" :href="release.infoUrl" target="_blank" rel="noopener">站点详情</a>
        <button class="btn btn-primary grow" :disabled="busy" @click="push">
          <span v-if="busy" class="spinner" />
          {{ busy ? "推送中" : "开始下载" }}
        </button>
      </div>

      <p class="hint">
        优惠是搜索那一刻的快照，不含倒计时。临期的免费种建议先点「站点详情」核对。
      </p>
    </template>
  </BottomSheet>
</template>

<style scoped>
.name {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}

.sub {
  margin: -6px 0 10px;
  font-size: 12.5px;
  color: var(--text-dim);
  word-break: break-word;
}

.remain {
  color: var(--warn);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--text-faint);
  padding-bottom: 14px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.hr {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 11px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  font-size: 12.5px;
  color: var(--text-dim);
}

.lbl {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin: 12px 0 6px;
}

.toggle {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-dim);
  padding: 4px 0;
}

.check {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 14px;
  font-size: 14px;
}

.check input {
  width: 20px;
  height: 20px;
  accent-color: var(--accent);
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.grow {
  flex: 1;
}

.hint {
  margin: 12px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-faint);
}
</style>
