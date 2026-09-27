import type { JSONContent } from '@tiptap/react';
import Dexie, { type EntityTable } from 'dexie';
import { itemKey, markPending, SYNCED_TABLES, type SyncedTable } from '../sync/outbox';

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
  /** Date de mise à la corbeille ; absent ou null : document actif. */
  deletedAt?: number | null;
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
  /** Date de mise à la corbeille ; absent ou null : dossier actif. */
  deletedAt?: number | null;
}

/** Élément actif : ni à la corbeille. */
export const isActive = (item: { deletedAt?: number | null }) => !item.deletedAt;

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

/** Transactions qui appliquent des changements venus du serveur : rien à renvoyer. */
export const remoteTransactions = new WeakSet<object>();

// Toute écriture locale met l'élément en file d'envoi. Marqué dès la requête, avant la fin
// de la transaction : une lecture ultérieure (l'envoi) attend de toute façon qu'elle se termine.
db.use({
  stack: 'dbcore',
  name: 'outbox',
  create: (down) => ({
    ...down,
    table(name) {
      const table = down.table(name);
      if (!SYNCED_TABLES.includes(name)) return table;
      return {
        ...table,
        mutate(req) {
          if (!remoteTransactions.has(req.trans)) {
            const ids =
              req.type === 'delete'
                ? req.keys
                : req.type === 'deleteRange'
                  ? []
                  : req.values.map((value: { id: string }) => value.id);
            markPending(ids.map((id) => itemKey(name as SyncedTable, String(id))));
          }
          return table.mutate(req);
        },
      };
    },
  }),
});
