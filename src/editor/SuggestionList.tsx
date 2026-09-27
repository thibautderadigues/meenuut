import type { SuggestionProps } from '@tiptap/suggestion';
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface SuggestionListOptions<T> {
  label: string;
  empty: string;
  getKey: (item: T) => string;
  renderItem: (item: T, active: boolean) => ReactNode;
}

export type SuggestionListProps<T> = SuggestionProps<T, T> &
  SuggestionListOptions<T> & { ref?: Ref<SuggestionListHandle> };

/**
 * Liste de suggestions (menu "/", mentions "@") : le focus reste dans l'éditeur,
 * ↑/↓ pour choisir, Entrée ou Tab pour valider, Échap géré par le plugin Suggestion.
 */
export function SuggestionList<T>({
  items,
  command,
  editor,
  label,
  empty,
  getKey,
  renderItem,
  ref,
}: SuggestionListProps<T>) {
  const [active, setActive] = useState(0);
  const [shownItems, setShownItems] = useState(items);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Nouveau filtrage : on revient au premier résultat.
  if (items !== shownItems) {
    setShownItems(items);
    setActive(0);
  }

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (items.length === 0) return false;
        switch (event.key) {
          case 'ArrowDown':
            setActive((index) => (index + 1) % items.length);
            return true;
          case 'ArrowUp':
            setActive((index) => (index - 1 + items.length) % items.length);
            return true;
          case 'Enter':
          case 'Tab': {
            const item = items[active];
            if (item) command(item);
            return true;
          }
          default:
            return false;
        }
      },
    }),
    [items, active, command],
  );

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Le focus reste dans l'éditeur : on lui indique l'option active pour les lecteurs d'écran.
  const activeOptionId = items.length ? `${id}-${active}` : undefined;
  useEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute('aria-controls', `${id}-list`);
    dom.setAttribute('aria-expanded', 'true');
    if (activeOptionId) dom.setAttribute('aria-activedescendant', activeOptionId);
    else dom.removeAttribute('aria-activedescendant');
    return () => {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-expanded');
      dom.removeAttribute('aria-activedescendant');
    };
  }, [editor, id, activeOptionId]);

  return (
    <div
      data-suggestion-list
      data-print-hidden
      className="w-72 animate-pop-in overflow-hidden rounded-xl border border-rule bg-elevated font-sans shadow-popover"
    >
      {items.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-ink-muted">{empty}</p>
      ) : (
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="max-h-[22rem] scroll-py-1 overflow-y-auto p-1"
        >
          {items.map((item, index) => (
            <div
              key={getKey(item)}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              data-index={index}
              // mousemove plutôt que mouseenter : une liste qui défile sous un curseur immobile
              // ne doit pas voler la sélection clavier.
              onMouseMove={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                command(item);
              }}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1 ${
                index === active ? 'bg-surface' : ''
              }`}
            >
              {renderItem(item, index === active)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
