import type { Content, Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Texte ajouté par l'assistant : un léger fond dans sa teinte qui s'efface, le temps de le
 * repérer. Il suit les modifications du document pendant ces quelques secondes.
 */

const key = new PluginKey<DecorationSet>('aiHighlight');
/** Durée de l'animation d'effacement (prose.css), un peu plus pour qu'elle aille au bout. */
const VISIBLE_MS = 2800;

type Meta = { from: number; to: number } | 'clear';

export const AiHighlight = Extension.create({
  name: 'aiHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(key) as Meta | undefined;
            if (meta === 'clear') return DecorationSet.empty;
            if (meta) return DecorationSet.create(tr.doc, rangeDecorations(tr.doc, meta.from, meta.to));
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

/** Contour d'un intervalle : le texte s'il tient dans un paragraphe, sinon chaque bloc. */
export function rangeDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  from: number,
  to: number,
  inlineClass = 'ai-inserted',
  blockClass = 'ai-inserted-block',
) {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  // Dans un seul paragraphe : on entoure le texte. Sur plusieurs blocs : on entoure chaque bloc.
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    return [Decoration.inline(from, to, { class: inlineClass })];
  }
  const blocks: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isBlock) return false;
    if (node.isTextblock || node.isAtom || pos >= from) {
      blocks.push(Decoration.node(pos, pos + node.nodeSize, { class: blockClass }));
      return false;
    }
    return true;
  });
  return blocks;
}

/**
 * Insère du contenu (à la place de `range`, ou de la sélection) et le signale par le contour.
 * La taille du document avant/après donne l'étendue réellement insérée.
 */
/** Contour orange quelques secondes sur un intervalle déjà présent dans le document. */
export function flashRange(editor: Editor, from: number, to: number) {
  if (to <= from) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, { from, to }));
  window.setTimeout(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, 'clear'));
  }, VISIBLE_MS);
}

export function insertMarked(editor: Editor, content: Content, range?: { from: number; to: number }) {
  const { from, to } = range ?? editor.state.selection;
  const before = editor.state.doc.content.size;
  editor.chain().focus().insertContentAt({ from, to }, content).run();
  flashRange(editor, from, to + (editor.state.doc.content.size - before));
}
