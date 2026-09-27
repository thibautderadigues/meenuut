import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../ui/icons';
import { EMOJIS, ITEM_ICONS } from '../ui/itemIcons';
import { Popover, type Point } from '../ui/Popover';

interface IconPickerProps {
  label: string;
  value: string | null | undefined;
  anchor: Point;
  onSelect: (value: string | null) => void;
  onClose: () => void;
  /** Contenu au-dessus des onglets (ex. couleurs d'un encadré). */
  header?: ReactNode;
  /** Libellé du bouton qui retire l'icône. */
  noneLabel?: string;
}

type Tab = 'icons' | 'emoji';

const COLUMNS = 8;

const firstGrapheme = (text: string) =>
  [...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(text.trim())][0]?.segment ?? '';

/**
 * Choix d'une icône au trait ou d'un emoji. Grille navigable aux flèches,
 * Entrée pour choisir, Échap pour fermer.
 */
export function IconPicker({
  label,
  value,
  anchor,
  onSelect,
  onClose,
  header,
  noneLabel = 'Retirer',
}: IconPickerProps) {
  const [tab, setTab] = useState<Tab>(value?.startsWith('emoji:') ? 'emoji' : 'icons');
  const [custom, setCustom] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const choose = (next: string | null) => {
    onClose();
    onSelect(next);
  };

  // Focus sur l'icône actuelle (ou la première) à l'ouverture et au changement d'onglet.
  useEffect(() => {
    const grid = gridRef.current;
    (grid?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? grid?.querySelector('button'))?.focus();
  }, [tab]);

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button'));
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + move))]?.focus();
  };

  const tabButton = (value: Tab, text: string) => (
    <button
      type="button"
      role="tab"
      id={`${id}-${value}`}
      aria-selected={tab === value}
      aria-controls={`${id}-panel`}
      onClick={() => setTab(value)}
      className={`rounded-md px-2 py-1 text-[12px] font-medium transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent ${
        tab === value ? 'bg-surface text-ink' : 'text-ink-faint hover:text-ink'
      }`}
    >
      {text}
    </button>
  );

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
      className="w-[17.5rem] p-2"
    >
      {header}
      <div className="mb-2 flex items-center justify-between">
        <div role="tablist" aria-label="Type d’icône" className="flex gap-0.5">
          {tabButton('icons', 'Icônes')}
          {tabButton('emoji', 'Emoji')}
        </div>
        {value && (
          <button
            type="button"
            onClick={() => choose(null)}
            className="rounded-md px-2 py-1 text-[12px] text-ink-faint transition-colors duration-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {noneLabel}
          </button>
        )}
      </div>

      <div
        ref={gridRef}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        onKeyDown={onGridKeyDown}
        className="grid grid-cols-8 gap-0.5"
      >
        {tab === 'icons'
          ? ITEM_ICONS.map((icon) => {
              const selected = value === `icon:${icon.name}`;
              return (
                <button
                  key={icon.name}
                  type="button"
                  aria-label={icon.label}
                  aria-pressed={selected}
                  title={icon.label}
                  onClick={() => choose(`icon:${icon.name}`)}
                  className={`grid size-8 place-items-center rounded-md transition-colors duration-100 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] ${
                    selected ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  <Icon>{icon.paths}</Icon>
                </button>
              );
            })
          : EMOJIS.map((emoji) => {
              const selected = value === `emoji:${emoji}`;
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={emoji}
                  aria-pressed={selected}
                  onClick={() => choose(`emoji:${emoji}`)}
                  className={`grid size-8 place-items-center rounded-md text-[17px] leading-none transition-colors duration-100 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] ${
                    selected ? 'bg-accent-soft' : 'hover:bg-surface'
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
      </div>

      {tab === 'emoji' && (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            const emoji = firstGrapheme(custom);
            if (emoji) choose(`emoji:${emoji}`);
          }}
        >
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="Coller un autre emoji, puis ↵"
            aria-label="Autre emoji"
            className="h-8 w-full rounded-md bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:shadow-[inset_0_0_0_1px_var(--accent)]"
          />
        </form>
      )}
    </Popover>
  );
}
