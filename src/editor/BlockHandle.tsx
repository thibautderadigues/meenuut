import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { useCallback, useRef, useState } from 'react';
import { keys } from '../lib/platform';
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, GripIcon, PlusIcon, TrashIcon } from '../ui/icons';
import { Menu, type MenuEntry, type Point } from '../ui/Menu';
import { moveBlock } from './moveBlock';
import { SLASH_ITEMS } from './slash/items';

const TRANSFORMS = SLASH_ITEMS.filter((item) =>
  ['paragraph', 'h1', 'h2', 'h3', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'].includes(
    item.id,
  ),
);

/**
 * Poignée de bloc (survol) : "+" insère une ligne dessous et ouvre le menu "/",
 * la poignée se glisse pour déplacer le bloc, ou se clique pour ses options.
 * Au clavier : ⌥⇧↑/↓ pour déplacer, "/" pour insérer.
 */
export function BlockHandle({ editor }: { editor: Editor }) {
  const current = useRef<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 });
  const [menu, setMenu] = useState<Point | null>(null);

  const onNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
    current.current = { node, pos };
  }, []);

  /** Place le curseur dans le bloc visé, pour que les commandes s'y appliquent. */
  const selectBlock = () => {
    const { node, pos } = current.current;
    if (!node || pos < 0) return null;
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 1))));
    return { node, pos };
  };

  const insertBelow = () => {
    const { node, pos } = current.current;
    if (!node || pos < 0) return;
    const after = pos + node.nodeSize;
    editor
      .chain()
      .insertContentAt(after, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
      .setTextSelection(after + 2)
      .focus()
      .run();
  };

  // Actions fréquentes d'abord (toujours visibles), transformations ensuite.
  const entries = (): MenuEntry[] => [
    {
      label: 'Dupliquer',
      icon: CopyIcon,
      run: () => {
        const block = selectBlock();
        if (!block) return;
        const tr = editor.state.tr.insert(block.pos + block.node.nodeSize, block.node.copy(block.node.content));
        editor.view.dispatch(tr);
        editor.commands.focus();
      },
    },
    {
      label: 'Supprimer',
      icon: TrashIcon,
      danger: true,
      run: () => {
        const block = selectBlock();
        if (!block) return;
        editor.view.dispatch(editor.state.tr.delete(block.pos, block.pos + block.node.nodeSize));
        editor.commands.focus();
      },
    },
    'separator',
    {
      label: 'Monter',
      icon: ArrowUpIcon,
      shortcut: keys('alt', 'shift', '↑'),
      run: () => selectBlock() && moveBlock(editor, 'up'),
    },
    {
      label: 'Descendre',
      icon: ArrowDownIcon,
      shortcut: keys('alt', 'shift', '↓'),
      run: () => selectBlock() && moveBlock(editor, 'down'),
    },
    'separator',
    ...TRANSFORMS.map(
      (item): MenuEntry => ({
        label: `Transformer en ${item.label.toLowerCase()}`,
        icon: item.icon,
        shortcut: item.hint,
        run: () => {
          if (selectBlock()) item.run(editor.chain().focus(), editor);
        },
      }),
    ),
  ];

  return (
    <>
      <DragHandle editor={editor} onNodeChange={onNodeChange} className="z-20">
        <div data-print-hidden className="mr-1 hidden items-center text-ink-faint md:flex">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Insérer un bloc en dessous"
            data-tooltip="Insérer en dessous"
            onClick={insertBelow}
            className="grid size-6 place-items-center rounded transition-colors duration-100 hover:bg-surface hover:text-ink"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Options du bloc"
            data-tooltip="Glisser pour déplacer · cliquer pour les options"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.left, y: rect.bottom });
            }}
            className="grid h-6 w-5 cursor-grab place-items-center rounded transition-colors duration-100 hover:bg-surface hover:text-ink active:cursor-grabbing"
          >
            <GripIcon />
          </button>
        </div>
      </DragHandle>
      {menu && (
        <Menu label="Options du bloc" anchor={menu} entries={entries()} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
