/**
 * 远征检查间隔的边界与默认值（单位：分钟）。
 *
 * 远征最短只需要几十秒就能跑完一轮，最长可以挂机一整天，
 * 因此这里允许 0.5 分钟（30 秒）的粒度，上限放宽到 1440 分钟（24 小时）。
 */
export const MIN_EXPEDITION_INTERVAL_MINUTES = 0.5;
export const MAX_EXPEDITION_INTERVAL_MINUTES = 1440;
export const DEFAULT_EXPEDITION_INTERVAL_MINUTES = 15;

/** 把远征检查间隔（分钟）限制在允许范围内；非法值回退到默认值。 */
export function normalizeExpeditionInterval(minutes: number): number {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_EXPEDITION_INTERVAL_MINUTES;
  }
  return Math.min(
    MAX_EXPEDITION_INTERVAL_MINUTES,
    Math.max(MIN_EXPEDITION_INTERVAL_MINUTES, value),
  );
}

/** 远征倒计时文本；不足 1 小时为 MM:SS，达到 1 小时为 H:MM:SS。 */
export function formatExpeditionCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minuteText = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const secondText = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minuteText}:${secondText}`;
}
