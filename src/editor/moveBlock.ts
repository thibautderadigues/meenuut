import { TextSelection } from '@tiptap/pm/state';
import { Extension, type Editor } from '@tiptap/react';

/**
 * Déplace le bloc de premier niveau qui contient le curseur d'un cran vers le haut ou le bas.
 * Alternative clavier au glisser-déposer de la poignée : ⌥⇧↑ / ⌥⇧↓.
 */
export function moveBlock(editor: Editor, direction: 'up' | 'down'): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;

  const index = $from.index(0);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= state.doc.childCount) return false;

  const start = $from.before(1);
  const node = state.doc.child(index);
  const offsetInBlock = state.selection.from - start;

  const tr = state.tr.delete(start, start + node.nodeSize);
  // Vers le haut : avant le bloc précédent. Vers le bas : après le suivant, qui a pris la place du bloc.
  const insertAt =
    direction === 'up'
      ? start - state.doc.child(target).nodeSize
      : start + state.doc.child(target).nodeSize;
  tr.insert(insertAt, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + offsetInBlock)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export const MoveBlock = Extension.create({
  name: 'moveBlock',
  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': () => moveBlock(this.editor, 'up'),
      'Alt-Shift-ArrowDown': () => moveBlock(this.editor, 'down'),
    };
  },
});
