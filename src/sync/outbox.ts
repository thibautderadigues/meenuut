/**
 * Éléments modifiés localement et pas encore envoyés au serveur.
 * Persistée dans localStorage (écriture synchrone) : une modification faite juste avant
 * la fermeture de l'onglet sera envoyée à la prochaine ouverture.
 */

export type SyncedTable = 'docs' | 'bodies' | 'folders';
export const SYNCED_TABLES: readonly string[] = ['docs', 'bodies', 'folders'];

const STORAGE_KEY = 'meenuut:outbox';

/** Clé "table:id" → version : un élément modifié pendant son envoi reste en attente. */
const pending = new Map<string, number>(load());
let version = 0;
const listeners = new Set<() => void>();

function load(): [string, number][] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]).map((key) => [key, 0]) : [];
  } catch {
    return [];
  }
}

function changed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...pending.keys()]));
  } catch {
    // Stockage indisponible : la file reste en mémoire pour cette session.
  }
  for (const listener of listeners) listener();
}

export const itemKey = (table: SyncedTable, id: string) => `${table}:${id}`;

export function parseKey(key: string): [SyncedTable, string] {
  const index = key.indexOf(':');
  return [key.slice(0, index) as SyncedTable, key.slice(index + 1)];
}

export function markPending(keys: string[]) {
  if (keys.length === 0) return;
  for (const key of keys) pending.set(key, ++version);
  changed();
}

export function pendingEntries(): [string, number][] {
  return [...pending];
}

export function isPending(key: string): boolean {
  return pending.has(key);
}

export function pendingCount(): number {
  return pending.size;
}

/** Retire les éléments envoyés, sauf ceux modifiés de nouveau entre-temps. */
export function settle(entries: [string, number][]) {
  for (const [key, sent] of entries) if (pending.get(key) === sent) pending.delete(key);
  changed();
}

export function clearPending() {
  pending.clear();
  changed();
}

export function onPendingChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
