import type { Content, Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import type { Node as PMNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { rangeDecorations } from './aiHighlight';

/**
 * Suggestions de l'assistant écrites directement dans le document, en attente de validation
 * (comme dans Cursor). Il peut y en avoir plusieurs à la fois : une par passage modifié.
 * Tant qu'une suggestion est en attente :
 * - sa zone est surlignée (l'ancien texte barré juste avant, pour une réécriture dans une
 *   phrase), avec « Accepter / Refuser » à sa suite ;
 * - l'assistant peut la réécrire sur place ;
 * - ces écritures n'entrent pas dans l'historique d'annulation.
 * Refuser remet le texte d'origine. Accepter en fait une seule étape annulable (⌘Z).
 * Une suppression proposée laisse le texte en place, barré, jusqu'à l'acceptation.
 */

export interface Pending {
  id: number;
  from: number;
  to: number;
  /** Contenu remplacé, pour tout remettre si on refuse. */
  original: Slice;
  /** block : paragraphes insérés ; inline : texte réécrit dans une phrase ; delete : à supprimer. */
  kind: 'block' | 'inline' | 'delete';
  /** L'IA est en train d'écrire : curseur au bout, boutons une fois qu'elle a fini. */
  writing?: boolean;
}

type Meta =
  | { add: Pending }
  | { range: { id: number; from: number; to: number } }
  | { done: number }
  | { writing: number }
  | { remove: number }
  | 'clear';

export type Outcome = 'accepted' | 'rejected';

const key = new PluginKey<Pending[]>('aiSuggestion');
const settledListeners = new Set<(id: number, outcome: Outcome) => void>();
let nextId = 1;

/** Prévenu quand une suggestion est acceptée ou refusée (depuis le texte ou le panneau). */
export function onSuggestionSettled(listener: (id: number, outcome: Outcome) => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

export function getPendings(state: EditorState): Pending[] {
  return key.getState(state) ?? [];
}

/** Une suggestion précise, ou la plus récente (celle qu'une nouvelle consigne réécrit). */
export function getPending(state: EditorState, id?: number): Pending | null {
  const all = getPendings(state);
  return (id === undefined ? all.at(-1) : all.find((pending) => pending.id === id)) ?? null;
}

export const AiSuggestion = Extension.create({
  name: 'aiSuggestion',

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => acceptAll(this.editor),
      'Mod-Backspace': () => rejectAll(this.editor),
      Escape: () => rejectAll(this.editor),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<Pending[]>({
        key,
        state: {
          init: () => [],
          apply(tr, pendings) {
            const meta = tr.getMeta(key) as Meta | undefined;
            if (meta === 'clear') return [];
            let next = pendings;
            if (tr.docChanged) {
              // Ce qu'on tape juste avant ou juste après ne fait pas partie de la suggestion.
              next = next.map((pending) => {
                const from = tr.mapping.map(pending.from, 1);
                const to = Math.max(from, tr.mapping.map(pending.to, -1));
                return { ...pending, from, to };
              });
            }
            if (meta && 'add' in meta) next = [...next, meta.add];
            if (meta && 'range' in meta) {
              next = next.map((pending) =>
                pending.id === meta.range.id ? { ...pending, ...meta.range } : pending,
              );
            }
            if (meta && 'remove' in meta) next = next.filter((pending) => pending.id !== meta.remove);
            if (meta && 'writing' in meta) {
              next = next.map((pending) => (pending.id === meta.writing ? { ...pending, writing: true } : pending));
            }
            if (meta && 'done' in meta) {
              next = next.map((pending) => (pending.id === meta.done ? { ...pending, writing: false } : pending));
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const pendings = getPendings(state);
            if (pendings.length === 0) return null;
            return DecorationSet.create(state.doc, pendings.flatMap((pending) => decorate(editor, state, pending)));
          },
        },
      }),
    ];
  },
});

function decorate(editor: Editor, state: EditorState, pending: Pending): Decoration[] {
  const decorations: Decoration[] = [];
  const deleting = pending.kind === 'delete';
  // Blocs entiers (paragraphes ajoutés, remplacés ou supprimés) ou texte dans une phrase.
  const blockLevel = state.doc.resolve(Math.min(pending.from, state.doc.content.size)).depth === 0;

  // Comme dans Cursor : l'ancien texte en rouge, juste avant le nouveau (en vert).
  const originalBlocks: string[] = [];
  pending.original.content.forEach((node) => {
    if (node.textContent.trim()) originalBlocks.push(node.textContent);
  });
  const originalText = pending.original.content.textBetween(0, pending.original.content.size, ' ');
  if (!deleting && pending.kind === 'inline' && originalText) {
    decorations.push(
      Decoration.widget(pending.from, () => element('span', 'ai-original', originalText), {
        side: -1,
        key: `ai-original-${pending.id}-${originalText.length}`,
        ignoreSelection: true,
      }),
    );
  }
  if (!deleting && pending.kind === 'block' && originalBlocks.length) {
    decorations.push(
      Decoration.widget(
        pending.from,
        () => {
          const old = element('div', 'ai-original-block');
          for (const text of originalBlocks) old.append(element('p', '', text));
          return old;
        },
        { side: -1, key: `ai-original-block-${pending.id}`, ignoreSelection: true },
      ),
    );
  }

  if (pending.to > pending.from) {
    decorations.push(
      ...rangeDecorations(
        state.doc,
        pending.from,
        pending.to,
        deleting ? 'ai-deleting' : 'ai-pending',
        deleting ? 'ai-deleting-block' : 'ai-pending-block',
      ),
    );
  }

  // Pendant l'écriture : un curseur au bout du texte qui arrive, pas encore de boutons.
  if (pending.writing) {
    decorations.push(
      Decoration.widget(pending.to, () => element('span', 'ai-caret'), {
        side: 1,
        key: `ai-caret-${pending.id}`,
        ignoreSelection: true,
      }),
    );
    return decorations;
  }

  // Boutons : en haut à droite d'un groupe de blocs, à la suite d'un changement dans une phrase.
  decorations.push(
    blockLevel
      ? Decoration.widget(pending.from, () => controls(editor, pending.id, deleting, 'block'), {
          side: -2,
          key: `ai-pending-controls-${pending.id}`,
          ignoreSelection: true,
          stopEvent: () => true,
        })
      : Decoration.widget(pending.to, () => controls(editor, pending.id, deleting, 'inline'), {
          side: 1,
          key: `ai-pending-controls-${pending.id}`,
          ignoreSelection: true,
          stopEvent: () => true,
        }),
  );
  return decorations;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Accepter / Refuser d'une modification. */
function controls(editor: Editor, id: number, deleting: boolean, placement: 'block' | 'inline'): HTMLElement {
  const wrapper = element(placement === 'block' ? 'div' : 'span', `ai-hunk ai-hunk--${placement}`);
  wrapper.contentEditable = 'false';
  const bar = element('span', 'ai-hunk-actions');
  const button = (label: string, title: string, className: string, run: () => void) => {
    const node = element('button', className, label) as HTMLButtonElement;
    node.type = 'button';
    node.title = title;
    // Ne pas déplacer le curseur ni perdre le focus de l'éditeur.
    node.addEventListener('mousedown', (event) => event.preventDefault());
    node.addEventListener('click', run);
    return node;
  };
  bar.append(
    button('Refuser', 'Refuser cette modification', 'ai-hunk-reject', () => rejectSuggestion(editor, id)),
    button(deleting ? 'Supprimer' : 'Accepter', 'Accepter cette modification', 'ai-hunk-accept', () =>
      acceptSuggestion(editor, id),
    ),
  );
  wrapper.append(bar);
  return wrapper;
}

/**
 * Ouvre une suggestion sur l'intervalle donné (vide : simple point d'insertion). Renvoie son id.
 * `writing` : l'IA va l'écrire en direct (curseur, boutons à la fin via `finishWriting`).
 */
export function beginSuggestion(
  editor: Editor,
  from: number,
  to: number,
  kind: Pending['kind'],
  writing = false,
): number {
  const { state } = editor;
  const id = nextId++;
  editor.view.dispatch(
    state.tr.setMeta(key, { add: { id, from, to, original: state.doc.slice(from, to), kind, writing } }),
  );
  return id;
}

/** L'IA réécrit une suggestion existante (révision) : le curseur revient. */
export function resumeWriting(editor: Editor, id: number) {
  if (getPending(editor.state, id)) editor.view.dispatch(editor.state.tr.setMeta(key, { writing: id }));
}

/** L'IA a fini d'écrire : on retire le curseur et on montre Accepter / Refuser. */
export function finishWriting(editor: Editor, id: number) {
  if (getPending(editor.state, id)) editor.view.dispatch(editor.state.tr.setMeta(key, { done: id }));
}

/** Met la suggestion sous les yeux : sa fin (là où arrive le texte) au milieu de l'écran. */
export function revealSuggestion(editor: Editor, id: number, behavior: ScrollBehavior = 'smooth') {
  const pending = getPending(editor.state, id);
  if (!pending) return;
  const coords = editor.view.coordsAtPos(Math.min(pending.to, editor.state.doc.content.size));
  const target = coords.top - window.innerHeight / 2;
  if (Math.abs(target) > window.innerHeight * 0.25) {
    window.scrollBy({ top: target, behavior });
  }
}

/** Remplace le contenu d'une suggestion (écriture en direct, révision). Hors historique. */
export function writeSuggestion(editor: Editor, content: Content, id?: number) {
  const pending = getPending(editor.state, id);
  if (!pending || pending.kind === 'delete') return;
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
    editor.state.tr
      .setMeta(key, { range: { id: pending.id, from: pending.from, to } })
      .setMeta('addToHistory', false),
  );
}

/** Texte actuel d'une suggestion (pour la réviser). */
export function pendingText(editor: Editor, id?: number): string {
  const pending = getPending(editor.state, id);
  return pending ? editor.state.doc.textBetween(pending.from, pending.to, '\n\n') : '';
}

export function acceptSuggestion(editor: Editor, id?: number): boolean {
  const pending = getPending(editor.state, id);
  if (!pending) return false;
  const { from, to, original } = pending;
  if (pending.kind === 'delete') {
    editor.view.dispatch(editor.state.tr.delete(from, to).setMeta(key, { remove: pending.id }));
  } else {
    const final = editor.state.doc.slice(from, to);
    // Retour à l'état d'origine hors historique, puis la version finale en une seule étape :
    // ⌘Z annule toute la suggestion d'un coup.
    editor.view.dispatch(editor.state.tr.replace(from, to, original).setMeta('addToHistory', false));
    editor.view.dispatch(
      editor.state.tr.replace(from, from + original.size, final).setMeta(key, { remove: pending.id }),
    );
  }
  for (const listener of settledListeners) listener(pending.id, 'accepted');
  return true;
}

export function rejectSuggestion(editor: Editor, id?: number): boolean {
  const pending = getPending(editor.state, id);
  if (!pending) return false;
  const tr =
    pending.kind === 'delete'
      ? editor.state.tr.setMeta(key, { remove: pending.id })
      : editor.state.tr
          .replace(pending.from, pending.to, pending.original)
          .setMeta(key, { remove: pending.id })
          .setMeta('addToHistory', false);
  editor.view.dispatch(tr);
  for (const listener of settledListeners) listener(pending.id, 'rejected');
  return true;
}

/** Accepte toutes les suggestions (ou celles listées). */
export function acceptAll(editor: Editor, ids?: number[]): boolean {
  const targets = getPendings(editor.state).filter((pending) => !ids || ids.includes(pending.id));
  // Du bas vers le haut : chaque acceptation ne décale pas celles du dessus.
  for (const pending of [...targets].sort((a, b) => b.from - a.from)) acceptSuggestion(editor, pending.id);
  return targets.length > 0;
}

export function rejectAll(editor: Editor, ids?: number[]): boolean {
  const targets = getPendings(editor.state).filter((pending) => !ids || ids.includes(pending.id));
  for (const pending of [...targets].sort((a, b) => b.from - a.from)) rejectSuggestion(editor, pending.id);
  return targets.length > 0;
}

/**
 * Retrouve un passage dans le document (texte brut, sans syntaxe Markdown), à l'intérieur
 * d'un paragraphe, titre ou élément de liste. Espaces, apostrophes et guillemets tolérés.
 * `block` : bornes du bloc qui le contient, pour le supprimer entièrement s'il le couvre.
 */
export function findText(
  doc: PMNode,
  needle: string,
): { from: number; to: number; wholeBlock: boolean; block: { from: number; to: number } } | null {
  const target = normalize(stripMarkdown(needle)).trim();
  if (!target) return null;

  let found: ReturnType<typeof findText> = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    // Texte du bloc et position de chaque caractère (formules et mentions n'en ont pas).
    let text = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (!child.isText) return;
      const chunk = child.text ?? '';
      for (let i = 0; i < chunk.length; i++) positions.push(pos + 1 + offset + i);
      text += chunk;
    });
    const normalized = normalize(text);
    const index = normalized.indexOf(target);
    if (index < 0) return false;
    const from = positions[index];
    const last = positions[index + target.length - 1];
    if (from === undefined || last === undefined) return false;
    found = {
      from,
      to: last + 1,
      wholeBlock: normalized.trim() === target,
      block: { from: pos, to: pos + node.nodeSize },
    };
    return false;
  });
  return found;
}

/** Un caractère pour un caractère (la longueur ne change pas : les positions restent valables). */
function normalize(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s/g, ' ');
}

/** Retire la syntaxe Markdown courante d'un extrait cité par l'IA. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|==|~~|`)/g, '')
    .replace(/(^|[^*])\*(?!\s)([^*]+)\*/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ');
}
