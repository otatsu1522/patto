import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { formatDate } from '@/lib/dates';
import { nowMs } from '@/lib/clock';

type Listener = () => void;

const listeners = new Set<Listener>();
let currentDateKey = formatDate(nowMs());
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let listeningForVisibility = false;

function readDateKey(): string {
  return formatDate(nowMs());
}

function notifyDateChange(): void {
  const nextDateKey = readDateKey();
  if (nextDateKey !== currentDateKey) {
    currentDateKey = nextDateKey;
    for (const listener of [...listeners]) listener();
  }
}

function scheduleNextMidnight(): void {
  if (midnightTimer !== null) clearTimeout(midnightTimer);
  midnightTimer = null;
  if (listeners.size === 0) return;

  const now = nowMs();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(0, 0, 0, 0);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  // 少し余裕を持たせ、タイマーが暦日の切り替わり前に発火するのを避ける。
  const delay = Math.max(1, nextMidnight.getTime() - now + 25);
  midnightTimer = setTimeout(() => {
    midnightTimer = null;
    notifyDateChange();
    scheduleNextMidnight();
  }, delay);
}

function refreshAfterResume(): void {
  notifyDateChange();
  scheduleNextMidnight();
}

function startMonitoring(): void {
  currentDateKey = readDateKey();
  scheduleNextMidnight();

  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined' && !listeningForVisibility) {
      document.addEventListener('visibilitychange', refreshAfterResume);
      listeningForVisibility = true;
    }
    return;
  }

  if (appStateSubscription === null) {
    appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAfterResume();
    });
  }
}

function stopMonitoring(): void {
  if (midnightTimer !== null) clearTimeout(midnightTimer);
  midnightTimer = null;

  appStateSubscription?.remove();
  appStateSubscription = null;

  if (listeningForVisibility && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', refreshAfterResume);
  }
  listeningForVisibility = false;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startMonitoring();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopMonitoring();
  };
}

function getSnapshot(): string {
  return currentDateKey;
}

/** ローカル暦日を共有し、日付境界で一度だけ購読コンポーネントを更新する。 */
export function useLocalDateKey(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
