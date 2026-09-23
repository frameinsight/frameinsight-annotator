/** Review time is relative to the first decoded source frame, not nominal FPS. */
export function reviewFrameAt(times: number[], seconds: number): number {
  let lo = 0,
    hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= seconds + 0.00001) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

export function reviewClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00.000";
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(3).padStart(6, "0")}`;
}
