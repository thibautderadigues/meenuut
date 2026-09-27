import type { TableOfContentData } from '@tiptap/extension-table-of-contents';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

interface OutlineProps {
  editor: Editor;
  items: TableOfContentData;
  hidden: boolean;
}

/**
 * Sommaire (grands écrans) : les titres du document, la section en cours en bleu.
 * Un clic y mène et place le curseur au début du titre.
 */
export function Outline({ editor, items, hidden }: OutlineProps) {
  if (items.length < 2) return null;

  const goTo = (pos: number, dom: HTMLElement) => {
    dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 1))));
    view.dom.focus({ preventScroll: true });
  };

  return (
    <nav
      aria-label="Sommaire"
      data-print-hidden
      inert={hidden}
      className={`fixed top-24 right-6 hidden max-h-[calc(100dvh-9rem)] w-52 overflow-y-auto font-sans transition-opacity duration-150 min-[1400px]:block ${
        hidden ? 'opacity-0' : ''
      }`}
    >
      <p className="mb-2 px-2 text-[11px] font-medium text-ink-faint">Sommaire</p>
      <ul className="flex flex-col gap-px border-l border-rule">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={item.isActive ? 'location' : undefined}
              onClick={() => goTo(item.pos, item.dom)}
              style={{ paddingLeft: `${0.75 + (item.level - 1) * 0.75}rem` }}
              className={`-ml-px block w-full truncate border-l py-1 pr-2 text-left text-[12.5px] transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent ${
                item.isActive
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink-muted'
              }`}
            >
              {item.textContent || 'Titre sans texte'}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
