import { db, type Folder } from './db';
import type { DocumentSnapshot } from './documents';

/** Ce qu'il faut pour annuler la suppression d'un dossier et de tout son contenu. */
export interface FolderSnapshot {
  folders: Folder[];
  docs: DocumentSnapshot[];
}

export function listFolders(): Promise<Folder[]> {
  return db.folders.toArray();
}

export async function createFolder(parentId: string | null): Promise<string> {
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: 'Nouveau dossier',
    parentId,
    createdAt: Date.now(),
  };
  await db.folders.add(folder);
  return folder.id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await db.folders.update(id, { name });
}

export async function setFolderIcon(id: string, icon: string | null): Promise<void> {
  await db.folders.update(id, { icon });
}

export function moveFolder(id: string, parentId: string | null): Promise<void> {
  return db.transaction('rw', db.folders, async () => {
    // Un dossier ne peut pas entrer dans sa propre descendance.
    for (let cursor = parentId; cursor; cursor = (await db.folders.get(cursor))?.parentId ?? null) {
      if (cursor === id) return;
    }
    await db.folders.update(id, { parentId });
  });
}

export function deleteFolder(id: string): Promise<FolderSnapshot | null> {
  return db.transaction('rw', db.folders, db.docs, db.bodies, async () => {
    const all = await db.folders.toArray();
    if (!all.some((folder) => folder.id === id)) return null;

    // Le dossier et toute sa descendance.
    const ids = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const folder of all) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          grew = true;
        }
      }
    }

    const metas = await db.docs.where('folderId').anyOf([...ids]).toArray();
    const docIds = metas.map((meta) => meta.id);
    const bodies = await db.bodies.bulkGet(docIds);

    await db.folders.bulkDelete([...ids]);
    await db.docs.bulkDelete(docIds);
    await db.bodies.bulkDelete(docIds);

    return {
      folders: all.filter((folder) => ids.has(folder.id)),
      docs: metas.map((meta, index) => ({ meta, body: bodies[index] })),
    };
  });
}

export function restoreFolder({ folders, docs }: FolderSnapshot): Promise<void> {
  return db.transaction('rw', db.folders, db.docs, db.bodies, async () => {
    await db.folders.bulkPut(folders);
    await db.docs.bulkPut(docs.map((doc) => doc.meta));
    await db.bodies.bulkPut(docs.flatMap((doc) => (doc.body ? [doc.body] : [])));
  });
}
