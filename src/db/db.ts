import type { JSONContent } from '@tiptap/react';
import Dexie, { type EntityTable } from 'dexie';

/** Métadonnées légères : c'est ce que la sidebar observe. */
export interface DocMeta {
  id: string;
  title: string;
  /** null : à la racine. */
  folderId: string | null;
  /** Date d'épinglage (ordre de la section Épinglés), null si non épinglé. */
  pinnedAt: number | null;
  /** Icône choisie ("icon:book" ou "emoji:🍳"), absente = icône par défaut. */
  icon?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Corps du document, lu uniquement pour le document ouvert. */
export interface DocBody {
  id: string;
  content: JSONContent;
  /** Texte brut dénormalisé, pour la recherche. */
  text: string;
}

export interface Folder {
  id: string;
  name: string;
  /** null : à la racine. */
  parentId: string | null;
  /** Icône choisie ("icon:book" ou "emoji:🍳"), absente = icône par défaut. */
  icon?: string | null;
  createdAt: number;
}

export const db = new Dexie('meenuut') as Dexie & {
  docs: EntityTable<DocMeta, 'id'>;
  bodies: EntityTable<DocBody, 'id'>;
  folders: EntityTable<Folder, 'id'>;
};

db.version(1).stores({
  docs: 'id, updatedAt',
  bodies: 'id',
});

db.version(2)
  .stores({
    docs: 'id, updatedAt, folderId',
    folders: 'id, parentId',
  })
  .upgrade((tx) =>
    tx
      .table<DocMeta>('docs')
      .toCollection()
      .modify((doc) => {
        doc.folderId ??= null;
        doc.pinnedAt ??= null;
      }),
  );
