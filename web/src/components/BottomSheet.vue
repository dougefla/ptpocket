<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";

const props = defineProps<{ open: boolean; title?: string }>();
const emit = defineEmits<{ close: [] }>();

// 打开时锁住背后页面的滚动，否则 iOS 上会「穿透」滚动
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? "hidden" : "";
  },
);

onBeforeUnmount(() => {
  document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="backdrop" @click.self="emit('close')">
        <div class="sheet" role="dialog" aria-modal="true">
          <div class="grabber" />
          <header v-if="title" class="head">
            <h2>{{ title }}</h2>
            <button class="close" aria-label="关闭" @click="emit('close')">✕</button>
          </header>
          <div class="body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-end;
  z-index: 100;
}

.sheet {
  width: 100%;
  max-height: 88vh;
  background: var(--bg-elev);
  border-radius: 18px 18px 0 0;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding-bottom: var(--safe-bottom);
}

.grabber {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  margin: 8px auto 2px;
  flex: none;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 10px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.head h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  width: 30px;
  height: 30px;
  border-radius: 15px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 13px;
  flex: none;
}

.body {
  padding: 14px 16px 18px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}

.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.24s cubic-bezier(0.32, 0.72, 0, 1);
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
