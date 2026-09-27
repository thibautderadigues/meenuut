import { useEditorState, type Editor } from '@tiptap/react';
import type { SaveStatus } from '../lib/useAutosave';
import { useSyncStatus, type SyncStatus } from '../sync/sync';

interface StatusBarProps {
  editor: Editor;
  status: SaveStatus;
  /** Mode focus : tout disparaît, sauf une erreur d'enregistrement. */
  hidden: boolean;
  onRetry: () => void;
}

const number = new Intl.NumberFormat('fr');
const WORDS_PER_MINUTE = 230;

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

type Indicator = { label: string; dot: string; pulse?: boolean };

/** Enregistrement local (IndexedDB) puis envoi en ligne : un seul état pour l'utilisateur. */
function indicator(status: SaveStatus, sync: SyncStatus): Indicator {
  if (status === 'dirty') return { label: 'Non enregistré', dot: 'bg-ink-faint' };
  if (status === 'saving' || sync === 'pending') {
    return { label: 'Enregistrement…', dot: 'bg-accent', pulse: true };
  }
  if (sync === 'offline') {
    return { label: 'Hors ligne · enregistré sur cet appareil', dot: 'bg-[var(--tx-orange)]' };
  }
  if (sync === 'error') {
    return { label: 'Pas encore en ligne · nouvel essai…', dot: 'bg-[var(--tx-orange)]' };
  }
  return { label: 'Enregistré', dot: 'bg-[var(--tx-green)]' };
}

/**
 * Compteur discret (mots, caractères, temps de lecture ; sur la sélection s'il y en a une)
 * et indicateur de sauvegarde, toujours visible : non enregistré, en cours, enregistré en ligne.
 */
export function StatusBar({ editor, status, hidden, onRetry }: StatusBarProps) {
  const sync = useSyncStatus();

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

  const save = indicator(status, sync);
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
      <span role="status" className="flex items-center gap-1.5 text-ink-muted">
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${save.dot} ${save.pulse ? 'animate-pulse' : ''}`}
        />
        {save.label}
      </span>
      <span>
        {selection
          ? `${plural(counts.selectedWords, 'mot')} sélectionné${counts.selectedWords > 1 ? 's' : ''} · ${plural(counts.selectedCharacters, 'caractère')}`
          : `${plural(counts.words, 'mot')} · ${plural(counts.characters, 'caractère')} · ${minutes} min de lecture`}
      </span>
    </div>
  );
}
