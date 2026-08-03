<script setup lang="ts">
import { ref } from "vue";

import { api, ApiError } from "../api";

const emit = defineEmits<{ authed: [] }>();

const password = ref("");
const busy = ref(false);
const error = ref("");

async function submit() {
  if (busy.value || !password.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api.login(password.value);
    password.value = "";
    emit("authed");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "登录失败";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="wrap">
    <form class="card" @submit.prevent="submit">
      <div class="logo">PT</div>
      <h1>PT Pocket</h1>
      <p class="sub">聚合搜索 · 一键推送下载</p>

      <input
        v-model="password"
        class="field"
        type="password"
        placeholder="访问密码"
        autocomplete="current-password"
        enterkeyhint="go"
        :disabled="busy"
      />
      <p v-if="error" class="err">{{ error }}</p>

      <button class="btn btn-primary full" type="submit" :disabled="busy || !password">
        <span v-if="busy" class="spinner" />
        {{ busy ? "验证中" : "进入" }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  padding-top: calc(24px + var(--safe-top));
}

.card {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: center;
}

.logo {
  width: 62px;
  height: 62px;
  margin: 0 auto 4px;
  border-radius: 16px;
  background: linear-gradient(145deg, var(--accent), #7b3ff2);
  color: #fff;
  font-weight: 700;
  font-size: 23px;
  letter-spacing: 0.02em;
  display: grid;
  place-items: center;
}

h1 {
  font-size: 21px;
  margin: 0;
  font-weight: 600;
}

.sub {
  margin: -8px 0 10px;
  color: var(--text-faint);
  font-size: 13px;
}

.err {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}

.full {
  width: 100%;
}
</style>
