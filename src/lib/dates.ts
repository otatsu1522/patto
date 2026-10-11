const pad = (n: number) => String(n).padStart(2, '0');

export const formatDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const formatDateTime = (ts: number): string => `${formatDate(ts)} ${formatTime(ts)}`;

export const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const DAY_MS = 24 * 60 * 60 * 1000;
