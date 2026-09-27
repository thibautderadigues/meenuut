import type { Editor } from '@tiptap/react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Popover, type Point } from '../ui/Popover';

/**
 * Choix de la taille d'un tableau, comme dans Word : une grille de cases, on survole
 * jusqu'à la taille voulue (les cases s'allument depuis le coin haut-gauche), un clic insère.
 * Au clavier : flèches pour agrandir ou réduire, Entrée pour insérer.
 */

const COLS = 10;
const ROWS = 8;

/** Demande d'ouverture depuis le menu « / » ou le panneau Insérer, là où est le curseur. */
const OPEN_EVENT = 'meenuut:table-picker';

export function requestTablePicker(editor: Editor) {
  const { from } = editor.state.selection;
  const coords = editor.view.coordsAtPos(from);
  window.dispatchEvent(new CustomEvent<Point>(OPEN_EVENT, { detail: { x: coords.left, y: coords.bottom } }));
}

export function insertTable(editor: Editor, cols: number, rows: number) {
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
}

/** Monté une fois par éditeur : ouvre la grille à la demande du menu « / » ou du panneau Insérer. */
export function TablePickerHost({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState<Point | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => setAnchor((event as CustomEvent<Point>).detail);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  if (!anchor) return null;
  return <TablePicker editor={editor} anchor={anchor} onClose={() => setAnchor(null)} />;
}

interface TablePickerProps {
  editor: Editor;
  anchor: Point;
  onClose: () => void;
}

export function TablePicker({ editor, anchor, onClose }: TablePickerProps) {
  const [size, setSize] = useState({ cols: 0, rows: 0 });
  const empty = size.cols === 0;

  const pick = (cols: number, rows: number) => {
    onClose();
    // Après la fermeture : le focus revient d'abord à l'éditeur.
    requestAnimationFrame(() => insertTable(editor, cols, rows));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === 'Enter' && !empty) {
      event.preventDefault();
      pick(size.cols, size.rows);
      return;
    }
    const delta: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    setSize(({ cols, rows }) => ({
      cols: Math.min(COLS, Math.max(1, (cols || 1) + (cols ? move[0] : 0))),
      rows: Math.min(ROWS, Math.max(1, (rows || 1) + (rows ? move[1] : 0))),
    }));
  };

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      aria-label="Insérer un tableau"
      onKeyDown={onKeyDown}
      // Le clic ne doit pas retirer le focus (et la sélection) de l'éditeur.
      onMouseDown={(event) => event.preventDefault()}
      className="p-2.5"
    >
      <p aria-live="polite" className="mb-2 px-0.5 font-sans text-xs text-ink-muted tabular-nums">
        {empty ? 'Insérer un tableau' : `Tableau ${size.cols} × ${size.rows}`}
      </p>
      <div
        tabIndex={0}
        data-autofocus
        aria-label="Taille du tableau : flèches pour choisir, Entrée pour insérer"
        onMouseLeave={() => setSize({ cols: 0, rows: 0 })}
        className="grid gap-[3px] rounded outline-none"
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
      >
        {Array.from({ length: ROWS * COLS }, (_, index) => {
          const col = (index % COLS) + 1;
          const row = Math.floor(index / COLS) + 1;
          const lit = col <= size.cols && row <= size.rows;
          return (
            <div
              key={index}
              aria-hidden
              onMouseEnter={() => setSize({ cols: col, rows: row })}
              onClick={() => pick(col, row)}
              className={`size-[18px] cursor-pointer rounded-[3px] border transition-colors duration-75 ${
                lit ? 'border-accent bg-accent-soft' : 'border-rule-strong bg-canvas'
              }`}
            />
          );
        })}
      </div>
    </Popover>
  );
}
