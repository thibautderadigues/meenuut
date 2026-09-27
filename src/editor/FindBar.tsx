import { useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { keys } from '../lib/platform';
import { IconButton } from '../ui/IconButton';
import { ChevronDownIcon, CloseIcon, SearchIcon } from '../ui/icons';
import {
  clearSearch,
  getSearchState,
  replaceAll,
  replaceCurrent,
  setSearch,
  stepMatch,
} from './search';

interface FindBarProps {
  editor: Editor;
  /** Ouvert avec le champ de remplacement (⌥⌘F). */
  withReplace: boolean;
  /** Incrémenté à chaque ⌘F : refocalise le champ si la barre est déjà ouverte. */
  focusRequest: number;
  onClose: () => void;
}

/**
 * Barre de recherche (⌘F) : Entrée / ⇧Entrée pour naviguer, Échap pour fermer.
 * Insensible à la casse et aux accents par défaut ; "Aa" rend la recherche stricte.
 */
export function FindBar({ editor, withReplace, focusRequest, onClose }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(() => {
    // Préremplie avec la sélection, si elle tient sur une ligne.
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    return selected.includes('\n') ? '' : selected;
  });
  const [replacement, setReplacement] = useState('');
  const [strict, setStrict] = useState(false);
  const [showReplace, setShowReplace] = useState(withReplace);

  const { count, current } = useEditorState({
    editor,
    selector: ({ editor }) => {
      const state = getSearchState(editor.state);
      return { count: state.matches.length, current: state.current };
    },
  });

  useEffect(() => {
    if (withReplace) setShowReplace(true);
  }, [withReplace]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  useEffect(() => {
    setSearch(editor, query, strict);
  }, [editor, query, strict]);

  useEffect(() => () => clearSearch(editor), [editor]);

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const status = query ? (count ? `${current + 1} sur ${count}` : 'Aucun résultat') : '';

  return (
    <div
      role="search"
      aria-label="Rechercher dans le document"
      data-print-hidden
      onKeyDown={onKeyDown}
      className="pointer-events-auto flex w-[22rem] animate-pop-in flex-col gap-1 rounded-lg border border-rule bg-elevated p-1 font-sans shadow-popover"
    >
      <div className="flex items-center gap-0.5">
        <IconButton
          size="sm"
          label={showReplace ? 'Masquer le remplacement' : 'Remplacer'}
          shortcut={keys('alt', 'mod', 'F')}
          aria-expanded={showReplace}
          onClick={() => setShowReplace((shown) => !shown)}
          className={showReplace ? '' : '-rotate-90'}
        >
          <ChevronDownIcon />
        </IconButton>
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface px-2 text-ink-faint focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            placeholder="Rechercher"
            aria-label="Rechercher"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                stepMatch(editor, event.shiftKey ? -1 : 1);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span aria-live="polite" className="shrink-0 text-[11px] text-ink-faint tabular-nums">
            {status}
          </span>
        </label>
        <IconButton
          size="sm"
          label="Respecter la casse et les accents"
          pressed={strict}
          onClick={() => setStrict((value) => !value)}
        >
          <span className="text-[11px] font-semibold">Aa</span>
        </IconButton>
        <IconButton size="sm" label="Précédent" shortcut="⇧↵" disabled={!count} onClick={() => stepMatch(editor, -1)}>
          <span className="rotate-180">
            <ChevronDownIcon />
          </span>
        </IconButton>
        <IconButton size="sm" label="Suivant" shortcut="↵" disabled={!count} onClick={() => stepMatch(editor, 1)}>
          <ChevronDownIcon />
        </IconButton>
        <IconButton size="sm" label="Fermer" shortcut="Échap" onClick={close}>
          <CloseIcon />
        </IconButton>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1 pl-7">
          <input
            value={replacement}
            placeholder="Remplacer par"
            aria-label="Remplacer par"
            spellCheck={false}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                replaceCurrent(editor, replacement);
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-md bg-surface px-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:shadow-[inset_0_0_0_1px_var(--accent)]"
          />
          <button
            type="button"
            disabled={!count}
            onClick={() => replaceCurrent(editor, replacement)}
            className="h-8 rounded-md px-2 text-[12px] text-ink-muted transition-colors duration-100 hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35"
          >
            Remplacer
          </button>
          <button
            type="button"
            disabled={!count}
            onClick={() => replaceAll(editor, replacement)}
            className="h-8 rounded-md px-2 text-[12px] text-ink-muted transition-colors duration-100 hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35"
          >
            Tout
          </button>
        </div>
      )}
    </div>
  );
}
