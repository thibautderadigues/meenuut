import type { DocMeta, Folder } from './db';

export type TreeNode =
  | { kind: 'folder'; folder: Folder; children: TreeNode[]; count: number }
  | { kind: 'doc'; doc: DocMeta };

/** Tri naturel : "Doc 2" avant "Doc 10", sans tenir compte de la casse ni des accents. */
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

export function docLabel(doc: DocMeta): string {
  return doc.title.trim() || 'Sans titre';
}

/**
 * Dossiers d'abord, puis documents, par ordre alphabétique à chaque niveau.
 * Un élément dont le parent n'existe plus est rattaché à la racine.
 */
export function buildTree(folders: Folder[], docs: DocMeta[]): TreeNode[] {
  const known = new Set(folders.map((folder) => folder.id));
  const parentOf = (id: string | null) => (id && known.has(id) ? id : null);

  const childFolders = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const parent = parentOf(folder.parentId);
    childFolders.set(parent, [...(childFolders.get(parent) ?? []), folder]);
  }
  const childDocs = new Map<string | null, DocMeta[]>();
  for (const doc of docs) {
    const parent = parentOf(doc.folderId);
    childDocs.set(parent, [...(childDocs.get(parent) ?? []), doc]);
  }

  const build = (parentId: string | null): TreeNode[] => {
    const folderNodes = (childFolders.get(parentId) ?? [])
      .sort((a, b) => collator.compare(a.name, b.name))
      .map((folder): TreeNode => {
        const children = build(folder.id);
        const count = children.reduce(
          (sum, child) => sum + (child.kind === 'doc' ? 1 : child.count),
          0,
        );
        return { kind: 'folder', folder, children, count };
      });
    const docNodes = (childDocs.get(parentId) ?? [])
      .sort((a, b) => collator.compare(docLabel(a), docLabel(b)))
      .map((doc): TreeNode => ({ kind: 'doc', doc }));
    return [...folderNodes, ...docNodes];
  };

  return build(null);
}

/** Le dossier et ses parents, du plus proche au plus lointain. */
export function folderChain(folders: Folder[], folderId: string | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: string[] = [];
  for (let cursor = folderId; cursor && byId.has(cursor) && !chain.includes(cursor); ) {
    chain.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return chain;
}

/** `folderId` est-il `ancestorId` ou l'un de ses descendants ? */
export function isWithin(folders: Folder[], folderId: string, ancestorId: string): boolean {
  return folderChain(folders, folderId).includes(ancestorId);
}

/** "Perso / Recettes" */
export function folderPath(folders: Folder[], folderId: string | null): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder.name]));
  return folderChain(folders, folderId)
    .reverse()
    .map((id) => byId.get(id))
    .join(' / ');
}

export function compareLabels(a: string, b: string): number {
  return collator.compare(a, b);
}
