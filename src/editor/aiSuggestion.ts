import type { Content, Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { flashRange, rangeDecorations } from './aiHighlight';

/**
 * Suggestion de l'assistant écrite directement dans le document, en attente de validation
 * (comme dans Cursor). Tant qu'elle est en attente :
 * - la zone est surlignée, avec « Accepter / Refuser » à sa suite ;
 * - l'assistant peut la réécrire sur place (on continue de discuter dans le panneau) ;
 * - ces écritures successives n'entrent pas dans l'historique d'annulation.
 * Refuser remet le texte d'origine. Accepter en fait une seule étape annulable (⌘Z).
 */

export interface Pending {
  from: number;
  to: number;
  /** Contenu remplacé, pour tout remettre si on refuse. */
  original: Slice;
  /** block : paragraphes insérés ; inline : texte réécrit dans une phrase. */
  kind: 'block' | 'inline';
}

type Meta = { set: Pending } | { range: { from: number; to: number } } | 'clear';
export type Outcome = 'accepted' | 'rejected';

const key = new PluginKey<Pending | null>('aiSuggestion');
const settledListeners = new Set<(outcome: Outcome) => void>();

/** Prévenu quand la suggestion en cours est acceptée ou refusée (depuis le texte ou le panneau). */
export function onSuggestionSettled(listener: (outcome: Outcome) => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

export function getPending(state: EditorState): Pending | null {
  return key.getState(state) ?? null;
}

export const AiSuggestion = Extension.create({
  name: 'aiSuggestion',

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => (getPending(this.editor.state) ? acceptSuggestion(this.editor) : false),
      Escape: () => (getPending(this.editor.state) ? rejectSuggestion(this.editor) : false),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<Pending | null>({
        key,
        state: {
          init: () => null,
          apply(tr, pending) {
            const meta = tr.getMeta(key) as Meta | undefined;
            if (meta === 'clear') return null;
            if (meta && 'set' in meta) return meta.set;
            if (meta && 'range' in meta) return pending && { ...pending, ...meta.range };
            if (!pending || !tr.docChanged) return pending;
            // Ce qu'on tape juste avant ou juste après ne fait pas partie de la suggestion.
            const from = tr.mapping.map(pending.from, 1);
            const to = Math.max(from, tr.mapping.map(pending.to, -1));
            return { ...pending, from, to };
          },
        },
        props: {
          decorations(state) {
            const pending = getPending(state);
            if (!pending) return null;
            const marks =
              pending.to > pending.from
                ? rangeDecorations(state.doc, pending.from, pending.to, 'ai-pending', 'ai-pending-block')
                : [];
            return DecorationSet.create(state.doc, [
              ...marks,
              Decoration.widget(pending.to, () => controls(editor), {
                side: 1,
                key: 'ai-pending-controls',
                ignoreSelection: true,
                stopEvent: () => true,
              }),
            ]);
          },
        },
      }),
    ];
  },
});

/** Boutons à la suite de la suggestion. */
function controls(editor: Editor): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'ai-pending-bar';
  bar.contentEditable = 'false';
  const button = (label: string, title: string, className: string, run: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.title = title;
    element.className = className;
    // Ne pas déplacer le curseur ni perdre le focus de l'éditeur.
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', run);
    return element;
  };
  bar.append(
    button('Accepter', 'Accepter (⌘↵)', 'ai-pending-accept', () => acceptSuggestion(editor)),
    button('Refuser', 'Refuser et remettre le texte d’avant (Échap)', 'ai-pending-reject', () =>
      rejectSuggestion(editor),
    ),
  );
  return bar;
}

/** Ouvre une suggestion sur l'intervalle donné (vide : simple point d'insertion). */
export function beginSuggestion(editor: Editor, from: number, to: number, kind: Pending['kind']) {
  const { state } = editor;
  editor.view.dispatch(
    state.tr.setMeta(key, { set: { from, to, original: state.doc.slice(from, to), kind } }),
  );
}

/** Remplace le contenu de la suggestion (écriture en direct, révision). Hors historique. */
export function writeSuggestion(editor: Editor, content: Content) {
  const pending = getPending(editor.state);
  if (!pending) return;
  const before = editor.state.doc.content.size;
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta('addToHistory', false);
      return true;
    })
    .insertContentAt({ from: pending.from, to: pending.to }, content, { updateSelection: false })
    .run();
  const to = pending.to + (editor.state.doc.content.size - before);
  editor.view.dispatch(
    editor.state.tr.setMeta(key, { range: { from: pending.from, to } }).setMeta('addToHistory', false),
  );
}

/** Texte actuel de la suggestion (pour la réviser). */
export function pendingText(editor: Editor): string {
  const pending = getPending(editor.state);
  return pending ? editor.state.doc.textBetween(pending.from, pending.to, '\n\n') : '';
}

export function acceptSuggestion(editor: Editor): boolean {
  const pending = getPending(editor.state);
  if (!pending) return false;
  const { from, to, original } = pending;
  const final = editor.state.doc.slice(from, to);
  // Retour à l'état d'origine hors historique, puis la version finale en une seule étape :
  // ⌘Z annule toute la suggestion d'un coup.
  const restore = editor.state.tr.replace(from, to, original).setMeta('addToHistory', false);
  editor.view.dispatch(restore);
  const apply = editor.state.tr.replace(from, from + original.size, final).setMeta(key, 'clear');
  editor.view.dispatch(apply);
  flashRange(editor, from, from + final.size);
  for (const listener of settledListeners) listener('accepted');
  return true;
}

export function rejectSuggestion(editor: Editor): boolean {
  const pending = getPending(editor.state);
  if (!pending) return false;
  const tr = editor.state.tr
    .replace(pending.from, pending.to, pending.original)
    .setMeta(key, 'clear')
    .setMeta('addToHistory', false);
  editor.view.dispatch(tr);
  for (const listener of settledListeners) listener('rejected');
  return true;
}
