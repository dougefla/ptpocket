import { ref } from "vue";

export interface Toast {
  id: number;
  message: string;
  kind: "ok" | "err";
}

export const toasts = ref<Toast[]>([]);
let seq = 0;

export function toast(message: string, kind: Toast["kind"] = "ok", ms = 2800): void {
  const id = ++seq;
  toasts.value.push({ id, message, kind });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
}
