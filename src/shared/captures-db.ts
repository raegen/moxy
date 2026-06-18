// IndexedDB-backed capture store.
//
// chrome.storage.{local,session} both cap at 10 MB shared across every key
// in the namespace. With multiple active tabs, that ceiling is structurally
// the wrong fit: a moderately chatty tab can fill the quota and starve all
// other tabs' captures. We moved to .session in v1.3.2 to escape the .local
// quota; that was the wrong target. Per-origin IndexedDB quota is browser-
// managed and runs in the hundreds of MB to GB range, scaled to available
// disk — exactly the shape captures need.
//
// Schema (v1):
//   db     "moxy"
//   store  "captures"     keyPath: "id"          (UUID, populated by patch.ts)
//   index  "tabId"        on cap.tabId           (fast per-tab filter)
//
// We deliberately do NOT index ts — sorting by ts is done in memory after
// getAll because IDB indexes don't support sort-by-non-key efficiently and
// the per-tab capture count is small enough (~hundreds) that an in-memory
// sort is faster than maintaining a compound index.
//
// Transactions auto-commit when the microtask queue drains, which means
// awaiting a non-IDB promise mid-tx will close the tx underneath us. The
// helpers below keep each tx to a single synchronous chain of IDB requests,
// then await `txDone()` once the work is queued.

import type { Capture } from './types';
import { createDebug } from './debug';

const DB_NAME = 'moxy';
const DB_VERSION = 1;
const STORE = 'captures';

const dbg = createDebug('captures-db');

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('tabId', 'tabId', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If the SW restarts under us and the connection becomes stale (very
      // rare but possible), drop the cached promise so the next call reopens.
      db.onclose = () => {
        dbg('db connection closed');
        dbPromise = null;
      };
      db.onversionchange = () => {
        dbg('db version change — closing connection');
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      dbg('openDb blocked — older version still has a connection');
    };
  });
  return dbPromise;
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('tx aborted'));
  });
}

// Insert one capture. If, after insert, the tab is over `capPerTab`, trim the
// oldest captures (by ts) for that tab. The cap is per-tab so a single noisy
// tab can't starve other tabs' captures — different from the session-storage
// FIFO across all tabs that we shipped in v1.3.4.
export async function addCapture(cap: Capture, capPerTab: number): Promise<void> {
  const db = await openDb();

  {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(cap);
    await txDone(t);
  }

  // Trim in a separate read-then-write pair. We can't combine them into one
  // tx because the in-memory sort between read and delete is a non-IDB await.
  const all = await listCapturesForTab(cap.tabId);
  if (all.length > capPerTab) {
    const toDelete = all.slice(0, all.length - capPerTab);
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const c of toDelete) store.delete(c.id);
    await txDone(t);
    dbg('trimmed', toDelete.length, 'oldest from tab', cap.tabId);
  }
}

export async function listCapturesForTab(tabId: number): Promise<Capture[]> {
  const db = await openDb();
  const t = db.transaction(STORE, 'readonly');
  const idx = t.objectStore(STORE).index('tabId');
  const rows = await reqPromise(idx.getAll(IDBKeyRange.only(tabId)));
  return rows.sort((a, b) => a.ts - b.ts);
}

export async function listAllCaptures(): Promise<Capture[]> {
  const db = await openDb();
  const t = db.transaction(STORE, 'readonly');
  const rows = await reqPromise(t.objectStore(STORE).getAll());
  return rows.sort((a, b) => a.ts - b.ts);
}

export async function clearCapturesForTab(tabId: number): Promise<void> {
  const db = await openDb();
  const t = db.transaction(STORE, 'readwrite');
  const store = t.objectStore(STORE);
  const idx = store.index('tabId');
  const keys = await reqPromise(idx.getAllKeys(IDBKeyRange.only(tabId)));
  for (const key of keys) store.delete(key);
  await txDone(t);
  if (keys.length > 0) dbg('cleared', keys.length, 'captures for tab', tabId);
}

export async function clearAllCaptures(): Promise<void> {
  const db = await openDb();
  const t = db.transaction(STORE, 'readwrite');
  t.objectStore(STORE).clear();
  await txDone(t);
  dbg('cleared all captures');
}
