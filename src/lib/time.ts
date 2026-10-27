/** mm:ss (or h:mm:ss) stamp for a second value. */
export function stamp(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export const pct = (value: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
