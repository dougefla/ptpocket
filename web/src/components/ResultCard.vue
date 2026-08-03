<script setup lang="ts">
import { computed } from "vue";

import type { Release } from "../api";
import { formatAge, formatRemaining, formatSize } from "../format";

const props = defineProps<{ release: Release }>();
const emit = defineEmits<{ open: [] }>();

const remaining = computed(() => formatRemaining(props.release.discountEndTime));
</script>

<template>
  <button class="card" @click="emit('open')">
    <div class="title">{{ release.title }}</div>
    <!-- 国内站的中文副标题往往比英文主标题更有辨识度 -->
    <div v-if="release.subtitle" class="subtitle">{{ release.subtitle }}</div>

    <div class="meta">
      <span v-if="release.discountLabel" class="badge" :class="release.downloadFactor === 0 ? 'badge-free' : 'badge-discount'">
        {{ release.discountLabel === "FREE" ? "免费" : release.discountLabel }}
      </span>
      <span v-if="remaining" class="remain">{{ remaining }}</span>
      <span v-if="release.uploadFactor > 1" class="badge badge-up">{{ release.uploadFactor }}x</span>
      <span v-if="release.hasHr" class="badge badge-hr">HR</span>
      <span v-for="f in release.tags" :key="f" class="badge badge-plain">{{ f }}</span>

      <span class="site">{{ release.indexer }}</span>
      <span class="dot">·</span>
      <span class="size">{{ formatSize(release.size) }}</span>
      <span class="dot">·</span>
      <span class="peers">
        <span class="seed">▲{{ release.seeders }}</span>
        <span class="leech">▼{{ release.leechers }}</span>
      </span>
      <span class="dot">·</span>
      <span class="age">{{ formatAge(release.ageHours) }}</span>
    </div>
  </button>
</template>

<style scoped>
.card {
  display: block;
  width: 100%;
  text-align: left;
  padding: 11px 14px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}

.card:active {
  background: var(--bg-elev-2);
}

.title {
  font-size: 14px;
  line-height: 1.4;
  /* 国内站标题动辄一百多字，限死两行 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.subtitle {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.remain {
  color: var(--warn);
  font-variant-numeric: tabular-nums;
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-faint);
}

.site {
  color: var(--text-dim);
  font-weight: 500;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  opacity: 0.45;
}

.size {
  font-variant-numeric: tabular-nums;
}

.peers {
  display: inline-flex;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}

.seed {
  color: var(--free);
}

.leech {
  color: var(--text-faint);
}
</style>
