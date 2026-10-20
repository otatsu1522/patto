/**
 * Tracks account-scoped work that must finish before the account is closed.
 * Backgrounding never cancels leased work; shutdown only prevents new work
 * from entering and waits for existing leases to be released.
 */
type AccountWorkState = {
  active: number;
  shuttingDown: boolean;
  waiters: Set<() => void>;
};

const states = new Map<string, AccountWorkState>();

function getState(ownerId: string): AccountWorkState {
  let state = states.get(ownerId);
  if (!state) {
    state = { active: 0, shuttingDown: false, waiters: new Set() };
    states.set(ownerId, state);
  }
  return state;
}

/** Acquire a lease for one account-scoped operation, or return null during logout. */
export function acquireAccountWork(ownerId: string): (() => void) | null {
  if (!ownerId) return null;
  const state = getState(ownerId);
  if (state.shuttingDown) return null;
  state.active += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    if (state.active !== 0) return;

    const waiters = [...state.waiters];
    state.waiters.clear();
    waiters.forEach((resolve) => resolve());

    if (!state.shuttingDown && state.waiters.size === 0) states.delete(ownerId);
  };
}

/** Prevent new account-scoped work and resolve once every acquired lease is released. */
export function beginAccountShutdown(ownerId: string): Promise<void> {
  if (!ownerId) return Promise.resolve();
  const state = getState(ownerId);
  state.shuttingDown = true;
  if (state.active === 0) return Promise.resolve();
  return new Promise<void>((resolve) => state.waiters.add(resolve));
}

/** Release the admission barrier after logout has completed or has safely failed. */
export function endAccountShutdown(ownerId: string): void {
  if (!ownerId) return;
  const state = states.get(ownerId);
  if (!state) return;
  state.shuttingDown = false;
  if (state.active === 0 && state.waiters.size === 0) states.delete(ownerId);
}

export function isAccountShutdownInProgress(ownerId: string): boolean {
  return !!ownerId && states.get(ownerId)?.shuttingDown === true;
}
