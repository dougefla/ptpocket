<script setup lang="ts">
import { onMounted, ref } from "vue";

import { api, authLost } from "./api";
import { toasts } from "./toast";
import DownloadsView from "./views/DownloadsView.vue";
import LoginView from "./views/LoginView.vue";
import SearchView from "./views/SearchView.vue";
import SettingsView from "./views/SettingsView.vue";

type Tab = "search" | "downloads" | "settings";

const authed = ref<boolean | null>(null);
const tab = ref<Tab>("search");

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "search", label: "搜索", icon: "M10 2a8 8 0 105.3 14l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z" },
  { key: "downloads", label: "任务", icon: "M12 3v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3h2zM4 19h16v2H4v-2z" },
  { key: "settings", label: "设置", icon: "M12 8a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4zm7.4 2c0-.5 0-.9-.1-1.3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 00-2.2-1.3L14.3 2H9.7l-.4 2.4c-.8.3-1.5.7-2.2 1.3l-2.4-1-2 3.4 2 1.6a8 8 0 000 2.6l-2 1.6 2 3.4 2.4-1c.7.6 1.4 1 2.2 1.3l.4 2.4h4.6l.4-2.4c.8-.3 1.5-.7 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.3z" },
];

onMounted(async () => {
  try {
    authed.value = (await api.me()).authenticated;
  } catch {
    authed.value = false;
  }
});

authLost.addEventListener("lost", () => {
  authed.value = false;
});
</script>

<template>
  <div v-if="authed === null" class="boot"><div class="spinner" /></div>

  <LoginView v-else-if="!authed" @authed="authed = true" />

  <template v-else>
    <main class="stage">
      <!-- keep-alive 保住搜索结果，切走再切回来不用重搜 -->
      <KeepAlive>
        <SearchView v-if="tab === 'search'" />
        <DownloadsView v-else-if="tab === 'downloads'" />
        <SettingsView v-else @logout="authed = false" />
      </KeepAlive>
    </main>

    <nav class="tabbar">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab"
        :class="{ on: tab === t.key }"
        :aria-current="tab === t.key ? 'page' : undefined"
        @click="tab = t.key"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path :d="t.icon" fill="currentColor" /></svg>
        <span>{{ t.label }}</span>
      </button>
    </nav>
  </template>

  <div class="toasts">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.message }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.boot {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  color: var(--text-faint);
}

.stage {
  min-height: 100dvh;
}

.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 1px solid var(--border);
  padding-bottom: var(--safe-bottom);
}

.tab {
  height: var(--tabbar-h);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  color: var(--text-faint);
  font-size: 10px;
  transition: color 0.15s;
}

.tab.on {
  color: var(--accent);
}

.tab:active {
  opacity: 0.55;
}

.toasts {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 12px);
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: none;
}

.toast {
  max-width: 100%;
  padding: 10px 16px;
  border-radius: 11px;
  font-size: 14px;
  color: #fff;
  background: #2a2f3a;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  word-break: break-word;
}

.toast.ok {
  background: #1f7a4d;
}

.toast.err {
  background: #a8283c;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
