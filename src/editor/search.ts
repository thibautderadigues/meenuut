import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension, type Editor } from '@tiptap/react';
import { normalizeForSearch } from '../lib/format';

export interface Match {
  from: number;
  to: number;
}

interface SearchState {
  query: string;
  /** Respecter la casse et les accents. */
  strict: boolean;
  matches: Match[];
  current: number;
  decorations: DecorationSet;
}

type SearchMeta = Partial<Pick<SearchState, 'query' | 'strict' | 'current'>>;

export const searchKey = new PluginKey<SearchState>('search');

const EMPTY: SearchState = {
  query: '',
  strict: false,
  matches: [],
  current: 0,
  decorations: DecorationSet.empty,
};

/** Occurrences dans chaque bloc de texte ; les nœuds en ligne (mention, formule) comptent pour un caractère. */
export function findMatches(doc: PMNode, query: string, strict: boolean): Match[] {
  if (!query) return [];
  const prepare = (text: string) => (strict ? text : normalizeForSearch(text));
  const needle = prepare(query);
  const matches: Match[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) positions.push(start + i);
        text += child.text;
      } else {
        positions.push(start);
        text += '￼';
      }
    });
    const haystack = prepare(text);
    for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + needle.length)) {
      matches.push({ from: positions[index]!, to: positions[index + needle.length - 1]! + 1 });
    }
    return false;
  });
  return matches;
}

function computeState(doc: PMNode, query: string, strict: boolean, current: number): SearchState {
  const matches = findMatches(doc, query, strict);
  const index = matches.length ? ((current % matches.length) + matches.length) % matches.length : 0;
  const decorations = DecorationSet.create(
    doc,
    matches.map((match, i) =>
      Decoration.inline(match.from, match.to, {
        class: i === index ? 'search-match search-match-current' : 'search-match',
      }),
    ),
  );
  return { query, strict, matches, current: index, decorations };
}

/**
 * Rechercher et remplacer. Les occurrences sont des décorations : le document n'est pas modifié
 * tant qu'on ne remplace pas. Recalcul à chaque modification tant qu'une recherche est active.
 */
export const Search = Extension.create({
  name: 'search',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => EMPTY,
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
            if (!meta && (!tr.docChanged || !previous.query)) return previous;
            return computeState(
              newState.doc,
              meta?.query ?? previous.query,
              meta?.strict ?? previous.strict,
              meta?.current ?? previous.current,
            );
          },
        },
        props: {
          decorations: (state) => searchKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

export function getSearchState(state: EditorState): SearchState {
  return searchKey.getState(state) ?? EMPTY;
}

/** Sélectionne l'occurrence courante et la fait défiler à l'écran, sans voler le focus. */
function reveal(editor: Editor) {
  const { matches, current } = getSearchState(editor.state);
  const match = matches[current];
  if (!match) return;
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to));
  editor.view.dispatch(tr.scrollIntoView());
}

export function setSearch(editor: Editor, query: string, strict: boolean) {
  // Première occurrence après le curseur, plutôt que la première du document.
  const cursor = editor.state.selection.from;
  const matches = findMatches(editor.state.doc, query, strict);
  const after = matches.findIndex((match) => match.from >= cursor);
  editor.view.dispatch(
    editor.state.tr.setMeta(searchKey, { query, strict, current: Math.max(0, after) }),
  );
  reveal(editor);
}

export function stepMatch(editor: Editor, delta: 1 | -1) {
  const { current } = getSearchState(editor.state);
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { current: current + delta }));
  reveal(editor);
}

export function replaceCurrent(editor: Editor, replacement: string) {
  const { matches, current } = getSearchState(editor.state);
  const match = matches[current];
  if (!match) return;
  editor.view.dispatch(editor.state.tr.insertText(replacement, match.from, match.to));
  // L'occurrence suivante prend l'index de celle remplacée.
  reveal(editor);
}

export function replaceAll(editor: Editor, replacement: string): number {
  const { matches } = getSearchState(editor.state);
  if (!matches.length) return 0;
  const tr = editor.state.tr;
  // À rebours : les positions des occurrences précédentes restent valides.
  for (const match of [...matches].reverse()) tr.insertText(replacement, match.from, match.to);
  editor.view.dispatch(tr);
  return matches.length;
}

export function clearSearch(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: '' }));
}
