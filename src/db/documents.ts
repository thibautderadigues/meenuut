import type { JSONContent } from '@tiptap/react';
import { normalizeForSearch } from '../lib/format';
import { db, type DocBody, type DocMeta } from './db';

export interface OpenedDocument {
  meta: DocMeta;
  content: JSONContent;
}

/** Ce qu'il faut pour annuler une suppression. */
export interface DocumentSnapshot {
  meta: DocMeta;
  body: DocBody | undefined;
}

export interface SearchResult {
  meta: DocMeta;
  /** Extrait du texte autour de la correspondance, si elle n'est pas dans le titre. */
  snippet: { before: string; match: string; after: string } | null;
}

const EMPTY_CONTENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export function isEmptyContent(content: JSONContent): boolean {
  const blocks = content.content ?? [];
  return blocks.length === 0 || (blocks.length === 1 && !blocks[0]?.content?.length);
}

async function insertDocument(
  folderId: string | null = null,
  initial?: { title: string; content: JSONContent; text: string; icon?: string },
): Promise<DocMeta> {
  const now = Date.now();
  const meta: DocMeta = {
    id: crypto.randomUUID(),
    title: initial?.title ?? '',
    icon: initial?.icon ?? null,
    folderId,
    pinnedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.docs.add(meta);
  await db.bodies.add({
    id: meta.id,
    content: initial?.content ?? EMPTY_CONTENT,
    text: initial?.text ?? '',
  });
  return meta;
}

export function listDocuments(): Promise<DocMeta[]> {
  return db.docs.orderBy('updatedAt').reverse().toArray();
}

export function createDocument(folderId: string | null = null): Promise<string> {
  return db.transaction('rw', db.docs, db.bodies, async () => (await insertDocument(folderId)).id);
}

/** Document créé avec un contenu initial (document d'exemple). */
export function createDocumentWith(initial: {
  title: string;
  content: JSONContent;
  text: string;
  icon?: string;
}): Promise<string> {
  return db.transaction('rw', db.docs, db.bodies, async () => (await insertDocument(null, initial)).id);
}

export function openDocument(id: string): Promise<OpenedDocument | null> {
  return db.transaction('r', db.docs, db.bodies, async () => {
    const meta = await db.docs.get(id);
    if (!meta) return null;
    const body = await db.bodies.get(id);
    return { meta, content: body?.content ?? EMPTY_CONTENT };
  });
}

/**
 * Id du dernier document modifié, créé s'il n'y en a aucun.
 * La transaction rw sérialise les appels concurrents (StrictMode) : un seul document créé.
 */
export function latestDocumentId(): Promise<string> {
  return db.transaction('rw', db.docs, db.bodies, async () => {
    const meta = (await db.docs.orderBy('updatedAt').last()) ?? (await insertDocument());
    return meta.id;
  });
}

export async function renameDocument(id: string, title: string): Promise<void> {
  await db.docs.update(id, { title, updatedAt: Date.now() });
}

/** Déplacer n'est pas modifier : updatedAt reste inchangé. */
export async function moveDocument(id: string, folderId: string | null): Promise<void> {
  await db.docs.update(id, { folderId });
}

export async function setDocumentIcon(id: string, icon: string | null): Promise<void> {
  await db.docs.update(id, { icon });
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  await db.docs.update(id, { pinnedAt: pinned ? Date.now() : null });
}

export function saveBody(id: string, content: JSONContent, text: string): Promise<void> {
  return db.transaction('rw', db.docs, db.bodies, async () => {
    // 0 si le document a été supprimé entre-temps : on ne recrée pas un corps orphelin.
    const updated = await db.docs.update(id, { updatedAt: Date.now() });
    if (updated) await db.bodies.put({ id, content, text });
  });
}

export function deleteDocument(id: string): Promise<DocumentSnapshot | null> {
  return db.transaction('rw', db.docs, db.bodies, async () => {
    const meta = await db.docs.get(id);
    if (!meta) return null;
    const body = await db.bodies.get(id);
    await db.docs.delete(id);
    await db.bodies.delete(id);
    return { meta, body };
  });
}

export function restoreDocument({ meta, body }: DocumentSnapshot): Promise<void> {
  return db.transaction('rw', db.docs, db.bodies, async () => {
    await db.docs.put(meta);
    if (body) await db.bodies.put(body);
  });
}

const SNIPPET_BEFORE = 28;
const SNIPPET_AFTER = 80;

function makeSnippet(text: string, index: number, length: number): SearchResult['snippet'] {
  const start = Math.max(0, index - SNIPPET_BEFORE);
  let before = text.slice(start, index);
  // Commence sur un mot entier.
  if (start > 0) before = '…' + before.replace(/^\S*\s/, '');
  return {
    before: before.replace(/\s+/g, ' '),
    match: text.slice(index, index + length),
    after: text.slice(index + length, index + length + SNIPPET_AFTER).replace(/\s+/g, ' '),
  };
}

/**
 * Recherche plein texte, insensible à la casse et aux accents.
 * Un simple parcours suffit pour un usage personnel (quelques centaines de documents).
 */
export async function searchDocuments(query: string): Promise<SearchResult[]> {
  const needle = normalizeForSearch(query.trim());
  const [docs, bodies] = await Promise.all([listDocuments(), db.bodies.toArray()]);
  const textById = new Map(bodies.map((body) => [body.id, body.text]));

  const inTitle: SearchResult[] = [];
  const inText: SearchResult[] = [];
  for (const meta of docs) {
    if (normalizeForSearch(meta.title).includes(needle)) {
      inTitle.push({ meta, snippet: null });
      continue;
    }
    const text = textById.get(meta.id) ?? '';
    const index = normalizeForSearch(text).indexOf(needle);
    if (index >= 0) inText.push({ meta, snippet: makeSnippet(text, index, needle.length) });
  }
  return [...inTitle, ...inText];
}
