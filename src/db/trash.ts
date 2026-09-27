import { db, isActive, type DocMeta, type Folder } from './db';
import { docLabel } from './tree';

/**
 * Corbeille. Un document ou un dossier supprimé garde ses données avec une date `deletedAt` :
 * il disparaît de l'app mais reste restaurable pendant RETENTION_DAYS jours.
 * Un dossier part avec toute sa descendance, sous la même date : c'est ce qui permet de
 * n'afficher que le dossier dans la corbeille, et de tout restaurer d'un coup.
 */

export const RETENTION_DAYS = 30;

export interface TrashEntry {
  kind: 'doc' | 'folder';
  id: string;
  label: string;
  icon: string | null | undefined;
  deletedAt: number;
  /** Dossier : nombre de documents partis avec lui. */
  docCount: number;
}

async function snapshot() {
  const [docs, folders] = await Promise.all([db.docs.toArray(), db.folders.toArray()]);
  return {
    docs: docs.filter((doc) => !isActive(doc)),
    folders: folders.filter((folder) => !isActive(folder)),
    foldersById: new Map(folders.map((folder) => [folder.id, folder])),
  };
}

/** Parti avec son dossier parent (même date) : représenté par ce dossier. */
const wentWithParent = (
  parentId: string | null,
  deletedAt: number | null | undefined,
  foldersById: Map<string, Folder>,
) => {
  const parent = parentId ? foldersById.get(parentId) : undefined;
  return Boolean(parent && parent.deletedAt === deletedAt);
};

/** Descendance supprimée en même temps que `root` (dossiers, dont root, et documents). */
function batchOf(root: Folder, folders: Folder[], docs: DocMeta[]) {
  const ids = new Set([root.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const folder of folders) {
      if (
        folder.deletedAt === root.deletedAt &&
        folder.parentId &&
        ids.has(folder.parentId) &&
        !ids.has(folder.id)
      ) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return {
    folderIds: [...ids],
    docIds: docs
      .filter((doc) => doc.deletedAt === root.deletedAt && doc.folderId && ids.has(doc.folderId))
      .map((doc) => doc.id),
  };
}

export async function listTrash(): Promise<TrashEntry[]> {
  const { docs, folders, foldersById } = await snapshot();
  const entries: TrashEntry[] = [
    ...folders
      .filter((folder) => !wentWithParent(folder.parentId, folder.deletedAt, foldersById))
      .map((folder) => ({
        kind: 'folder' as const,
        id: folder.id,
        label: folder.name.trim() || 'Sans nom',
        icon: folder.icon,
        deletedAt: folder.deletedAt ?? 0,
        docCount: batchOf(folder, folders, docs).docIds.length,
      })),
    ...docs
      .filter((doc) => !wentWithParent(doc.folderId, doc.deletedAt, foldersById))
      .map((doc) => ({
        kind: 'doc' as const,
        id: doc.id,
        label: docLabel(doc),
        icon: doc.icon,
        deletedAt: doc.deletedAt ?? 0,
        docCount: 0,
      })),
  ];
  return entries.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Restaure l'élément (et, pour un dossier, ce qui est parti avec lui). Parent disparu : à la racine. */
export function restoreFromTrash(entry: Pick<TrashEntry, 'kind' | 'id'>): Promise<void> {
  return db.transaction('rw', db.docs, db.folders, async () => {
    const { docs, folders, foldersById } = await snapshot();
    const parentGone = (parentId: string | null) => {
      const parent = parentId ? foldersById.get(parentId) : undefined;
      return parentId !== null && (!parent || !isActive(parent));
    };

    if (entry.kind === 'doc') {
      const doc = await db.docs.get(entry.id);
      if (!doc) return;
      await db.docs.update(entry.id, {
        deletedAt: null,
        folderId: parentGone(doc.folderId) ? null : doc.folderId,
      });
      return;
    }

    const root = foldersById.get(entry.id);
    if (!root) return;
    const { folderIds, docIds } = batchOf(root, folders, docs);
    await Promise.all([
      ...folderIds.map((id) => db.folders.update(id, { deletedAt: null })),
      ...docIds.map((id) => db.docs.update(id, { deletedAt: null })),
    ]);
    if (parentGone(root.parentId)) await db.folders.update(root.id, { parentId: null });
  });
}

/** Suppression définitive (irréversible) : l'élément et, pour un dossier, sa descendance. */
export function deleteForever(entry: Pick<TrashEntry, 'kind' | 'id'>): Promise<void> {
  return db.transaction('rw', db.docs, db.bodies, db.folders, async () => {
    if (entry.kind === 'doc') {
      await db.docs.delete(entry.id);
      await db.bodies.delete(entry.id);
      return;
    }
    const { docs, folders, foldersById } = await snapshot();
    const root = foldersById.get(entry.id);
    if (!root) return;
    const { folderIds, docIds } = batchOf(root, folders, docs);
    await db.folders.bulkDelete(folderIds);
    await db.docs.bulkDelete(docIds);
    await db.bodies.bulkDelete(docIds);
  });
}

/** Vide la corbeille, ou seulement ce qui y est depuis plus de `olderThanDays` jours. */
export function purgeTrash(olderThanDays = 0): Promise<void> {
  const limit = Date.now() - olderThanDays * 86_400_000;
  return db.transaction('rw', db.docs, db.bodies, db.folders, async () => {
    const { docs, folders } = await snapshot();
    const docIds = docs.filter((doc) => (doc.deletedAt ?? 0) <= limit).map((doc) => doc.id);
    const folderIds = folders
      .filter((folder) => (folder.deletedAt ?? 0) <= limit)
      .map((folder) => folder.id);
    await db.docs.bulkDelete(docIds);
    await db.bodies.bulkDelete(docIds);
    await db.folders.bulkDelete(folderIds);
  });
}
