import { useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CloseIcon } from '../ui/icons';
import { Popover, type Point } from '../ui/Popover';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from './colors';

interface ColorPickerProps {
  editor: Editor;
  anchor: Point;
  onClose: () => void;
}

const COLUMNS = 7;

/** Couleur du texte et surlignage, sur deux lignes. Flèches pour naviguer, Entrée pour appliquer. */
export function ColorPicker({ editor, anchor, onClose }: ColorPickerProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const current = useEditorState({
    editor,
    selector: ({ editor }) => ({
      text: (editor.getAttributes('textStyle').color as string | undefined) ?? null,
      highlight: editor.isActive('highlight')
        ? ((editor.getAttributes('highlight').color as string | undefined) ?? 'var(--hl-yellow)')
        : null,
    }),
  });

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  const apply = (run: () => void) => {
    onClose();
    run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button'));
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const move = moves[event.key];
    if (index < 0 || move === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + move))]?.focus();
  };

  const swatch = (label: string, selected: boolean, onClick: () => void, content: ReactNode) => (
    <button
      key={label}
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-md transition-colors duration-100 outline-none hover:bg-surface focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] ${
        selected ? 'shadow-[inset_0_0_0_1.5px_var(--accent)]' : ''
      }`}
    >
      {content}
    </button>
  );

  const chain = () => editor.chain().focus();

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      aria-label="Couleurs"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
      // Le clic ne doit pas retirer le focus (et la sélection) de l'éditeur.
      onMouseDown={(event) => event.preventDefault()}
      className="p-2"
    >
      <div ref={gridRef} onKeyDown={onKeyDown} className="flex flex-col gap-1">
        <p className="px-1 text-[11px] font-medium text-ink-faint">Texte</p>
        <div className="grid grid-cols-7 gap-0.5">
          {swatch(
            'Couleur par défaut',
            current.text === null,
            () => apply(() => chain().unsetColor().run()),
            <span className="text-[14px] font-semibold text-ink">A</span>,
          )}
          {TEXT_COLORS.map((color) =>
            swatch(
              `Texte ${color.label.toLowerCase()}`,
              current.text === color.value,
              () => apply(() => chain().setColor(color.value).run()),
              <span className="text-[14px] font-semibold" style={{ color: color.value }}>
                A
              </span>,
            ),
          )}
        </div>
        <p className="mt-1 px-1 text-[11px] font-medium text-ink-faint">Surlignage</p>
        <div className="grid grid-cols-7 gap-0.5">
          {swatch(
            'Sans surlignage',
            current.highlight === null,
            () => apply(() => chain().unsetHighlight().run()),
            <span className="grid size-5 place-items-center rounded border border-rule text-ink-faint">
              <CloseIcon />
            </span>,
          )}
          {HIGHLIGHT_COLORS.map((color) =>
            swatch(
              `Surlignage ${color.label.toLowerCase()}`,
              current.highlight === color.value,
              () => apply(() => chain().setHighlight({ color: color.value }).run()),
              <span className="size-5 rounded" style={{ background: color.value }} />,
            ),
          )}
        </div>
      </div>
    </Popover>
  );
}
