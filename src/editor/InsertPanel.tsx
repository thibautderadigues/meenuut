import type { Editor } from '@tiptap/react';
import { useEffect, useId, useRef, useState } from 'react';
import { SearchIcon } from '../ui/icons';
import { Popover, type Point } from '../ui/Popover';
import { CUSTOM_ITEMS } from './blocks/catalog';
import { filterSlashItems, SLASH_ITEMS, type SlashItem } from './slash/items';

interface InsertPanelProps {
  editor: Editor;
  anchor: Point;
  onClose: () => void;
}

/**
 * Panneau « Insérer » de la barre d'outils : tous les blocs, de base et spéciaux,
 * avec recherche. ↑/↓ pour choisir, Entrée pour insérer, Échap pour fermer.
 */
export function InsertPanel({ editor, anchor, onClose }: InsertPanelProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const base = query ? filterSlashItems(query) : SLASH_ITEMS;
  const custom = query ? filterSlashItems(query, CUSTOM_ITEMS).filter((item) => CUSTOM_ITEMS.includes(item)) : CUSTOM_ITEMS;
  const sections = [
    { label: 'Blocs spéciaux', items: custom },
    { label: 'Blocs de base', items: base },
  ].filter((section) => section.items.length > 0);
  const flat = sections.flatMap((section) => section.items);
  const activeIndex = Math.min(active, flat.length - 1);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const insert = (item: SlashItem | undefined) => {
    if (!item) return;
    onClose();
    // Frame suivante : le panneau est fermé et React a fini son rendu. Les blocs à vue React
    // (encadrés) ne peuvent pas être montés pendant un rendu en cours.
    requestAnimationFrame(() => item.run(editor.chain().focus(), editor));
  };

  let index = -1;

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      aria-label="Insérer un bloc"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          onClose();
          editor.commands.focus();
        }
      }}
      className="flex w-80 flex-col"
    >
      <label className="m-2 flex h-8 shrink-0 items-center gap-2 rounded-md bg-surface px-2.5 text-ink-faint focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
        <SearchIcon />
        <input
          data-autofocus
          value={query}
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={flat.length ? `${id}-${activeIndex}` : undefined}
          placeholder="Rechercher un bloc"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && flat.length) {
              event.preventDefault();
              setActive((activeIndex + 1) % flat.length);
            } else if (event.key === 'ArrowUp' && flat.length) {
              event.preventDefault();
              setActive((activeIndex - 1 + flat.length) % flat.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              insert(flat[activeIndex]);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
        />
      </label>

      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label="Blocs"
        className="min-h-0 flex-1 scroll-py-1 overflow-y-auto px-1.5 pb-1.5"
      >
        {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-faint">Aucun bloc</p>}
        {sections.map((section) => (
          <div key={section.label} role="group" aria-label={section.label}>
            <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-ink-faint">{section.label}</p>
            {section.items.map((item) => {
              index += 1;
              const itemIndex = index;
              const Icon = item.icon;
              const selected = itemIndex === activeIndex;
              return (
                <div
                  key={item.id}
                  id={`${id}-${itemIndex}`}
                  role="option"
                  aria-selected={selected}
                  data-index={itemIndex}
                  onMouseMove={() => setActive(itemIndex)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-1.5 py-1.5 ${selected ? 'bg-surface' : ''}`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-rule bg-canvas text-ink-muted">
                    <Icon />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] text-ink">{item.label}</span>
                    {(item.description || item.hint) && (
                      <span className="truncate text-[11.5px] text-ink-faint">
                        {item.description ?? `Raccourci : ${item.hint}`}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Popover>
  );
}
