import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { isModKey } from '../lib/platform';
import { CheckIcon, SearchIcon } from '../ui/icons';
import { rankCommands, type Command } from './commands';

interface CommandPaletteProps {
  commands: Command[];
  placeholder?: string;
  onClose: () => void;
}

/**
 * <dialog> natif en modal : capture du focus, Échap, arrière-plan inerte
 * et retour du focus à la fermeture sont fournis par le navigateur.
 * Monté à l'ouverture, démonté à la fermeture : chaque ouverture repart de zéro.
 */
export function CommandPalette({
  commands,
  placeholder = 'Rechercher un document ou une action',
  onClose,
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const sections = useMemo(() => rankCommands(commands, query), [commands, query]);
  const flat = sections.flatMap((section) => section.items);
  const activeIndex = Math.min(active, flat.length - 1);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Fermer d'abord (le focus revient à sa place), puis agir : une action qui déplace
  // le focus, comme créer un document, garde ainsi le dernier mot.
  const close = () => dialogRef.current?.close();
  const runAt = (index: number) => {
    const item = flat[index];
    if (!item) return;
    close();
    item.command.run();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const count = flat.length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      setActive((activeIndex + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      setActive((activeIndex - 1 + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runAt(activeIndex);
    }
  };

  let index = -1;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Palette de commandes"
      className="palette"
      onClose={onClose}
      // Clic sur le fond (hors du panneau) : fermer.
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (isModKey(event) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-rule px-4 text-ink-faint">
        <SearchIcon />
        <input
          autoFocus
          value={query}
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? `${id}-option-${activeIndex}` : undefined}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label="Résultats"
        className="max-h-[min(22rem,55vh)] scroll-py-1.5 overflow-y-auto p-1.5"
      >
        {flat.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-ink-faint">Aucun résultat</p>
        )}
        {sections.map((section) => (
          <div key={section.label} role="group" aria-labelledby={`${id}-${section.label}`}>
            <div
              id={`${id}-${section.label}`}
              className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-ink-faint"
            >
              {section.label}
            </div>
            {section.items.map(({ command, indices }) => {
              index += 1;
              const itemIndex = index;
              const Icon = command.icon;
              const selected = itemIndex === activeIndex;
              return (
                <div
                  key={command.id}
                  id={`${id}-option-${itemIndex}`}
                  role="option"
                  aria-selected={selected}
                  data-index={itemIndex}
                  onMouseMove={() => setActive(itemIndex)}
                  onClick={() => runAt(itemIndex)}
                  className={`flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm ${
                    selected ? 'bg-surface' : ''
                  }`}
                >
                  <span className={`grid size-4 shrink-0 place-items-center ${selected ? 'text-ink' : 'text-ink-muted'}`}>
                    <Icon />
                  </span>
                  <span className="flex-1 truncate text-ink">
                    <Highlight text={command.label} indices={indices} />
                  </span>
                  {command.checked && (
                    <span className="text-accent">
                      <CheckIcon />
                      <span className="sr-only">(actif)</span>
                    </span>
                  )}
                  {command.hint && (
                    <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">
                      {command.hint}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex gap-4 border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
        <span>↑↓ naviguer</span>
        <span>↵ valider</span>
        <span>esc fermer</span>
      </div>
    </dialog>
  );
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return text;
  const matched = new Set(indices);
  return [...text].map((char, i) =>
    matched.has(i) ? (
      <span key={i} className="font-semibold">
        {char}
      </span>
    ) : (
      char
    ),
  );
}
