const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${UNITS[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return "—";
  return `${formatSize(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  // qBittorrent 用 8640000 表示「无限」
  if (!seconds || seconds >= 8_640_000) return "∞";
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}小时${Math.round((seconds % 3600) / 60)}分`;
  return `${Math.round(seconds / 86_400)}天`;
}

export function formatAge(hours: number): string {
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${Math.floor(hours)}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  if (days < 365) return `${Math.floor(days / 30)}个月前`;
  return `${Math.floor(days / 365)}年前`;
}

/** 优惠剩余时间。已过期或无数据返回 null。 */
export function formatRemaining(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const h = ms / 3_600_000;
  if (h < 1) return `剩 ${Math.max(1, Math.round(ms / 60_000))} 分钟`;
  if (h < 48) return `剩 ${Math.floor(h)} 小时`;
  return `剩 ${Math.floor(h / 24)} 天`;
}

const STATE_LABELS: Record<string, string> = {
  downloading: "下载中",
  stalledDL: "无源",
  metaDL: "取元数据",
  forcedDL: "强制下载",
  queuedDL: "排队中",
  allocating: "分配空间",
  uploading: "做种中",
  stalledUP: "做种中",
  forcedUP: "强制做种",
  queuedUP: "排队做种",
  pausedDL: "已暂停",
  stoppedDL: "已暂停",
  pausedUP: "已完成",
  stoppedUP: "已完成",
  checkingDL: "校验中",
  checkingUP: "校验中",
  checkingResumeData: "校验中",
  moving: "移动中",
  error: "出错",
  missingFiles: "文件丢失",
  unknown: "未知",
};

export function formatState(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export function stateKind(state: string): "active" | "done" | "paused" | "error" {
  if (state === "error" || state === "missingFiles") return "error";
  if (state.startsWith("paused") || state.startsWith("stopped")) {
    return state.endsWith("UP") ? "done" : "paused";
  }
  if (state.endsWith("UP")) return "done";
  return "active";
}
