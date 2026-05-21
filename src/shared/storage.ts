// Per-key async write queue.
//
// chrome.storage.local has no transactions. A read-modify-write sequence run
// concurrently (e.g. two captures arriving in the same task tick, or the side
// panel and DevTools panel both saving a rule) can lose data: both load() the
// same snapshot, both write back their mutation, second write wins.
//
// withWriteLock serializes operations on a given key. Different keys run in
// parallel — only same-key writes block each other.

const queues = new Map<string, Promise<unknown>>();

export function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  // Run `fn` regardless of whether the prior task succeeded or threw; we don't
  // want a single failed write to poison the chain for that key forever.
  const next = prev.catch(() => {}).then(() => fn());
  // Store a swallowed-error version on the queue map so the next caller's
  // `prev.catch(() => {})` resolves cleanly even if `next` rejects.
  queues.set(key, next.catch(() => {}));
  return next;
}

// Test-only — reset the in-memory queue map. Not used in production code.
export function _resetWriteLocksForTesting(): void {
  queues.clear();
}
