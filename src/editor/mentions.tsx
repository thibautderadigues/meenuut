import { Mention } from '@tiptap/extension-mention';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createElement } from 'react';
import { db, isActive } from '../db/db';
import { createDocument, renameDocument } from '../db/documents';
import { docLabel } from '../db/tree';
import { openDocumentRoute } from '../lib/router';
import { fuzzyMatch } from '../palette/fuzzy';
import { FileIcon, PlusIcon } from '../ui/icons';
import { ItemIcon } from '../ui/itemIcons';
import { suggestionRenderer } from './suggestionRenderer';

type MentionItem =
  | { kind: 'doc'; id: string; title: string; icon: string | null | undefined }
  | { kind: 'create'; title: string };

const LIMIT = 8;

async function findDocuments(query: string): Promise<MentionItem[]> {
  const docs = await db.docs.orderBy('updatedAt').reverse().filter(isActive).toArray();
  const trimmed = query.trim();
  const matches = trimmed
    ? docs
        .map((doc) => ({ doc, match: fuzzyMatch(trimmed, docLabel(doc)) }))
        .filter((entry) => entry.match !== null)
        .sort((a, b) => b.match!.score - a.match!.score)
        .map((entry) => entry.doc)
    : docs;
  const items: MentionItem[] = matches
    .slice(0, LIMIT)
    .map((doc) => ({ kind: 'doc', id: doc.id, title: docLabel(doc), icon: doc.icon }));
  // Aucun titre identique : proposer de créer le document à la volée.
  const exact = docs.some((doc) => docLabel(doc).toLowerCase() === trimmed.toLowerCase());
  if (trimmed && !exact) items.push({ kind: 'create', title: trimmed });
  return items;
}

function renderMentionItem(item: MentionItem) {
  const icon =
    item.kind === 'doc'
      ? createElement(ItemIcon, { value: item.icon, fallback: createElement(FileIcon) })
      : createElement(PlusIcon);
  return [
    createElement(
      'span',
      { key: 'icon', className: 'grid size-7 shrink-0 place-items-center text-ink-muted' },
      icon,
    ),
    createElement(
      'span',
      { key: 'label', className: 'flex-1 truncate text-sm text-ink' },
      item.kind === 'doc' ? item.title : `Créer « ${item.title} »`,
    ),
  ];
}

/**
 * Lien vers un document, affiché avec son titre et son icône à jour (lus en direct dans la base) :
 * renommer un document met à jour toutes ses mentions. Un clic l'ouvre.
 */
function MentionView({ node }: ReactNodeViewProps) {
  const id = String(node.attrs.id);
  // undefined : chargement ; null : document supprimé.
  const doc = useLiveQuery(async () => {
    const found = await db.docs.get(id);
    return found && isActive(found) ? found : null;
  }, [id]);
  const label = doc ? docLabel(doc) : String(node.attrs.label ?? '');
  const missing = doc === null;

  return (
    <NodeViewWrapper as="span" data-type="mention" className={`mention ${missing ? 'mention-missing' : ''}`}>
      <a
        href={`#/d/${id}`}
        contentEditable={false}
        draggable={false}
        title={missing ? 'Document supprimé' : `Ouvrir « ${label} »`}
        onClick={(event) => {
          event.preventDefault();
          if (!missing) openDocumentRoute(id);
        }}
      >
        <span className="mention-icon" aria-hidden>
          <ItemIcon value={doc?.icon} fallback={<FileIcon />} />
        </span>
        {label}
      </a>
    </NodeViewWrapper>
  );
}

export const DocumentMention = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionView, { as: 'span' });
  },
}).configure({
  renderText: ({ node }) => String(node.attrs.label ?? ''),
  renderHTML: ({ node }) => [
    'a',
    { href: `#/d/${String(node.attrs.id)}`, 'data-type': 'mention', class: 'mention' },
    String(node.attrs.label ?? ''),
  ],
  suggestion: {
    char: '@',
    allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
    items: ({ query }) => findDocuments(query),
    command: ({ editor, range, props }) => {
      const item = props as unknown as MentionItem;
      const insert = (id: string, label: string) =>
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id, label } },
            { type: 'text', text: ' ' },
          ])
          .run();
      if (item.kind === 'doc') {
        insert(item.id, item.title);
        return;
      }
      void createDocument(null).then(async (id) => {
        await renameDocument(id, item.title);
        insert(id, item.title);
      });
    },
    // Mention type ses suggestions comme des attributs de nœud ; les nôtres sont des documents.
    render: suggestionRenderer<MentionItem>({
      label: 'Mentionner un document',
      empty: 'Aucun document',
      getKey: (item) => (item.kind === 'doc' ? item.id : `create:${item.title}`),
      renderItem: renderMentionItem,
    }) as unknown as NonNullable<SuggestionOptions['render']>,
  },
});
