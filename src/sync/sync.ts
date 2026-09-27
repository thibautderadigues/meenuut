import { useSyncExternalStore } from 'react';
import { db, remoteTransactions } from '../db/db';
import {
  clearPending,
  isPending,
  itemKey,
  markPending,
  onPendingChange,
  parseKey,
  pendingCount,
  pendingEntries,
  settle,
  SYNCED_TABLES,
  type SyncedTable,
} from './outbox';
import { supabase } from './supabase';

/**
 * Synchronisation avec Supabase. IndexedDB reste la copie de travail (l'app reste
 * instantanée et fonctionne hors ligne) ; chaque modification locale est envoyée en
 * arrière-plan, et les modifications des autres appareils sont récupérées régulièrement.
 * En cas de conflit, la modification locale pas encore envoyée l'emporte.
 */

interface ItemRow {
  kind: SyncedTable;
  id: string;
  data: unknown;
  deleted: boolean;
  updated_at: string;
}

const OWNER_KEY = 'meenuut:owner';
const CURSOR_KEY = 'meenuut:cursor';
const PUSH_DELAY_MS = 800;
const PULL_INTERVAL_MS = 30_000;
const RETRY_DELAY_MS = 10_000;
const PAGE_SIZE = 1000;
/** Les corps peuvent contenir des images : envois par petits lots. */
const PUSH_BATCH = 20;
/** Une écriture validée juste avant la précédente lecture pourrait porter un horodatage antérieur. */
const CURSOR_OVERLAP_MS = 10_000;

const tables = () => [db.docs, db.bodies, db.folders];

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Sans stockage, tout sera simplement retéléchargé à la prochaine ouverture.
  }
}

/**
 * À la connexion, avant le premier rendu :
 * - données d'un autre compte sur ce navigateur → effacées ;
 * - données créées avant la connexion (aucun propriétaire) → rattachées au compte et envoyées.
 */
export async function prepareLocalData(userId: string) {
  const owner = readStorage(OWNER_KEY);
  if (owner === userId) return;

  if (owner) {
    await db.transaction('rw', tables(), async (tx) => {
      remoteTransactions.add(tx.idbtrans);
      await Promise.all(tables().map((table) => table.clear()));
    });
    clearPending();
    writeStorage(CURSOR_KEY, null);
  } else {
    const [docs, bodies, folders] = await Promise.all([
      db.docs.toCollection().primaryKeys(),
      db.bodies.toCollection().primaryKeys(),
      db.folders.toCollection().primaryKeys(),
    ]);
    markPending([
      ...docs.map((id) => itemKey('docs', id)),
      ...bodies.map((id) => itemKey('bodies', id)),
      ...folders.map((id) => itemKey('folders', id)),
    ]);
  }
  writeStorage(OWNER_KEY, userId);
}

async function push(userId: string) {
  const entries = pendingEntries();
  for (let start = 0; start < entries.length; start += PUSH_BATCH) {
    const batch = entries.slice(start, start + PUSH_BATCH);
    const rows = await Promise.all(
      batch.map(async ([key]) => {
        const [kind, id] = parseKey(key);
        const data = (await db.table(kind).get(id)) ?? null;
        return { user_id: userId, kind, id, data, deleted: data === null };
      }),
    );
    const { error } = await supabase.from('items').upsert(rows);
    if (error) throw error;
    settle(batch);
  }
}

async function apply(rows: ItemRow[]) {
  await db.transaction('rw', tables(), async (tx) => {
    remoteTransactions.add(tx.idbtrans);
    for (const row of rows) {
      // Modification locale en attente d'envoi : elle l'emporte.
      if (!SYNCED_TABLES.includes(row.kind) || isPending(itemKey(row.kind, row.id))) continue;
      const table = db.table(row.kind);
      if (row.deleted || row.data === null) await table.delete(row.id);
      else await table.put(row.data);
    }
  });
}

async function pull() {
  const cursor = readStorage(CURSOR_KEY);
  const since = cursor ? new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
  let latest = cursor;
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('items')
      .select('kind, id, data, deleted, updated_at')
      .order('updated_at')
      .range(from, from + PAGE_SIZE - 1);
    if (since) query = query.gt('updated_at', since);
    const { data, error } = await query.returns<ItemRow[]>();
    if (error) throw error;
    await apply(data);
    const last = data.at(-1);
    if (last) latest = last.updated_at;
    if (data.length < PAGE_SIZE) break;
  }
  writeStorage(CURSOR_KEY, latest);
}

// --- État affiché dans l'interface ---

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'error';

let failed = false;
let status: SyncStatus = 'synced';
const statusListeners = new Set<() => void>();

function updateStatus() {
  const next: SyncStatus = failed
    ? navigator.onLine
      ? 'error'
      : 'offline'
    : pendingCount() > 0
      ? 'pending'
      : 'synced';
  if (next === status) return;
  status = next;
  for (const listener of statusListeners) listener();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => status,
  );
}

// --- Boucle de synchronisation ---

let currentUser: string | null = null;
let running: Promise<void> | null = null;
let rerun = false;
let retryTimer: number | undefined;

/** Envoie puis récupère. Un seul cycle à la fois ; un appel pendant un cycle en relance un. */
export function syncNow(): Promise<void> {
  const userId = currentUser;
  if (!userId) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  window.clearTimeout(retryTimer);
  running = (async () => {
    try {
      do {
        rerun = false;
        await push(userId);
        await pull();
      } while (rerun && currentUser === userId);
      failed = false;
    } catch (error) {
      console.error('Synchronisation échouée', error);
      failed = true;
      retryTimer = window.setTimeout(() => void syncNow(), RETRY_DELAY_MS);
    } finally {
      running = null;
      updateStatus();
    }
  })();
  return running;
}

/** Lance la synchronisation en arrière-plan pour `userId` ; renvoie la fonction d'arrêt. */
export function startSync(userId: string): () => void {
  currentUser = userId;
  let pushTimer: number | undefined;

  const offPending = onPendingChange(() => {
    updateStatus();
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => void syncNow(), PUSH_DELAY_MS);
  });
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  const onOnline = () => void syncNow();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', updateStatus);
  const interval = window.setInterval(() => void syncNow(), PULL_INTERVAL_MS);

  updateStatus();
  return () => {
    currentUser = null;
    offPending();
    window.clearTimeout(pushTimer);
    window.clearTimeout(retryTimer);
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', updateStatus);
  };
}
