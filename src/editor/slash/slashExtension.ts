import { PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/react';
import { Suggestion } from '@tiptap/suggestion';
import { createElement } from 'react';
import { suggestionRenderer } from '../suggestionRenderer';
import { CUSTOM_ITEMS } from '../blocks/catalog';
import { filterSlashItems, type SlashItem } from './items';

function renderSlashItem(item: SlashItem) {
  return [
    createElement(
      'span',
      {
        key: 'icon',
        className:
          'grid size-7 shrink-0 place-items-center rounded-md border border-rule bg-canvas text-ink-muted',
      },
      createElement(item.icon),
    ),
    createElement('span', { key: 'label', className: 'flex-1 text-sm text-ink' }, item.label),
    item.hint
      ? createElement('span', { key: 'hint', className: 'font-mono text-[11px] text-ink-faint' }, item.hint)
      : null,
  ];
}

/** "/" en début de ligne ou après une espace ouvre le menu d'insertion de blocs. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        // Pas dans un titre ni un bloc de code : "/" y est du texte.
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name === 'paragraph',
        items: ({ query }) => filterSlashItems(query, CUSTOM_ITEMS),
        command: ({ editor, range, props }) =>
          props.run(editor.chain().focus().deleteRange(range), editor),
        render: suggestionRenderer<SlashItem>({
          label: 'Insérer un bloc',
          empty: 'Aucun bloc ne correspond',
          getKey: (item) => item.id,
          renderItem: renderSlashItem,
        }),
      }),
    ];
  },
});
