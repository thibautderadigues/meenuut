import type { ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor, JSONContent } from '@tiptap/react';

/** Profondeur du plus proche ancêtre de type `name`, ou -1. */
export function depthOf($pos: ResolvedPos, name: string): number {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === name) return depth;
  }
  return -1;
}

/**
 * Insère un bloc là où est le curseur : il remplace une ligne vide de premier niveau,
 * sinon il se place après le bloc courant. Le curseur entre dans le premier texte du bloc.
 */
export function insertBlock(editor: Editor, content: JSONContent) {
  const { state } = editor;
  const { $from } = state.selection;
  const node = state.schema.nodeFromJSON(content);
  const emptyLine = $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
  const from = emptyLine ? $from.before(1) : $from.after(1);
  const to = emptyLine ? $from.after(1) : from;

  const tr = state.tr.replaceWith(from, to, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/**
 * Entrée sur une ligne vide, dernière d'un conteneur (encadré, citation…) : on sort du conteneur,
 * comme dans une liste. Sinon, comportement normal.
 */
export function exitOnEmptyLine(editor: Editor, containerName: string): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) return false;

  const depth = $from.depth - 1;
  const container = $from.node(depth);
  if (container.type.name !== containerName) return false;
  if (container.childCount < 2 || $from.index(depth) !== container.childCount - 1) return false;

  const tr = state.tr.delete($from.before(), $from.after());
  const after = tr.mapping.map($from.after(depth));
  tr.insert(after, state.schema.nodes.paragraph!.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
