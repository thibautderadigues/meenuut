import { useId, useState, type ComponentType, type KeyboardEvent } from 'react';
import { CheckIcon } from './icons';
import { Popover, type Point } from './Popover';

export type { Point };

export type MenuEntry =
  | {
      label: string;
      icon: ComponentType;
      shortcut?: string;
      danger?: boolean;
      /** Défini : élément à choix unique (menuitemradio), coché ou non. */
      checked?: boolean;
      run: () => void;
    }
  | 'separator';

interface MenuProps {
  label: string;
  entries: MenuEntry[];
  anchor: Point;
  onClose: () => void;
}

/**
 * Menu contextuel : navigable au clavier, fermé par Échap, Tab ou un clic ailleurs.
 * Positionnement et retour du focus : voir Popover.
 */
export function Menu({ label, entries, anchor, onClose }: MenuProps) {
  const [active, setActive] = useState(0);
  const id = useId();
  const items = entries.filter((entry) => entry !== 'separator');

  const select = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    switch (event.key) {
      case 'ArrowDown':
        setActive((active + 1) % items.length);
        break;
      case 'ArrowUp':
        setActive((active - 1 + items.length) % items.length);
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        select(active);
        break;
      case 'Escape':
      case 'Tab':
        onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  let index = -1;

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="menu"
      aria-label={label}
      aria-activedescendant={`${id}-${active}`}
      onKeyDown={onKeyDown}
      className="min-w-52 p-1"
    >
      {entries.map((entry, position) => {
        if (entry === 'separator') {
          return <div key={`separator-${position}`} role="separator" className="my-1 h-px bg-rule" />;
        }
        index += 1;
        const itemIndex = index;
        const Icon = entry.icon;
        const selected = itemIndex === active;
        return (
          <div
            key={entry.label}
            id={`${id}-${itemIndex}`}
            role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={entry.checked}
            onMouseMove={() => setActive(itemIndex)}
            onClick={() => select(itemIndex)}
            className={`flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] ${
              selected ? 'bg-surface' : ''
            } ${entry.danger ? 'text-danger' : 'text-ink'}`}
          >
            <span
              className={`grid size-4 place-items-center ${entry.danger ? '' : 'text-ink-muted'}`}
            >
              <Icon />
            </span>
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut && <span className="text-[11px] text-ink-faint">{entry.shortcut}</span>}
            {entry.checked && (
              <span className="text-accent">
                <CheckIcon />
              </span>
            )}
          </div>
        );
      })}
    </Popover>
  );
}
