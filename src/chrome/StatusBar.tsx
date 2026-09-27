import { useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import type { SaveStatus } from '../lib/useAutosave';

interface StatusBarProps {
  editor: Editor;
  status: SaveStatus;
  savedAt: number;
  /** Mode focus : tout disparaît, sauf une erreur d'enregistrement. */
  hidden: boolean;
  onRetry: () => void;
}

const number = new Intl.NumberFormat('fr');
const WORDS_PER_MINUTE = 230;

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Compteur discret (mots, caractères, temps de lecture ; sur la sélection s'il y en a une)
 * et indicateur de sauvegarde : "Enregistré" apparaît brièvement puis s'efface.
 */
export function StatusBar({ editor, status, savedAt, hidden, onRetry }: StatusBarProps) {
  const [justSaved, setJustSaved] = useState(false);

  const counts = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { from, to, empty } = editor.state.selection;
      const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
      return {
        words: editor.storage.characterCount.words() as number,
        characters: editor.storage.characterCount.characters() as number,
        selectedWords: countWords(selected),
        selectedCharacters: selected.length,
      };
    },
  });

  useEffect(() => {
    if (status !== 'saved') return;
    setJustSaved(true);
    const timeout = window.setTimeout(() => setJustSaved(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [status, savedAt]);

  if (status === 'error') {
    return (
      <div
        role="alert"
        data-print-hidden
        className="fixed right-5 bottom-4 flex items-center gap-2 font-sans text-xs text-danger"
      >
        Échec de l’enregistrement
        <button
          type="button"
          onClick={onRetry}
          className="rounded px-1.5 py-0.5 font-medium underline underline-offset-2 hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const saveVisible = status === 'saving' || (status === 'saved' && justSaved);
  const selection = counts.selectedCharacters > 0;
  const minutes = Math.max(1, Math.round(counts.words / WORDS_PER_MINUTE));
  const plural = (n: number, word: string) => `${number.format(n)} ${word}${n > 1 ? 's' : ''}`;

  return (
    <div
      data-print-hidden
      className={`pointer-events-none fixed right-5 bottom-4 flex items-center gap-3 font-sans text-xs text-ink-faint tabular-nums transition-opacity duration-150 select-none ${
        hidden ? 'opacity-0' : ''
      }`}
    >
      <span
        aria-hidden
        className={`text-ink-muted transition-opacity duration-150 ${saveVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        {status === 'saving' ? 'Enregistrement…' : 'Enregistré'}
      </span>
      <span>
        {selection
          ? `${plural(counts.selectedWords, 'mot')} sélectionné${counts.selectedWords > 1 ? 's' : ''} · ${plural(counts.selectedCharacters, 'caractère')}`
          : `${plural(counts.words, 'mot')} · ${plural(counts.characters, 'caractère')} · ${minutes} min de lecture`}
      </span>
    </div>
  );
}
